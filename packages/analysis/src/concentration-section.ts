// The concentration section of the report (report-schema §5b, analysis-library §11): per pack dimension, the Pareto
// classes of each window, the top-N shares and HHI of each period stated, and the trend facts. Nothing is computed here:
// every cell is a fact `sectionFacts` stored under a fixed label (§14), looked up by that label.
import type { Concentration } from "@agentic-analytics/schema";
import { statLabel } from "./concentration-facts.ts";
import type { ConcentrationSetup } from "./concentration-pack.ts";
import { CLASSES, TOP_NS } from "./pareto.ts";

/** A section entry as the analysis stores it: the dependence finding is still the insight (`I…`) it will become. */
export type ConcentrationEntry = Omit<Concentration, "dependence"> & { readonly dependence_insight?: string };

/**
 * The entries of the pack's dimensions. `byLabel` maps the job's fact labels to fact ids; `dependence` is the insight id of
 * a `dependence.v1` finding per dimension column.
 */
export function concentrationSection(
  setup: ConcentrationSetup,
  byLabel: ReadonlyMap<string, string>,
  dependence: ReadonlyMap<string, string>,
): ConcentrationEntry[] {
  const pack = setup.pack;
  if (!pack) return [];
  return setup.dimensions.flatMap((d) => {
    const at = (part: Parameters<typeof statLabel>[0], suffix: string) => byLabel.get(statLabel(part, d.dim, suffix));
    const windows = [
      { window: "ttm" as const, w: d.plan.windows.ttm },
      ...(d.plan.windows.ttmPrev ? [{ window: "ttm_prev" as const, w: d.plan.windows.ttmPrev }] : []),
    ];
    const pareto = windows.flatMap(({ window, w }) => {
      const members = at("members", window);
      if (!members) return [];
      const classes = CLASSES.flatMap((c) => {
        const [count, value, share] = [at(`${c}_count`, window), at(`${c}_value`, window), at(`${c}_share`, window)];
        return count && value && share ? [{ class: c.toUpperCase() as "A" | "B" | "C", count, value, share }] : [];
      });
      const extra = (part: "nonpositive_count" | "nonpositive_value" | "unkeyed_value") => {
        const id = at(part, window);
        return id ? { [part]: id } : {};
      };
      return [
        {
          window,
          from: w.from,
          to: w.to,
          classes,
          members,
          ...extra("nonpositive_count"),
          ...extra("nonpositive_value"),
          ...extra("unkeyed_value"),
        },
      ];
    });
    // The periods the section states (the plan's refs), in order: the latest period, the trailing year, each calendar year,
    // then the trend's periods (HHI and top-1 only).
    const suffixes = [...new Set([...d.plan.refs.map((r) => r.suffix), ...d.plan.trend.periods])].filter((s) => s !== "ttm_prev");
    const shares = suffixes.flatMap((suffix) => {
      const hhi = at("hhi", suffix);
      if (!hhi) return [];
      const tops = Object.fromEntries(
        TOP_NS.flatMap((n) => (at(`top${n}_share`, suffix) ? [[`top${n}`, at(`top${n}_share`, suffix)]] : [])),
      );
      return [{ period: suffix, ...tops, hhi }];
    });
    const t = (part: "hhi" | "top1_share", stat: "slope" | "p_value") => byLabel.get(`${part}.${d.dim}.trend.${stat}`);
    const [hhiSlope, hhiP, topSlope, topP] = [t("hhi", "slope"), t("hhi", "p_value"), t("top1_share", "slope"), t("top1_share", "p_value")];
    const dep = dependence.get(d.column);
    return [
      {
        metric_id: pack.id,
        dimension: d.dim,
        column: d.column,
        pareto,
        shares,
        ...(hhiSlope && hhiP
          ? { trend: { hhi_slope: hhiSlope, hhi_p: hhiP, ...(topSlope && topP ? { top1_slope: topSlope, top1_p: topP } : {}) } }
          : {}),
        ...(dep ? { dependence_insight: dep } : {}),
      },
    ];
  });
}
