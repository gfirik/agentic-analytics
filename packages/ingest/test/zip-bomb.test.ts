// The ZIP limit holds whatever the headers say (docs/specs/security.md §5): the decompressed size is
// measured by inflating, and the parsers never run on a file that fails the check.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingest } from "../src/index.ts";
import { measureZip, readZipEntries } from "../src/zip.ts";

// Spies around the real parsers, so a test can prove they were never handed the bytes.
const parsers = vi.hoisted(() => ({ grids: vi.fn(), docx: vi.fn() }));
vi.mock("../src/grid.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/grid.ts")>();
  return { ...real, readWorkbookGrids: parsers.grids.mockImplementation(real.readWorkbookGrids) };
});
vi.mock("../src/docs/docx.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/docs/docx.ts")>();
  return { ...real, docxBlocks: parsers.docx.mockImplementation(real.docxBlocks) };
});
beforeEach(() => {
  parsers.grids.mockClear();
  parsers.docx.mockClear();
});

const fx = (p: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "..", "..", "..", "fixtures", p)));
const MB = 1024 * 1024;
// A lowered limit keeps the bombs small: 8 MB of zeros deflates to about 8 KB.
const limits = { maxZipUncompressedBytes: 1 * MB };

interface Part {
  readonly name: string;
  readonly data: Uint8Array;
  readonly method?: number;
  /** Raw bytes to store as the entry's data, instead of compressing `data`. */
  readonly raw?: Uint8Array;
  /** Bit 3: sizes and CRC follow the data in a descriptor; the local header holds zeros. */
  readonly descriptor?: boolean;
  /** Lies written into the headers. */
  readonly localSize?: number;
  readonly centralSize?: number;
  /** Point this central entry at another part's local header. */
  readonly sameLocalAs?: number;
}

const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A ZIP written byte by byte, so the tests control every header field. */
function zip(parts: readonly Part[], eocdPatch?: { diskEntries?: number }): Uint8Array {
  const out: number[] = [];
  const central: number[] = [];
  const offsets: number[] = [];
  const enc = new TextEncoder();
  for (const p of parts) {
    const method = p.method ?? 8;
    const body = p.raw ?? (method === 8 ? deflateRawSync(p.data) : p.data);
    const crc = crc32(p.data);
    const name = enc.encode(p.name);
    const flags = p.descriptor ? 8 : 0;
    const lc = p.descriptor ? 0 : body.length;
    const lu = p.localSize ?? (p.descriptor ? 0 : p.data.length);
    const offset = p.sameLocalAs === undefined ? out.length : (offsets[p.sameLocalAs] as number);
    offsets.push(offset);
    if (p.sameLocalAs === undefined) {
      out.push(...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u32(0), ...u32(p.descriptor ? 0 : crc));
      out.push(...u32(lc), ...u32(lu), ...u16(name.length), ...u16(0), ...name);
      for (const b of body) out.push(b);
      if (p.descriptor) out.push(...u32(0x08074b50), ...u32(crc), ...u32(body.length), ...u32(p.data.length));
    }
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u32(0), ...u32(crc));
    central.push(...u32(body.length), ...u32(p.centralSize ?? p.data.length), ...u16(name.length), ...u16(0), ...u16(0));
    central.push(...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name);
  }
  const cdOffset = out.length;
  out.push(...central);
  const n = parts.length;
  out.push(...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(eocdPatch?.diskEntries ?? n), ...u16(n));
  out.push(...u32(central.length), ...u32(cdOffset), ...u16(0));
  return new Uint8Array(out);
}

/** The parts of a real ZIP, decompressed (fixtures are honest, so their headers can be read here). */
function unzip(bytes: Uint8Array): Part[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (readZipEntries(bytes) ?? []).map((e) => {
    const at = e.localOffset;
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    const body = bytes.subarray(start, start + e.compressedSize);
    return { name: e.name, data: e.method === 8 ? new Uint8Array(inflateRawSync(body)) : body.slice() };
  });
}

const zeros = (n: number) => new Uint8Array(n);
const bombParts = (name: string): Part[] => [{ name, data: zeros(8 * MB), localSize: 0, centralSize: 1000 }];

