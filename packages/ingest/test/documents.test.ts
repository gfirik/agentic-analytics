import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDoclingClient, DOCLING_PAGE_BREAK, ingest } from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const fx = (p: string) => ({ name: p.split("/").pop() ?? p, bytes: new Uint8Array(readFileSync(join(root, p))) });

describe("documents", () => {
  it("PDF: one section per page with page numbers and offsets that slice the page text", async () => {
    const res = await ingest([fx("fixtures/docs/report.pdf")]);
    expect(res.documents.map((d) => [d.page, d.char_start, d.text.split("\n")[0]])).toEqual([
      [1, 0, "Quarterly note"],
      [2, 0, "Outlook"],
    ]);
    const meta = res.documents_meta[0];
    for (const d of res.documents) expect(meta?.texts[(d.page ?? 1) - 1]?.slice(d.char_start, d.char_end)).toBe(d.text);
  });

  it("PDF without a text layer: needs_ocr when Docling isn't configured", async () => {
    const res = await ingest([fx("fixtures/docs/scanned.pdf")]);
    expect(res.issues).toMatchObject([{ kind: "needs_ocr", message: expect.stringContaining("docling profile") }]);
    expect(res.documents).toEqual([]);
  });

  it("PDF without a text layer: goes through Docling when configured", async () => {
    const calls: string[] = [];
    const stub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect(init?.body).toBeInstanceOf(FormData);
      return Response.json({ document: { md_content: `# Scan page one\nText A${DOCLING_PAGE_BREAK}Text B` } });
    }) as typeof fetch;
    const res = await ingest([fx("fixtures/docs/scanned.pdf")], { docling: createDoclingClient("http://docling.test:5001/", stub) });
    expect(calls).toEqual(["http://docling.test:5001/v1/convert/file"]);
    expect(res.documents.map((d) => [d.page, d.text])).toEqual([
      [1, "# Scan page one\nText A"],
      [2, "Text B"],
    ]);
    expect(res.documents_meta[0]?.via).toBe("docling");
  });

  it("password-protected PDF becomes a password_protected issue", async () => {
    const res = await ingest([fx("fixtures/docs/protected.pdf")]);
    expect(res.issues.map((i) => i.kind)).toEqual(["password_protected"]);
  });

  it("DOCX: sections by heading with nested heading paths and offsets into the text", async () => {
    const res = await ingest([fx("fixtures/docs/notes.docx")]);
    expect(res.documents.map((d) => d.heading_path)).toEqual([
      ["Operations notes"],
      ["Operations notes", "Suppliers"],
      ["Operations notes", "Staff"],
      ["Appendix"],
    ]);
    const text = res.documents_meta[0]?.texts[0] ?? "";
    for (const d of res.documents) expect(text.slice(d.char_start, d.char_end)).toBe(d.text);
    expect(res.documents[1]?.text).toBe("Suppliers\nSwitched packaging supplier in April.\nValve bags from the new vendor.");
  });

  it("EML: headers and body; the CSV attachment re-enters intake as a table", async () => {
    const res = await ingest([fx("fixtures/docs/message.eml")]);
    expect(res.documents_meta[0]?.email).toMatchObject({
      from: "Buyer <buyer@hotel.example>",
      subject: "Revised order",
      date: "2026-04-13T05:00:00.000Z",
    });
    expect(res.documents[0]).toMatchObject({
      kind: "eml",
      heading_path: ["Revised order"],
      text: expect.stringContaining("revised quantities"),
    });
    expect(res.files.map((f) => [f.name, f.kind, f.parent ?? null])).toEqual([
      ["message.eml", "eml", null],
      ["order.csv", "csv", "F1"],
    ]);
    expect(res.tables[0]?.columns.map((c) => c.name)).toEqual(["sku", "qty"]);
  });

  it("Markdown and plain text: sections by heading or blank line", async () => {
    const res = await ingest([fx("fixtures/docs/notes.md"), fx("fixtures/docs/memo.txt")]);
    expect(res.documents.map((d) => [d.kind, d.heading_path.join(" > "), d.text.split("\n")[0]])).toEqual([
      ["md", "Plan", "# Plan"],
      ["md", "Plan > Pricing", "## Pricing"],
      ["md", "Plan > Packaging", "## Packaging"],
      ["txt", "", "First paragraph about sales."],
      ["txt", "", "Second paragraph about refunds."],
    ]);
  });
});

describe("coffee-roaster-v1 (golden dataset)", () => {
  const dir = "evals/datasets/coffee-roaster-v1/files";
  const files = ["sales-2026.xlsx", "price-list.pdf", "email-0412.eml", "ops-notes.docx"].map((f) => fx(`${dir}/${f}`));

  it("yields the three table regions and four documents", async () => {
    const res = await ingest(files);
    expect(res.tables.map((t) => `${t.sheet}!${t.range}`)).toEqual(["Orders!A1:H6261", "Monthly!A1:F7", "Monthly!H1:L7"]);
    expect(res.tables[0]?.rows).toHaveLength(6260);
    expect(new Set(res.documents.map((d) => d.kind))).toEqual(new Set(["pdf", "eml", "docx"]));
    expect(res.issues).toEqual([]);
  });

  it("the golden report's quote spans point at the same text in the extracted documents", async () => {
    const res = await ingest(files);
    const report = JSON.parse(readFileSync(join(root, "packages/schema/test/fixtures/report.coffee-roaster.json"), "utf8")) as {
      sources: { id: string; file: string; locator: { page?: number; char_start?: number; char_end?: number } }[];
      findings: { claims: { citations: { source_id: string; quote?: string }[] }[] }[];
    };
    const quotes = new Map(
      report.findings
        .flatMap((f) => f.claims.flatMap((c) => c.citations))
        .filter((c) => c.quote)
        .map((c) => [c.source_id, c.quote]),
    );
    for (const id of ["S2", "S3", "S4"]) {
      const src = report.sources.find((s) => s.id === id);
      const fileId = res.files.find((f) => f.name === src?.file)?.id;
      const meta = res.documents_meta.find((m) => m.file_id === fileId);
      const text = meta?.texts[(src?.locator.page ?? 1) - 1] ?? "";
      expect(text.slice(src?.locator.char_start, src?.locator.char_end), id).toBe(quotes.get(id));
    }
  });
});
