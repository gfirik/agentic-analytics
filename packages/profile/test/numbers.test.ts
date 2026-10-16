import { describe, expect, it } from "vitest";
import { columnNames, decimalEvidence, detectCurrency, detectDecimal, parseNumber, snakeCase, transliterate } from "../src/index.ts";

describe("parseNumber (spec §6 locales)", () => {
  it.each([
    ["1 234,56", ",", 1234.56],
    ["1.234,56", ",", 1234.56],
    ["1,234.56", ".", 1234.56],
    ["1234", ".", 1234],
    ["(12)", ".", -12],
    ["-7,5", ",", -7.5],
    ["−3", ".", -3],
    ["1 050,25", ",", 1050.25],
  ] as const)("%s with %s decimal → %d", (raw, dec, expected) => {
    expect(parseNumber(raw, dec)?.value).toBeCloseTo(expected, 10);
  });

  it("reads percentages as fractions and keeps the percent flag", () => {
    // 3,4 % → 3.4 / 100 = 0.034
    expect(parseNumber("3,4 %", ",")).toEqual({ value: 0.034, percent: true });
  });

  it("strips and reports currency symbols and codes", () => {
    expect(parseNumber("$1,200.50")).toEqual({ value: 1200.5, percent: false, currency: "USD" });
    expect(parseNumber("1 200 сум", ",")).toMatchObject({ value: 1200, currency: "UZS" });
    expect(parseNumber("UZS 15 000", ",")).toMatchObject({ value: 15000, currency: "UZS" });
    expect(parseNumber("450 so'm", ",")).toMatchObject({ value: 450, currency: "UZS" });
    expect(parseNumber("€9,50", ",")).toMatchObject({ value: 9.5, currency: "EUR" });
    expect(detectCurrency("1000 ₽")).toBe("RUB");
  });

  it("rejects text", () => {
    expect(parseNumber("n/a")).toBeUndefined();
    expect(parseNumber("12 apples")).toBeUndefined();
    expect(parseNumber("")).toBeUndefined();
  });
});

describe("decimal separator detection (per column, majority)", () => {
  it("reads evidence from single values", () => {
    expect(decimalEvidence("1.234,56")).toBe(",");
    expect(decimalEvidence("1,234.56")).toBe(".");
    expect(decimalEvidence("980,00")).toBe(",");
    expect(decimalEvidence("24.6")).toBe(".");
    expect(decimalEvidence("1.234.567")).toBe(",");
    expect(decimalEvidence("1,234")).toBeUndefined();
  });

  it("decides by majority and defaults to a dot", () => {
    expect(detectDecimal(["1 234,50", "980,00", "1 050,25"])).toBe(",");
    expect(detectDecimal(["1,234", "2,500"])).toBe(".");
  });
});

describe("names", () => {
  it("snake-cases and transliterates headers", () => {
    expect(snakeCase("Sales / Revenue")).toBe("sales_revenue");
    expect(snakeCase("Количество")).toBe("kolichestvo");
    expect(snakeCase("Order ID")).toBe("order_id");
    expect(snakeCase("2026 plan")).toBe("c_2026_plan");
    expect(snakeCase("  ")).toBe("column");
    expect(transliterate("ООО Ўзбек")).toBe("OOO O'zbek");
  });

  it("keeps names unique within a table", () => {
    expect(columnNames(["Month", "Month", "Revenue"])).toEqual(["month", "month_2", "revenue"]);
  });
});
