// Reading fact labels and claim text for the verifier (analysis-library §14): the metric, member and period a measured
// label names, the data names a label carries, and quoted spans of text.

/** `revenue_2026-04` or `revenue[customer=Hotel Group LLC]_2026-04` → metric, member filter, period. */
export function parseMeasured(label: string): { metric: string; where: string | undefined | null; period: string } | undefined {
  const m = /^([A-Za-z0-9_]+)(?:\[([^=\]]+)=(.*)\])?_(\d{4}(?:-\d{2}){0,2}|\d{4}-[QW]\d{1,2})$/.exec(label);
  if (!m) return undefined;
  const [, metric, dim, value, period] = m;
  // "(other)" is a NOT IN over the kept members, which the label doesn't carry: not re-derivable (null).
  const where =
    dim === undefined
      ? undefined
      : value === "(other)"
        ? null
        : value === "(none)"
          ? `${dim} IS NULL`
          : `${dim} = '${(value ?? "").replace(/'/g, "''")}'`;
  return { metric: metric as string, where, period: period as string };
}

/**
 * The names a fact label carries from the data (V1's quoted-digits rule): the whole label, member values of
 * `metric[dim=value]_period`, and the member of a decomposition fact `… by dim:kind:value`.
 */
export function dataNames(label: string): string[] {
  return [
    label,
    ...[...label.matchAll(/\[[^=\]]+=([^\]]+)\]/g)].map((m) => m[1] ?? ""),
    ...[...label.matchAll(/ by [^:]+:[a-z_]+:(.+)$/g)].map((m) => m[1] ?? ""),
  ];
}

/** Text inside quotation marks (“…” or "…"). */
export function quotedSpans(text: string): string[] {
  return [...text.matchAll(/“([^”]*)”|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? "");
}
