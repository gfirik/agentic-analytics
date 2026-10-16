// The compact profile digest a model sees when drafting metrics (docs/specs/metric-layer.md §2.1): tables,
// columns, types and at most five sample values per column. Values that look like a person's name or a
// contact are masked. Cell text is untrusted (security §2), so it is only ever sent as delimited data.
import type { ProfileSummary } from "@agentic-analytics/profile";
import { entityKind } from "@agentic-analytics/profile";

export interface DigestColumn {
  readonly name: string;
  readonly label: string;
  readonly type: string;
  readonly currency?: string;
  readonly distinct: number;
  readonly samples: readonly string[];
}

export interface DigestTable {
  readonly name: string; // t_t1
  readonly source: string; // "sales-2026.xlsx#Orders"
  readonly rows: number;
  readonly date_column?: string;
  readonly columns: readonly DigestColumn[];
}

export interface Digest {
  readonly grain: string;
  readonly tables: readonly DigestTable[];
}

const PERSON_LABEL = /\b(name|person|contact|manager|employee|owner|email|e-mail|phone|tel|mobile)\b|фио|имя|телефон|почта|ism|telefon/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
/** Phone-like: 7+ digits with a leading + or separators (spaces, dashes, parentheses), so amounts and ids don't match. */
const PHONE = /^(?=(?:\D*\d){7,})(?:\+[\d\s()-]+|\d+(?:[\s()-]+\d+){2,})$/;
const TEXT_TYPES = new Set(["text", "category", "id"]);
export const MAX_SAMPLES = 5;

/** Masks a sample value when its column names people or contacts, or when the value is an email or phone number. */
export function maskSample(value: string, label: string, index: number, type = "text"): string {
  const kind = entityKind(label);
  if (kind === "customer" || kind === "supplier") return `<${kind} ${index + 1}>`;
  if (PERSON_LABEL.test(label)) return `<person ${index + 1}>`;
  if (TEXT_TYPES.has(type) && EMAIL.test(value)) return "<email>";
  if (TEXT_TYPES.has(type) && PHONE.test(value.trim())) return "<phone>";
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}

export function buildDigest(summary: ProfileSummary): Digest {
  return {
    grain: summary.grain,
    tables: summary.tables.map((t) => ({
      name: t.name,
      source: `${t.file}${t.sheet ? `#${t.sheet}` : ""}`,
      rows: t.detail_rows,
      ...(t.date_column ? { date_column: t.date_column } : {}),
      columns: t.columns.map((c) => ({
        name: c.name,
        label: c.label,
        type: c.type,
        ...(c.currency ? { currency: c.currency } : {}),
        distinct: c.distinct_count,
        samples: c.top_values.slice(0, MAX_SAMPLES).map((v, i) => maskSample(v.value, c.label, i, c.type)),
      })),
    })),
  };
}
