// The fetch script's checksum verification and the derivations, with an injected fetch and an in-memory folder:
// no network. Expected values are computed by hand from the tiny files built here.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  deriveCardSpendByIndustry,
  deriveOnlineRetailSample,
  type FetchDeps,
  fetchDataset,
  keepInvoice,
  parseRealAnswers,
  REAL_DATASETS,
  type RealDataset,
  serialToIso,
  sha256,
  verifySha256,
} from "../src/index.ts";

const utf8 = (s: string) => new TextEncoder().encode(s);

/** A ZIP archive with one entry, written by SheetJS's container writer. */
function zip(name: string, content: Uint8Array): Uint8Array {
  const c = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(c, name, content);
  return new Uint8Array(XLSX.CFB.write(c, { fileType: "zip", type: "array" }) as ArrayBuffer);
}

const ENTRY = utf8("a,b\n1,2\n3,4\n");
const DERIVED = utf8("a,b\n3,4\n");
const ARCHIVE = zip("table.csv", ENTRY);

function dataset(over: Partial<RealDataset["download"]> = {}, derivedSha = sha256(DERIVED)): RealDataset {
  return {
    id: "toy",
    title: "Toy",
    publisher: "Test",
    page: "https://example.org/toy",
    licence: { name: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/", evidence: "public domain" },
    citation: "Toy (2026).",
    download: {
      url: "https://example.org/toy.zip",
      sha256: sha256(ARCHIVE),
      bytes: ARCHIVE.length,
      entry: "table.csv",
      entrySha256: sha256(ENTRY),
      ...over,
    },
    derived: {
      file: "toy.csv",
      sha256: derivedSha,
      how: "the last row",
      derive: (e) => utf8(new TextDecoder().decode(e).replace("1,2\n", "")),
    },
  };
}

function deps(body: Uint8Array | undefined, status = 200) {
  const files = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const d: FetchDeps = {
    fetch: async (url) => {
      calls.push(url);
      return { ok: status === 200, status, arrayBuffer: async () => (body ?? new Uint8Array()).slice().buffer };
    },
    read: (name) => files.get(name),
    write: (name, bytes) => files.set(name, bytes),
    print: () => {},
  };
  return { d, files, calls };
}

describe("checksums", () => {
  it("accepts matching bytes and refuses anything else", () => {
    // SHA-256("abc"), FIPS 180-2 test vector
    const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256(utf8("abc"))).toBe(abc);
    expect(() => verifySha256("abc", utf8("abc"), abc)).not.toThrow();
    expect(() => verifySha256("abd", utf8("abd"), abc)).toThrow(expect.objectContaining({ code: "CHECKSUM_MISMATCH" }));
  });
});

describe("fetchDataset", () => {
  it("downloads, verifies the archive, the entry and the derived file, and writes both", async () => {
    const { d, files, calls } = deps(ARCHIVE);
    const r = await fetchDataset(dataset(), d);
    expect(r).toEqual({ id: "toy", file: "toy.csv", sha256: sha256(DERIVED), cached: false });
    expect(calls).toEqual(["https://example.org/toy.zip"]);
    expect(new TextDecoder().decode(files.get("toy.csv"))).toBe("a,b\n3,4\n");
    expect(sha256(files.get("toy.zip") ?? new Uint8Array())).toBe(sha256(ARCHIVE));
  });

  it("fails loudly on a changed download and writes nothing", async () => {
    const { d, files } = deps(zip("table.csv", utf8("a,b\n9,9\n")));
    await expect(fetchDataset(dataset(), d)).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    expect(files.size).toBe(0);
  });

  it("fails on a changed archive entry or derived file", async () => {
    await expect(fetchDataset(dataset({ entrySha256: "0".repeat(64) }), deps(ARCHIVE).d)).rejects.toMatchObject({
      code: "CHECKSUM_MISMATCH",
    });
    const { d, files } = deps(ARCHIVE);
    await expect(fetchDataset(dataset({}, "0".repeat(64)), d)).rejects.toMatchObject({ code: "CHECKSUM_MISMATCH" });
    expect(files.has("toy.csv")).toBe(false);
  });

  it("fails on an HTTP error and on a missing entry", async () => {
    await expect(fetchDataset(dataset(), deps(undefined, 404).d)).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
    await expect(fetchDataset(dataset({ entry: "other.csv" }), deps(ARCHIVE).d)).rejects.toMatchObject({ code: "ENTRY_MISSING" });
  });

  it("reuses verified files without downloading, and says how it repairs a corrupted cache", async () => {
    const lines: string[] = [];
    const { d: base, files, calls } = deps(ARCHIVE);
    const d = { ...base, print: (l: string) => lines.push(l) };
    files.set("toy.csv", DERIVED);
    files.set("toy.zip", ARCHIVE);
    expect((await fetchDataset(dataset(), d)).cached).toBe(true);
    expect(calls).toEqual([]);
    // A tampered derived file with a good archive: rebuilt from the archive, no download.
    files.set("toy.csv", utf8("tampered"));
    lines.length = 0;
    expect((await fetchDataset(dataset(), d)).cached).toBe(false);
    expect(calls).toEqual([]);
    expect(lines[0]).toBe("toy: checksum mismatch on toy.csv: rebuilding it from the cached toy.zip");
    // Both tampered: re-downloaded.
    files.set("toy.csv", utf8("tampered"));
    files.set("toy.zip", utf8("tampered"));
    lines.length = 0;
    expect((await fetchDataset(dataset(), d)).cached).toBe(false);
    expect(calls).toHaveLength(1);
    expect(lines.slice(0, 2)).toEqual([
      "toy: checksum mismatch on toy.csv and toy.zip: re-downloading",
      "toy: downloading https://example.org/toy.zip",
    ]);
    expect(files.get("toy.csv")).toEqual(DERIVED);
  });
});

