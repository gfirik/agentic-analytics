import { describe, expect, it } from "vitest";
import { unitWords } from "../src/header-units.ts";
import { headerUnits } from "../src/index.ts";

describe("headerUnits (scale and currency words in a header)", () => {
  const cases: [string, { scale?: string; currency?: string }][] = [
    ["value_thousand_uzs", { scale: "thousand", currency: "UZS" }],
    ["expenditure_mln_uzs", { scale: "million", currency: "UZS" }],
    ["retail_turnover_mln_uzs", { scale: "million", currency: "UZS" }],
    ["Revenue (USD mn)", { scale: "million", currency: "USD" }],
    ["amount_mln", { scale: "million" }],
    ["Amount, thousands", { scale: "thousand" }],
    ["Sales '000", { scale: "thousand" }],
    ["Sales k", { scale: "thousand" }],
    ["Выручка, тыс. сум", { scale: "thousand" }],
    ["Выручка (млн)", { scale: "million" }],
    ["Оборот млрд", { scale: "billion" }],
    ["jami ming", { scale: "thousand" }],
    ["total_bn_usd", { scale: "billion", currency: "USD" }],
    ["debt mlrd", { scale: "billion" }],
    ["Revenue (USD)", { currency: "USD" }],
    // Negative cases: words that merely contain a scale word or are not units.
    ["weight_kg", {}],
    ["monthly_total", {}],
    ["bank_balance", {}],
    ["thousandth_place", {}],
    ["milk_amount", {}],
    ["amount", {}],
    // Conflicts say nothing.
    ["amount_mln_bn", {}],
    ["amount_usd_eur", {}],
  ];
  for (const [header, want] of cases) it(`${header} → ${JSON.stringify(want)}`, () => expect(headerUnits(header)).toEqual(want));

  it("tokenises on underscore, space, hyphen, parentheses and comma", () => {
    expect(unitWords("Revenue (USD mn), net-of_tax")).toEqual(["revenue", "usd", "mn", "net", "of", "tax"]);
  });
});
