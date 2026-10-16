// V1's quoted-digits rule accepts a quoted span only when it is a whole name from the data. Hand-written labels.
import { describe, expect, it } from "vitest";
import { dataNames } from "../src/index.ts";

describe("dataNames (V1)", () => {
  it("takes member values from measured labels and from decomposition labels", () => {
    expect(dataNames("revenue[product=Espresso blend 1kg]_2026-04")).toContain("Espresso blend 1kg");
    expect(dataNames("contribution.v1 revenue 2026-04 by product:delta:House blend 250g")).toContain("House blend 250g");
    expect(dataNames("contribution.v1 revenue 2026-04 by customer:share:Hotel Group LLC")).toContain("Hotel Group LLC");
  });

  it("never yields a fragment: a period or a template version is not a name", () => {
    const names = [
      ...dataNames("revenue_2026-04"),
      ...dataNames("I5 trend_break.v1 revenue 2026-04:change"),
      ...dataNames("contribution.v1 revenue 2026-04 by product:delta:House blend 250g"),
    ];
    for (const fragment of ["04", "2026", "250g", "v1", "2026-04"]) expect(names, fragment).not.toContain(fragment);
  });
});
