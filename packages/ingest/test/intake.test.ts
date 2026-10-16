import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ingest, sha256Hex, sniff, withTimeout } from "../src/index.ts";

const fx = (p: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "..", "..", "..", "fixtures", p)));
const text = (s: string) => new TextEncoder().encode(s);

describe("sniff (magic bytes first, extension only a hint)", () => {
  it.each([
    ["xlsx/01-simple.xlsx", "data.bin", "xlsx"],
    ["xlsx/15-legacy.xls", "x.xlsx", "xls"],
    ["docs/report.pdf", "report.txt", "pdf"],
    ["docs/notes.docx", "notes.zip", "docx"],
    ["docs/message.eml", "message.txt", "eml"],
    ["csv/02-tabs.tsv", "tabs.dat", "tsv"],
    ["docs/notes.md", "notes.md", "md"],
    ["docs/archive.zip", "archive.xlsx", "archive"],
  ])("%s named %s → %s", (path, name, kind) => {
    expect(sniff(fx(path), name).kind).toBe(kind);
  });

  it("detects CSV by consistent delimiters and rejects binary noise", () => {
    expect(sniff(text("a;b;c\n1;2;3\n4;5;6\n"), "export").kind).toBe("csv");
    expect(sniff(new Uint8Array([0, 1, 2, 3, 255]), "blob").kind).toBe("unknown");
    expect(sniff(new Uint8Array([0x1f, 0x8b, 8, 0]), "x.gz").kind).toBe("archive");
  });
});

describe("intake", () => {
  it("hashes files with sha256", async () => {
    // sha256("abc") from FIPS 180-2
    expect(await sha256Hex(text("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("ingests duplicate files once and notes the duplicate", async () => {
    const bytes = fx("csv/02-tabs.tsv");
    const res = await ingest([
      { name: "a.tsv", bytes },
      { name: "b.tsv", bytes },
    ]);
    expect(res.files.map((f) => [f.status, f.duplicate_of ?? null])).toEqual([
      ["ingested", null],
      ["duplicate", "F1"],
    ]);
    expect(res.tables).toHaveLength(1);
    expect(res.issues.map((i) => i.kind)).toEqual(["duplicate_file"]);
  });

  it("rejects archives with a clear message", async () => {
    const res = await ingest([{ name: "bundle.zip", bytes: fx("docs/archive.zip") }]);
    expect(res.files[0]?.status).toBe("rejected");
    expect(res.issues[0]).toMatchObject({ kind: "archive_rejected", message: expect.stringContaining("not supported") });
  });

  it("enforces per-file, per-job and file-count limits without failing the job", async () => {
    const a = { name: "a.txt", bytes: text("x".repeat(100)) };
    const b = { name: "b.txt", bytes: text("y".repeat(100)) };
    const c = { name: "c.txt", bytes: text("z".repeat(10)) };
    const res = await ingest([a, b, c], { limits: { maxFileBytes: 150, maxJobBytes: 150, maxFiles: 2 } });
    expect(res.files.map((f) => f.status)).toEqual(["ingested", "rejected", "ingested"]);
    const res2 = await ingest([a, c, { name: "d.txt", bytes: text("d") }], { limits: { maxFiles: 2 } });
    expect(res2.files.map((f) => f.status)).toEqual(["ingested", "ingested", "rejected"]);
    expect(res2.issues.map((i) => i.kind)).toEqual(["too_many_files"]);
  });

  it("rejects ZIP-based files that decompress beyond the limit", async () => {
    const res = await ingest([{ name: "big.xlsx", bytes: fx("xlsx/01-simple.xlsx") }], { limits: { maxZipUncompressedBytes: 100 } });
    expect(res.files[0]?.status).toBe("rejected");
    expect(res.issues[0]?.kind).toBe("too_large");
  });

  it("turns corrupted and unsupported files into issues, never a crash", async () => {
    const res = await ingest([
      { name: "bad.xlsx", bytes: fx("xlsx/16-corrupted.xlsx") },
      { name: "bad.pdf", bytes: fx("docs/corrupted.pdf") },
      { name: "bad.docx", bytes: fx("docs/corrupted.docx") },
      { name: "old.doc", bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]) },
      { name: "ok.tsv", bytes: fx("csv/02-tabs.tsv") },
    ]);
    expect(res.issues.map((i) => [i.file, i.kind])).toEqual([
      ["bad.xlsx", "unreadable_file"],
      ["bad.pdf", "unreadable_file"],
      ["bad.docx", "unreadable_file"],
      ["old.doc", "unsupported_type"],
    ]);
    expect(res.tables).toHaveLength(1);
  });

  it("a parse that times out leaves nothing behind, even after it would have finished", async () => {
    const slowDocling = {
      convertPdf: (_b: Uint8Array, _n: string, signal?: AbortSignal) =>
        new Promise<string[]>((resolve, reject) => {
          const t = setTimeout(() => resolve(["late text from a slow converter"]), 100);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        }),
    };
    let aborted = false;
    const res = await ingest([{ name: "scan.pdf", bytes: fx("docs/scanned.pdf") }], {
      docling: { convertPdf: (b, n, s) => (s?.addEventListener("abort", () => (aborted = true)), slowDocling.convertPdf(b, n, s)) },
      limits: { timeoutMs: 30 },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(res.files[0]?.status).toBe("failed");
    expect(res.issues.map((i) => i.message)).toEqual(["parsing scan.pdf took longer than 30 ms"]);
    expect(res.documents).toEqual([]);
    expect(res.documents_meta).toEqual([]);
    expect(aborted).toBe(true);
  });

  it("issue messages are one bounded line", async () => {
    const res = await ingest([{ name: "bad.docx", bytes: fx("docs/corrupted.docx") }]);
    const message = res.issues[0]?.message ?? "";
    expect(message).not.toMatch(/[\n\t]/);
    expect(message.length).toBeLessThanOrEqual(300);
  });

  it("times out slow work", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "parsing slow.pdf")).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
