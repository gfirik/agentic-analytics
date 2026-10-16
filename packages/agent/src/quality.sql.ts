// How many detail rows a column-level quality issue covers (report-schema §3: every number is a fact with its SQL).
// The same predicates as the profiling rules (packages/profile/src/profile.sql.ts), counted instead of listed.
import { ident, type Sql, sql, tableName } from "@agentic-analytics/store";

/**
 * The issue kinds whose rows a count can state, and the SQL that counts them; undefined for any other kind. A
 * `prefixed_id` count covers only the prefixes the profile flagged (a prefix as common as the plain numbers isn't).
 */
export function qualityCount(kind: string, sourceId: string, column: string, prefixes: readonly string[] = []): Sql | undefined {
  const t = ident(tableName(sourceId));
  const c = ident(column);
  switch (kind) {
    case "negative_quantity":
      return sql`SELECT count(*) AS value FROM ${t} WHERE NOT _is_total AND ${c} < 0`;
    case "missing_id":
    case "missing_value":
      return sql`SELECT count(*) AS value FROM ${t} WHERE NOT _is_total AND ${c} IS NULL`;
    case "prefixed_id":
      return sql`SELECT count(*) AS value FROM ${t} WHERE NOT _is_total AND regexp_full_match(${c}::VARCHAR, '[A-Za-z]{1,3}-?[0-9]+')
        AND list_contains(${JSON.stringify(prefixes.map((p) => p.toUpperCase()))}::VARCHAR[], upper(regexp_extract(${c}::VARCHAR, '^([A-Za-z]*)-?[0-9]+$', 1)))`;
    default:
      return undefined;
  }
}
