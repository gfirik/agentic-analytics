// The currency and scale a money fact inherits from the metric it measures (report-schema §3). The value is never
// multiplied: the scale only names what the value is in ("17,776,691.7 million UZS").
import type { Fact, MetricDef } from "@agentic-analytics/schema";

export function moneyUnits(def: Pick<MetricDef, "currency" | "scale"> | undefined, unit: string): Pick<Fact, "currency" | "scale"> {
  if (unit !== "currency" || !def) return {};
  return { ...(def.currency ? { currency: def.currency } : {}), ...(def.scale ? { scale: def.scale } : {}) };
}
