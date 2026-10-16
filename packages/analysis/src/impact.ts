// Impact ranges (docs/specs/analysis-library.md §5). The engine never gives point forecasts: an action's
// impact is a scenario computed in code from an allowed set, with parameters inside fixed bounds, net of the
// cost the action implies, labelled "scenario estimate", with its formula and inputs stored.
import { type Calc, calcRef, type Ref, type Unit } from "./types.ts";

export class ImpactError extends Error {
  constructor(
    readonly code: "PARAM_OUT_OF_RANGE" | "BAD_RANGE" | "UNKNOWN_SCENARIO",
    message: string,
  ) {
    super(message);
    this.name = "ImpactError";
  }
}

export interface Amount {
  readonly ref: Ref;
  readonly value: number;
}

export type Scenario = ScenarioKind & {
  /**
   * Evidence for the chosen parameters (e.g. a supplier's quoted discount, a past recovery rate): refs to facts
   * that become the inputs of the `scenario_param` facts, so a parameter is never an unexplained number.
   */
  readonly justifiedBy?: readonly Ref[];
};

type ScenarioKind =
  /** Recover a share of a lost amount (0.3–0.9), net of a discount the action gives (0–0.5). */
  | { readonly type: "recover_share"; readonly lost: Amount; readonly low: number; readonly high: number; readonly discount?: number }
  /** Change a price by −15%…+15% on a revenue base (no volume response is assumed). */
  | { readonly type: "price_change"; readonly revenue: Amount; readonly low: number; readonly high: number }
  /** Bring an excess rate back toward its baseline: a share (0–1) of the excess cost is removed. */
  | {
      readonly type: "remove_excess_rate";
      readonly current: Amount;
      readonly baseline: Amount;
      readonly base: Amount;
      readonly low: number;
      readonly high: number;
    }
  /** Retain a share (0.3–0.9) of value at risk, net of a retention cost share (0–0.5). */
  | { readonly type: "retain_at_risk"; readonly atRisk: Amount; readonly low: number; readonly high: number; readonly cost?: number };

const BOUNDS: Record<Scenario["type"], readonly [number, number]> = {
  recover_share: [0.3, 0.9],
  price_change: [-0.15, 0.15],
  remove_excess_rate: [0, 1],
  retain_at_risk: [0.3, 0.9],
};
const COST_BOUNDS: readonly [number, number] = [0, 0.5];

export interface ImpactRange {
  readonly method: `impact.v1:${Scenario["type"]}`;
  readonly label: "scenario estimate";
  readonly formula: string;
  readonly low: Calc;
  readonly high: Calc;
  /** The scenario parameters as numbers (each becomes a `scenario_param` fact). */
  readonly params: readonly Calc[];
  /** Every input the range depends on (measured facts and parameters). */
  readonly inputs: readonly Ref[];
}

function check(name: string, v: number, [lo, hi]: readonly [number, number]): void {
  if (!Number.isFinite(v) || v < lo || v > hi)
    throw new ImpactError("PARAM_OUT_OF_RANGE", `${name} = ${v} is outside the allowed range ${lo}…${hi}`);
}

export function impactRange(s: Scenario, unit: Unit = "currency"): ImpactRange {
  const bounds = BOUNDS[s.type];
  if (!bounds) throw new ImpactError("UNKNOWN_SCENARIO", "unknown scenario type");
  check("low", s.low, bounds);
  check("high", s.high, bounds);
  if (s.low > s.high) throw new ImpactError("BAD_RANGE", `low (${s.low}) is above high (${s.high})`);
  const param = (name: string, label: string, value: number): Calc => ({
    name,
    label,
    value: value * 100,
    unit: "percent",
    fn: "scenario_param",
    inputs: s.justifiedBy ?? [],
  });
  const method = `impact.v1:${s.type}` as const;
  const make = (name: string, value: number, inputs: readonly Ref[]): Calc => ({
    name,
    label: `${name === "impact_low" ? "low" : "high"} scenario estimate`,
    value,
    unit,
    fn: method,
    inputs,
  });

  switch (s.type) {
    case "recover_share": {
      const discount = s.discount ?? 0;
      check("discount", discount, COST_BOUNDS);
      const params = [
        param("param_low", "share recovered (low)", s.low),
        param("param_high", "share recovered (high)", s.high),
        param("param_cost", "discount", discount),
      ];
      const common = [s.lost.ref, calcRef("param_cost")];
      return {
        method,
        label: "scenario estimate",
        formula: "|lost| × share recovered × (1 − discount)",
        low: make("impact_low", Math.abs(s.lost.value) * s.low * (1 - discount), [...common, calcRef("param_low")]),
        high: make("impact_high", Math.abs(s.lost.value) * s.high * (1 - discount), [...common, calcRef("param_high")]),
        params,
        inputs: [s.lost.ref, ...params.map((p) => calcRef(p.name))],
      };
    }
    case "price_change": {
      const params = [param("param_low", "price change (low)", s.low), param("param_high", "price change (high)", s.high)];
      return {
        method,
        label: "scenario estimate",
        formula: "revenue × price change (volume held constant)",
        low: make("impact_low", s.revenue.value * s.low, [s.revenue.ref, calcRef("param_low")]),
        high: make("impact_high", s.revenue.value * s.high, [s.revenue.ref, calcRef("param_high")]),
        params,
        inputs: [s.revenue.ref, ...params.map((p) => calcRef(p.name))],
      };
    }
    case "remove_excess_rate": {
      // Rates are in percentage points: excess cost = (current − baseline) / 100 × base.
      const excess = ((s.current.value - s.baseline.value) / 100) * s.base.value;
      const params = [
        param("param_low", "share of the excess removed (low)", s.low),
        param("param_high", "share of the excess removed (high)", s.high),
      ];
      const common = [s.current.ref, s.baseline.ref, s.base.ref];
      return {
        method,
        label: "scenario estimate",
        formula: "(current rate − baseline rate) / 100 × base × share removed",
        low: make("impact_low", excess * s.low, [...common, calcRef("param_low")]),
        high: make("impact_high", excess * s.high, [...common, calcRef("param_high")]),
        params,
        inputs: [...common, ...params.map((p) => calcRef(p.name))],
      };
    }
    case "retain_at_risk": {
      const cost = s.cost ?? 0;
      check("cost", cost, COST_BOUNDS);
      const params = [
        param("param_low", "share retained (low)", s.low),
        param("param_high", "share retained (high)", s.high),
        param("param_cost", "retention cost", cost),
      ];
      const common = [s.atRisk.ref, calcRef("param_cost")];
      return {
        method,
        label: "scenario estimate",
        formula: "value at risk × share retained × (1 − cost)",
        low: make("impact_low", s.atRisk.value * s.low * (1 - cost), [...common, calcRef("param_low")]),
        high: make("impact_high", s.atRisk.value * s.high * (1 - cost), [...common, calcRef("param_high")]),
        params,
        inputs: [s.atRisk.ref, ...params.map((p) => calcRef(p.name))],
      };
    }
  }
}
