// The prose-number parser (accuracy.md §8.4), with hand-read expected values.
import { describe, expect, it } from "vitest";
import { claimedNumbers, proseNumbers, readings } from "../src/index.ts";

const brief = (text: string, question?: string) =>
  proseNumbers(text, question).map((n) => [n.raw, n.value, n.excluded ?? (n.signed ? "signed" : n.percent ? "percent" : "")]);

describe("proseNumbers", () => {
  it("reads thousands separators, currency, decimals, percents and scale words", () => {
    expect(brief("Revenue in April 2026 was $36,200, down 17.9% from March (44,100).")).toEqual([
      ["$36,200", 36200, ""],
      ["17.9%", 17.9, "percent"],
      ["44,100", 44100, ""],
    ]);
    // $1.2M = 1,200,000; 980k = 980,000.
    expect(claimedNumbers("Sales were $1.2M, then 980k, then 2.5 million.").map((n) => n.value)).toEqual([1_200_000, 980_000, 2_500_000]);
  });

  it("keeps an explicit sign, ASCII or typographic", () => {
    expect(brief("It was −7,900 (-17.9%) and +3%.")).toEqual([
      ["−7,900", -7900, "signed"],
      ["-17.9%", -17.9, "signed"],
      ["+3%", 3, "signed"],
    ]);
  });

  it("drops dates and periods: ISO months, d/m/y, quarters, month names, a bare year", () => {
    // Only 7,900 is an amount; 2026-03, 2026-04, 12/04/2026, Q2 2026, April 2026, 3 May and 2025 are dates.
    const text = "From 2026-03 to 2026-04 (12/04/2026, Q2 2026, April 2026, 3 May) it fell 7,900; in 2025 it rose.";
    expect(claimedNumbers(text).map((n) => n.value)).toEqual([7900]);
    expect(brief("in 2025 there were 2,048 orders")).toEqual([
      ["2025", 2025, "date"],
      ["2,048", 2048, ""],
    ]);
  });

  it("a day of the month is 1–31 and never the start of an amount", () => {
    expect(claimedNumbers("March 44,300 and April 12, 2026 was 9.").map((n) => n.value)).toEqual([44300, 9]);
  });

  it("marks ordinals and rank sizes, and never reads digits inside a name", () => {
    expect(brief("the top 10 customers, the 5 largest clients, 3rd best; t_t1 and Q2")).toEqual([
      ["10", 10, "rank"],
      ["5", 5, "rank"],
      ["3", 3, "ordinal"],
    ]);
  });

  it("marks numbers echoed from the question", () => {
    expect(brief("Revenue above 40,000 was 44,100.", "Which month had revenue above 40,000?")).toEqual([
      ["40,000", 40000, "echo"],
      ["44,100", 44100, ""],
    ]);
  });
});

describe("readings", () => {
  it("an unsigned number may stand for its negative, a percent for its fraction", () => {
    expect(readings({ value: 7900, signed: false, percent: false })).toEqual([7900, -7900]);
    expect(readings({ value: -7900, signed: true, percent: false })).toEqual([-7900]);
    expect(readings({ value: 12.5, signed: false, percent: true })).toEqual([12.5, -12.5, 0.125, -0.125]);
  });
});
