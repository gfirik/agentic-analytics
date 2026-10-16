import { describe, expect, it } from "vitest";
import {
  builder,
  compileExpr,
  compileFilter,
  describeFilter,
  exprColumns,
  filterColumns,
  MetricLangError,
  parseExpression,
  parseFilter,
} from "../src/lang.ts";

const q = (n: string) => `"${n}"`;

describe("metric expressions", () => {
  it("parses arithmetic with precedence and compiles with parameters and guarded division", () => {
    const e = parseExpression("qty * unit_price - abs(discount) / 2");
    const b = builder();
    expect(compileExpr(e, b, q)).toBe('(("qty" * "unit_price") - (abs("discount") / NULLIF($1, 0)))');
    expect(b.params).toEqual([2]);
    expect(exprColumns(e)).toEqual(["qty", "unit_price", "discount"]);
  });

  it("rejects anything outside the grammar", () => {
    for (const bad of ["amount; DROP TABLE files", "sum(amount)", "Amount", "amount AS x", "(select 1)", "amount)"]) {
      expect(() => parseExpression(bad), bad).toThrow(MetricLangError);
    }
  });
});

describe("metric filters", () => {
  it("parses comparisons, IN, IS NULL and boolean logic; literals become parameters", () => {
    const f = parseFilter("status <> 'refunded' AND (channel IN ('wholesale', 'retail') OR qty >= 10) AND note IS NOT NULL");
    const b = builder();
    expect(compileFilter(f, b, q)).toBe('((("status" <> $1) AND (("channel" IN ($2, $3)) OR ("qty" >= $4))) AND ("note" IS NOT NULL))');
    expect(b.params).toEqual(["refunded", "wholesale", "retail", 10]);
    expect(filterColumns(f)).toEqual(["status", "channel", "qty", "note"]);
  });

  it("keeps quotes inside literals as data", () => {
    const b = builder();
    expect(compileFilter(parseFilter("customer = 'O''Brien''; DROP TABLE x; --'"), b, q)).toBe('("customer" = $1)');
    expect(b.params).toEqual(["O'Brien'; DROP TABLE x; --"]);
  });

  it("normalizes != and rejects malformed filters", () => {
    expect(compileFilter(parseFilter("status != 'x'"), builder(), q)).toBe('("status" <> $1)');
    for (const bad of [
      "status",
      "status = ",
      "'a' = 'b'",
      "status IS 'x'",
      "status LIKE 'x%'",
      "status = 'x' AND",
      "status = 'unterminated",
    ]) {
      expect(() => parseFilter(bad), bad).toThrow(MetricLangError);
    }
  });

  it("renders in plain language", () => {
    expect(describeFilter(parseFilter("status <> 'refunded'"))).toBe("status is not refunded");
    expect(describeFilter(parseFilter("channel IN ('wholesale') AND note IS NULL"))).toBe("channel is wholesale and note is empty");
    expect(describeFilter(parseFilter("channel NOT IN ('a', 'b')"))).toBe("channel is not one of a, b");
    expect(describeFilter(parseFilter("(status IS NULL OR status <> 'x') AND channel = 'a'"))).toBe(
      "(status is empty or status is not x) and channel is a",
    );
  });
});
