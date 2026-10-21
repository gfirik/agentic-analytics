// Markdown and plain-text sections (ingest spec, documents): offsets into the text and heading paths.
import { describe, expect, it } from "vitest";
import { sectionsFromText } from "../src/docs/sections.ts";

describe("sectionsFromText", () => {
  it("keeps the headings of a Markdown file saved with CRLF line endings", () => {
    const text = "# Q1 notes\r\nIntro line.\r\n## Wholesale\r\nOrders fell.\r\n";
    const sections = sectionsFromText(text, true);
    expect(sections.map((s) => s.heading_path)).toEqual([["Q1 notes"], ["Q1 notes", "Wholesale"]]);
    // Offsets still point at the same characters.
    for (const s of sections) expect(text.slice(s.char_start, s.char_end)).toBe(s.text);
    expect(sections[1]?.text).toContain("Orders fell.");
  });
});