describe("the ZIP limit measures the real decompressed size", () => {
  it("rejects an xlsx bomb whose headers claim 1,000 bytes, before SheetJS runs", async () => {
    const bomb = zip(bombParts("xl/workbook.xml"));
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect((readZipEntries(bomb) ?? []).reduce((s, e) => s + e.uncompressedSize, 0)).toBe(1000);
    const res = await ingest([{ name: "bomb.xlsx", bytes: bomb }], { limits });
    expect(res.files[0]).toMatchObject({ kind: "xlsx", status: "rejected" });
    expect(res.issues).toEqual([
      expect.objectContaining({ kind: "too_large", severity: "high", message: expect.stringContaining("ZIP bomb") }),
    ]);
    expect(parsers.grids).not.toHaveBeenCalled();
  });

  it("rejects a docx bomb before mammoth runs", async () => {
    const bomb = zip([{ name: "[Content_Types].xml", data: new TextEncoder().encode("<Types/>") }, ...bombParts("word/document.xml")]);
    const res = await ingest([{ name: "bomb.docx", bytes: bomb }], { limits });
    expect(res.files[0]).toMatchObject({ kind: "docx", status: "rejected" });
    expect(res.issues.map((i) => i.kind)).toEqual(["too_large"]);
    expect(parsers.docx).not.toHaveBeenCalled();
  });

  it("rejects a bomb attached to an email; the email itself still ingests", async () => {
    const bomb = zip(bombParts("xl/workbook.xml"));
    const b64 = Buffer.from(bomb).toString("base64").replace(/.{76}/g, "$&\r\n");
    const eml = [
      "From: a@example.com",
      "To: b@example.com",
      "Subject: Numbers",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "See attached.",
      "--b1",
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="q3.xlsx"',
      'Content-Disposition: attachment; filename="q3.xlsx"',
      "Content-Transfer-Encoding: base64",
      "",
      b64,
      "--b1--",
      "",
    ].join("\r\n");
    const res = await ingest([{ name: "mail.eml", bytes: new TextEncoder().encode(eml) }], { limits });
    expect(res.files.map((f) => [f.name, f.status, f.parent ?? null])).toEqual([
      ["mail.eml", "ingested", null],
      ["q3.xlsx", "rejected", "F1"],
    ]);
    expect(res.issues.map((i) => [i.file, i.kind])).toEqual([["q3.xlsx", "too_large"]]);
    expect(parsers.grids).not.toHaveBeenCalled();
  });

  it("counts the inflated bytes of honest files exactly", async () => {
    for (const f of ["xlsx/01-simple.xlsx", "docs/notes.docx", "docs/corrupted.docx"]) {
      const bytes = fx(f);
      const claimed = (readZipEntries(bytes) ?? []).reduce((s, e) => s + e.uncompressedSize, 0);
      expect(await measureZip(bytes, 300 * MB)).toBe(claimed);
    }
  });

  it("still ingests legitimate xlsx and docx fixtures", async () => {
    const res = await ingest([
      { name: "a.xlsx", bytes: fx("xlsx/01-simple.xlsx") },
      { name: "n.docx", bytes: fx("docs/notes.docx") },
    ]);
    expect(res.files.map((f) => f.status)).toEqual(["ingested", "ingested"]);
    expect(res.tables).toHaveLength(1);
    expect(parsers.grids).toHaveBeenCalledOnce();
    expect(parsers.docx).toHaveBeenCalledOnce();
  });

  it("ingests an honest xlsx written with data descriptors (sizes after the data)", async () => {
    const plain = await ingest([{ name: "a.xlsx", bytes: fx("xlsx/01-simple.xlsx") }]);
    const repacked = zip(unzip(fx("xlsx/01-simple.xlsx")).map((p) => ({ ...p, descriptor: true })));
    const res = await ingest([{ name: "a.xlsx", bytes: repacked }]);
    expect(res.files[0]?.status).toBe("ingested");
    expect(res.issues).toEqual([]);
    expect(res.tables.map((t) => t.columns.map((c) => c.name))).toEqual(plain.tables.map((t) => t.columns.map((c) => c.name)));
  });

  it("rejects a bomb split across many entries pointing at one compressed body", async () => {
    const kernel = { name: "xl/a.xml", data: zeros(MB / 2) };
    const bytes = zip([kernel, ...Array.from({ length: 50 }, (_, i) => ({ name: `xl/b${i}.xml`, data: kernel.data, sameLocalAs: 0 }))]);
    await expect(measureZip(bytes, 300 * MB)).rejects.toMatchObject({ code: "MALFORMED" });
  });
});

describe("structures the parsers could read differently are rejected", () => {
  const text = new TextEncoder().encode("<x/>");
  const reject = async (bytes: Uint8Array) => {
    const res = await ingest([{ name: "x.xlsx", bytes }], { limits });
    expect(res.files[0]?.status).toBe("rejected");
    expect(res.issues.map((i) => i.kind)).toEqual(["unreadable_file"]);
    expect(parsers.grids).not.toHaveBeenCalled();
  };

  it("an unknown compression method", async () => {
    await reject(zip([{ name: "xl/a.xml", data: text, method: 12, raw: text }]));
  });

  it("a deflate stream that runs on past its entry", async () => {
    // Truncated: the deflate stream of the first entry never ends before the next local header.
    const full = deflateRawSync(zeros(4 * 1024));
    await reject(
      zip([
        { name: "xl/a.xml", data: zeros(4 * 1024), raw: full.subarray(0, full.length - 2) },
        { name: "xl/b.xml", data: text },
      ]),
    );
  });

  it("a stored entry whose size runs past its entry", async () => {
    const bytes = zip([{ name: "xl/a.xml", data: text, method: 0 }]);
    // Patch the local compressed size (offset 18) to 1 MB.
    new DataView(bytes.buffer).setUint32(18, MB, true);
    await reject(bytes);
  });

  it("entry counts that disagree between this disk and the total", async () => {
    await reject(zip([{ name: "xl/a.xml", data: text }], { diskEntries: 2 }));
  });

  it("ZIP64 sentinels in the end record", async () => {
    const bytes = zip([{ name: "xl/a.xml", data: text }]);
    new DataView(bytes.buffer).setUint32(bytes.length - 6, 0xffffffff, true);
    expect(readZipEntries(bytes)).toBeUndefined();
    await expect(measureZip(bytes, MB)).rejects.toMatchObject({ code: "MALFORMED" });
  });
});