describe("derivations", () => {
  it("keeps every 10th invoice by number, cancellations included", () => {
    expect(["489440", "C489450", "489441", "C489449", "A1"].map((i) => keepInvoice(i, 10))).toEqual([true, true, false, false, false]);
  });

  it("writes Excel serials as ISO text, to the second", () => {
    // 40148 is 2009-12-01; 0.3229166… of a day is 07:45:00
    expect(serialToIso(40148 + (7 * 60 + 45) / 1440)).toBe("2009-12-01 07:45:00");
    expect(serialToIso(40886.5347222222)).toBe("2011-12-09 12:50:00");
  });

  it("samples a two-sheet Online Retail workbook", () => {
    const head = ["Invoice", "StockCode", "Description", "Quantity", "InvoiceDate", "Price", "Customer ID", "Country"];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        head,
        [489440, "22350", "CAT BOWL ", 8, 40148.40486111111, 2.55, 18087, "United Kingdom"],
        [489441, "X", "skip", 1, 40148.5, 1, null, "UK"],
      ]),
      "Year 2009-2010",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([head, ["C489450", "22087", 'BUNTING, "LACE"', -12, 40148.44166666667, 2.95, null, "Australia"]]),
      "Year 2010-2011",
    );
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    expect(deriveOnlineRetailSample(bytes, 10)).toBe(
      [
        head.join(","),
        "489440,22350,CAT BOWL ,8,2009-12-01 09:43:00,2.55,18087,United Kingdom",
        'C489450,22087,"BUNTING, ""LACE""",-12,2009-12-01 10:36:00,2.95,,Australia',
        "",
      ].join("\n"),
    );
  });

  it("refuses a workbook whose header is not Online Retail II's", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Invoice", "Amount"],
        [489440, 5],
      ]),
      "Sheet1",
    );
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    expect(() => deriveOnlineRetailSample(bytes)).toThrow(expect.objectContaining({ name: "RealDataError", code: "UNEXPECTED_LAYOUT" }));
  });

  it("keeps only the monthly actual industry-group series, lines unchanged", () => {
    const csv =
      "Series_reference,Period,Data_value\nECTA.S1GA1,2002.03,1\nECTM.S1GA1,2002.10,2182.6\nECTM.S1GS1,2002.10,5\nECTM.S1GA8,2002.11,7\n";
    expect(deriveCardSpendByIndustry(csv)).toBe("Series_reference,Period,Data_value\nECTM.S1GA1,2002.10,2182.6\nECTM.S1GA8,2002.11,7\n");
  });

  it("takes only series S1GA1–S1GA8, the documented slice (S1GA0 and S1GA9 are not in it)", () => {
    const csv = "Series_reference,Period,Data_value\nECTM.S1GA0,2002.10,1\nECTM.S1GA5,2002.10,2\nECTM.S1GA9,2002.10,3\n";
    expect(deriveCardSpendByIndustry(csv)).toBe("Series_reference,Period,Data_value\nECTM.S1GA5,2002.10,2\n");
  });
});

describe("manifest and answer files", () => {
  const dir = join(import.meta.dirname, "..", "answers");
  const answers = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") && !f.endsWith(".metrics.yaml"))
    .map((f) => parseRealAnswers(readFileSync(join(dir, f), "utf8")));

  it("has an answer file for every dataset, reading its derived file", () => {
    expect(answers.map((a) => a.dataset).sort()).toEqual(REAL_DATASETS.map((d) => d.id).sort());
    for (const a of answers) expect(a.file).toBe(REAL_DATASETS.find((d) => d.id === a.dataset)?.derived.file);
    for (const a of answers) if (a.confirmed_metrics) expect(existsSync(join(dir, a.confirmed_metrics))).toBe(true);
  });

  it("pins every checksum and credits every licence", () => {
    for (const d of REAL_DATASETS) {
      for (const h of [d.download.sha256, d.download.entrySha256, d.derived.sha256]) expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(d.licence.name).toBe("CC BY 4.0");
      expect(d.citation.length).toBeGreaterThan(20);
    }
  });
});
