import { describe, expect, it } from "vitest";
import type { SectionInput } from "../src/index.ts";
import { chooseStemmer, chunkSections, chunkSpans, estimateTokens, prefixOf, quoteFor, rrf } from "../src/index.ts";

// 10 words → ceil(10 × 1.3) = 13 tokens
const sentence = (i: number) => `Sentence ${i} has exactly ten words in it for counting.`;

describe("token estimate", () => {
  it("is words × 1.3, rounded up", () => {
    expect(estimateTokens(sentence(1))).toBe(13);
    expect(estimateTokens("  one  two\nthree ")).toBe(4); // 3 × 1.3 = 3.9
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkSpans (spec §1)", () => {
  it("a section within the budget is one chunk, trimmed", () => {
    expect(chunkSpans("\n  Short text.  \n")).toEqual([{ start: 3, end: 14 }]);
  });

  it("splits a long section on lines with 15% overlap, every chunk within the budget", () => {
    // 100 lines of 13 tokens = 1,300 tokens; budget 130 → 10 lines per chunk; overlap 15% of 130 = 19 tokens → 1 line
    const text = Array.from({ length: 100 }, (_, i) => sentence(i)).join("\n");
    const spans = chunkSpans(text, { maxTokens: 130 });
    for (const s of spans) expect(estimateTokens(text.slice(s.start, s.end))).toBeLessThanOrEqual(130);
    // first chunk = lines 0–9; the next starts at line 9 (one line of overlap): 10 lines advance 9 each time
    expect(text.slice(spans[0]?.start, spans[0]?.end).split("\n")).toHaveLength(10);
    expect(text.slice(spans[1]?.start, spans[1]?.end).startsWith(sentence(9))).toBe(true);
    // 0–9, 9–18, …, 81–90, 90–99 → 11 chunks covering every line
    expect(spans).toHaveLength(11);
    expect(spans.at(-1)?.end).toBe(text.length);
  });

  it("paragraphs separated by blank lines are units; an oversize paragraph splits into sentences", () => {
    const para = Array.from({ length: 12 }, (_, i) => sentence(i)).join(" "); // 156 tokens
    const text = `Intro line here.\n\n${para}\n\nOutro line here.`;
    const spans = chunkSpans(text, { maxTokens: 100, overlap: 0 });
    for (const s of spans) expect(estimateTokens(text.slice(s.start, s.end))).toBeLessThanOrEqual(100);
    // every sentence boundary is respected: no chunk starts mid-sentence
    for (const s of spans) expect(text.slice(s.start, s.end)).toMatch(/^(Intro|Sentence|Outro)/);
  });

  it("never splits a table; an oversize table is its own chunk", () => {
    const table = [
      "| Zone | Area | Fee |",
      "| --- | --- | --- |",
      ...Array.from({ length: 40 }, (_, i) => `| Z${i} | area ${i} | ${i} USD |`),
    ].join("\n");
    const text = `Fees by zone:\n\n${table}\n\nOrders over 150 USD ship free.`;
    const spans = chunkSpans(text, { maxTokens: 60 });
    const tableSpans = spans.filter((s) => text.slice(s.start, s.end).includes("| Zone |"));
    expect(tableSpans).toHaveLength(1);
    expect(text.slice(tableSpans[0]?.start, tableSpans[0]?.end)).toBe(table);
  });
});

describe("chunkSections", () => {
  const email: SectionInput = {
    source_id: "D2",
    file: "email-brightads.eml",
    kind: "email",
    heading_path: ["Catalogue print run"],
    char_start: 0,
    char_end: 30,
    text: "Hello,\n\nWe are moving the run.",
    email: {
      from: "Lena <lena@brightads.example>",
      to: "orders@inkwell.example",
      date: "2026-05-21T11:02:00.000Z",
      subject: "Catalogue print run",
    },
  };
  const page: SectionInput = {
    source_id: "D9",
    file: "maintenance-log.pdf",
    kind: "document",
    page: 2,
    heading_path: ["Log"],
    char_start: 40,
    char_end: 84,
    text: "2 Jun: print head cleaned.\n9 Jun: rollers.",
  };

  it("prefixes: file · heading · page for documents; sender, recipient, subject, date for emails", () => {
    expect(prefixOf(page)).toBe("[maintenance-log.pdf · Log · p. 2]");
    expect(prefixOf(email)).toBe(
      "[email-brightads.eml · from Lena <lena@brightads.example> · to orders@inkwell.example · Catalogue print run · 2026-05-21]",
    );
  });

  it("chunk offsets are absolute and the chunk text is the exact source slice", () => {
    const [a, b] = chunkSections([email, page]);
    expect(a).toMatchObject({ id: "C1", source_id: "D2", char_start: 0, char_end: 30, text: email.text });
    expect(b).toMatchObject({ id: "C2", source_id: "D9", page: 2, char_start: 40, char_end: 82 });
    expect(b?.text).toBe(page.text.slice(0, 42));
  });
});

describe("citation quotes (spec §4)", () => {
  const chunk = { source_id: "D1", page: 3, char_start: 100, char_end: 100 + 620, text: `${"word ".repeat(124)}` };

  it("is an exact substring with its absolute offsets", () => {
    const q = quoteFor(chunk, 105, 114);
    expect(q).toEqual({ source_id: "D1", page: 3, char_start: 105, char_end: 114, quote: "word word" });
  });

  it("caps at 300 characters on a word boundary", () => {
    const q = quoteFor(chunk, 100, 720);
    expect(q.quote.length).toBeLessThanOrEqual(300);
    expect(chunk.text.startsWith(q.quote)).toBe(true);
    expect(q.quote.endsWith("word")).toBe(true);
    expect(q.char_end - q.char_start).toBe(q.quote.length);
  });

  it("rejects spans outside the chunk", () => {
    expect(() => quoteFor(chunk, 90, 110)).toThrowError(expect.objectContaining({ code: "BAD_SPAN" }));
  });
});

describe("reciprocal rank fusion (spec §3, k = 60)", () => {
  it("hand-computed scores and order", () => {
    // a: 1/61 + 1/63 = 0.0163934 + 0.0158730 = 0.0322664
    // b: 1/62 + 1/61 = 0.0161290 + 0.0163934 = 0.0325224 → first
    // c: 1/63 = 0.0158730; d: 1/62 = 0.0161290
    const f = rrf([
      ["a", "b", "c"],
      ["b", "d", "a"],
    ]);
    expect(f.map((x) => x.id)).toEqual(["b", "a", "d", "c"]);
    expect(f[0]?.score).toBeCloseTo(1 / 62 + 1 / 61, 12);
    expect(f[1]?.score).toBeCloseTo(1 / 61 + 1 / 63, 12);
    expect(f.find((x) => x.id === "d")?.ranks).toEqual([undefined, 2]);
  });

  it("an empty lane (no BM25) leaves the other lane's order", () => {
    expect(rrf([[], ["x", "y"]]).map((x) => x.id)).toEqual(["x", "y"]);
  });
});

describe("stemmer follows the corpus script", () => {
  it("Russian when most letters are Cyrillic, else English", () => {
    expect(chooseStemmer(["Запасы бумаги закончились", "A4"])).toBe("russian");
    expect(chooseStemmer(["Paper ran out on 3 June", "Тонер"])).toBe("english");
  });
});
