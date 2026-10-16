// Presentation only (AGENTS.md §2.1): placeholders become the facts' stored values, rounded for reading.
export interface FactLike {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
  readonly label: string;
  readonly computation?: { readonly kind: string; readonly fn?: string };
}

const grouped = (v: number, d: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(v));

export function formatFact(f: FactLike): string {
  const sign = f.value < 0 ? "−" : "";
  if (f.unit === "percent") {
    const points = f.computation?.kind === "function" && ["delta", "benchmark_gap.v1", "share_shift"].includes(f.computation.fn ?? "");
    return points ? `${sign}${grouped(f.value, 1)} pp` : `${sign}${grouped(f.value, Math.abs(f.value) >= 100 ? 0 : 1)}%`;
  }
  const whole = Math.abs(f.value - Math.round(f.value)) < 0.005;
  return `${sign}${grouped(f.value, whole ? 0 : 2)}`;
}

export function fill(text: string, facts: ReadonlyMap<string, FactLike>): string {
  return text.replace(/\{\{(N\d+)\}\}/g, (m, id: string) => {
    const f = facts.get(id);
    return f ? formatFact(f) : m;
  });
}

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
