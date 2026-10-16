// The query sanitizer (agent-and-verifier §4, security §4). Before a query leaves the machine it loses numbers
// from the user's data, customer/supplier/person names, emails, phones, URLs and anything else flagged private.
// What remains are public terms (industry, product category, region, period). Deterministic and conservative:
// when in doubt a term is removed.

export interface PrivateTerms {
  /** Names of customers, suppliers, people, products under a brand: removed as phrases, case-insensitively. */
  readonly names: readonly string[];
  /** Other private strings (e.g. file names, account ids): removed wherever they appear. */
  readonly values?: readonly string[];
}

export interface Sanitized {
  readonly query: string;
  /** What was taken out, by kind (for logs and tests; never sent anywhere). */
  readonly removed: readonly { kind: "email" | "url" | "phone" | "number" | "name" | "value"; text: string }[];
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/giu;
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
/** Years stay: a period is a public term ("price increase 2026"). */
const YEAR = /^(?:19|20)\d{2}$/;
const NUMBER = /[-+]?\d[\d.,]*%?/g;
/** Legal-form suffixes: "Hotel Group LLC" also matches "Hotel Group". */
const LEGAL = /\s*,?\s*\b(?:llc|ltd|limited|inc|corp|co|gmbh|plc|ooo|ооо|оао|зао|ип|mchj|ok|xk)\.?\s*$/iu;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function phrases(terms: PrivateTerms): string[] {
  const out = new Set<string>();
  for (const n of terms.names) {
    const t = n.trim();
    if (t.length < 2) continue;
    out.add(t);
    const bare = t.replace(LEGAL, "").trim();
    if (bare.length >= 3) out.add(bare);
    // "OOO Hotel Group" ↔ "Hotel Group": the legal form can lead too.
    const lead = t.replace(/^(?:ooo|ооо|llc|ип|mchj)\s+/iu, "").trim();
    if (lead.length >= 3) out.add(lead);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function sanitizeQuery(query: string, terms: PrivateTerms = { names: [] }): Sanitized {
  const removed: { kind: Sanitized["removed"][number]["kind"]; text: string }[] = [];
  let q = ` ${query} `;
  const cut = (re: RegExp, kind: Sanitized["removed"][number]["kind"], keep?: (m: string) => boolean) => {
    q = q.replace(re, (m) => {
      if (keep?.(m)) return m;
      removed.push({ kind, text: m });
      return " ";
    });
  };
  cut(URL_RE, "url");
  cut(EMAIL, "email");
  for (const v of terms.values ?? []) if (v.trim().length >= 2) cut(new RegExp(escapeRe(v.trim()), "giu"), "value");
  for (const p of phrases(terms)) cut(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, "giu"), "name");
  cut(PHONE, "phone", (m) => YEAR.test(m.trim()));
  cut(NUMBER, "number", (m) => YEAR.test(m));
  // Leftover punctuation from removed pieces, then whitespace.
  const clean = q
    .replace(/[“”"'`«»()[\]{}<>]/g, " ")
    .replace(/\s+[,;:.!?-]+(?=\s)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return { query: clean, removed };
}

/** True when `text` still contains any private term or a non-year number (for guards and tests). */
export function leaksPrivate(text: string, terms: PrivateTerms): boolean {
  const lower = text.toLowerCase();
  if (phrases(terms).some((p) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p.toLowerCase())}(?![\\p{L}\\p{N}])`, "u").test(lower)))
    return true;
  if ((terms.values ?? []).some((v) => v.trim().length >= 2 && lower.includes(v.trim().toLowerCase()))) return true;
  if ((text.match(EMAIL) ?? []).length) return true;
  return (text.match(NUMBER) ?? []).some((m) => !YEAR.test(m));
}
