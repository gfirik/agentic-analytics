// The query sanitizer (agent-and-verifier §4, security §4). Before a query leaves the machine it loses numbers
// from the user's data, customer/supplier/person names, emails, phones, URLs and anything else flagged private.
// What remains are public terms (industry, product category, region, period).
//
// Matching is done on a normalised form of both the query and the names, so spelling variants can't slip a name
// through: compatibility forms folded (fullwidth digits), diacritics stripped, case folded, any digit treated as
// a digit, hyphens/dots/underscores/extra spaces collapsed, quotes dropped, legal forms (LLC, ООО, MChJ, …)
// ignored at either end. The query is sent in that normalised form (lowercase, no diacritics), which search
// engines handle the same way. When in doubt a term is removed.

export interface PrivateTerms {
  /** Names of customers, suppliers, people, brands: removed as phrases. */
  readonly names: readonly string[];
  /** Other private strings (file names, account ids, emails): removed wherever they appear. */
  readonly values?: readonly string[];
}

export interface Sanitized {
  readonly query: string;
  /** What was taken out, by kind (for logs and tests; never sent anywhere). */
  readonly removed: readonly { kind: "email" | "url" | "phone" | "number" | "name" | "value"; text: string }[];
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const URL_RE = /(?:h[tx]{2}ps?:\/\/|www\.)\S+/giu;
/** A bare domain ("hotelgroup.uz", "shop.example.com"): names often hide in it. */
const DOMAIN = /(?<![\p{L}\p{N}@])(?:[\p{L}\p{N}-]+\.)+\p{L}{2,24}(?![\p{L}\p{N}])/gu;
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
/** Years stay: a period is a public term ("price increase 2026"). */
const YEAR = /^(?:19|20)\d{2}$/;
const NUMBER = /[-+]?\d[\d.,]*%?/g;

/** Legal forms, already normalised (lowercase, no dots): stripped from either end of a name. */
const LEGAL = new Set([
  "llc",
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "ag",
  "sa",
  "s a",
  "srl",
  "sarl",
  "llp",
  "lp",
  "bv",
  "nv",
  "oy",
  "ab",
  "as",
  "plc",
  "pte",
  "pty",
  "kft",
  "sro",
  "spa",
  "ooo",
  "ооо",
  "оао",
  "зао",
  "пао",
  "ао",
  "ип",
  "чп",
  "тоо",
  "mchj",
  "xk",
  "ok",
  "qk",
  "aj",
  "xususiy korxona",
]);

/** Folds compatibility forms and maps every decimal digit to ASCII (non-ASCII digits to 0). */
function foldDigits(s: string): string {
  return s.normalize("NFKC").replace(/\p{Nd}/gu, (d) => (/[0-9]/.test(d) ? d : "0"));
}

/** The matching form: no diacritics, lowercase, separators and quotes collapsed to single spaces. */
export function normalizeText(s: string): string {
  return (
    foldDigits(s)
      .normalize("NFKD")
      // Invisible format characters (zero-width space, soft hyphen, …) and combining marks join nothing.
      .replace(/[\p{M}\p{Cf}]+/gu, "")
      .toLowerCase()
      .replace(/[“”„"'`’‘‚«»‹›()[\]{}<>]/g, " ")
      .replace(/[\s\-‐‑‒–—_.·/\\,;:&+|]+/gu, " ")
      .trim()
  );
}

/** A normalised name without legal forms at either end; undefined when nothing distinctive is left. */
function coreName(name: string): string | undefined {
  let words = normalizeText(name).split(" ").filter(Boolean);
  for (let changed = true; changed && words.length; ) {
    changed = false;
    for (const n of [2, 1]) {
      if (words.length > n && LEGAL.has(words.slice(-n).join(" "))) {
        words = words.slice(0, -n);
        changed = true;
      }
      if (words.length > n && LEGAL.has(words.slice(0, n).join(" "))) {
        words = words.slice(n);
        changed = true;
      }
    }
  }
  const core = words.join(" ");
  return core.length >= 3 ? core : undefined;
}

function phrases(terms: PrivateTerms): string[] {
  const out = new Set<string>();
  for (const n of terms.names) {
    const full = normalizeText(n);
    if (full.length >= 2) out.add(full);
    const core = coreName(n);
    if (core) out.add(core);
    // Written without spaces ("HotelGroup", "hotelgroup.uz").
    const joined = (core ?? full).replace(/ /g, "");
    if (joined.length >= 6 && joined !== (core ?? full)) out.add(joined);
    // The leading two words of a longer name are usually its distinctive part ("Green Leaf" of "Green Leaf
    // Bakery"): removed too, erring on the side of removing.
    const words = (core ?? "").split(" ");
    if (words.length >= 3 && `${words[0]} ${words[1]}`.length >= 5) out.add(`${words[0]} ${words[1]}`);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (p: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, "gu");

export function sanitizeQuery(query: string, terms: PrivateTerms = { names: [] }): Sanitized {
  const removed: { kind: Sanitized["removed"][number]["kind"]; text: string }[] = [];
  let q = ` ${foldDigits(query)} `;
  // Years as they stand in the input, before anything is cut: after a cut or normalising, "0.2025" or the tail of
  // a phone number can look like a year, and only a year that was a whole number on its own may survive.
  const years = new Set((q.match(NUMBER) ?? []).filter((m) => YEAR.test(m)));
  const cut = (re: RegExp, kind: Sanitized["removed"][number]["kind"], keep?: (m: string) => boolean) => {
    q = q.replace(re, (m) => {
      if (keep?.(m)) return m;
      removed.push({ kind, text: m });
      return " ";
    });
  };
  // Structured pieces first, on the folded text (dots, @ and phone punctuation still intact).
  // Defanged forms ("hotelgroup[.]uz", "hxxp://") count as the real thing.
  q = q.replace(/\[\.\]|\(\.\)|\{\.\}/g, ".");
  cut(URL_RE, "url");
  cut(EMAIL, "email");
  for (const v of terms.values ?? []) if (v.trim().length >= 2) cut(new RegExp(escapeRe(foldDigits(v.trim())), "giu"), "value");
  cut(DOMAIN, "url");
  cut(PHONE, "phone", (m) => YEAR.test(m.trim()));

  // Names and values next, on the normalised text and before numbers go, so a name with digits ("Cafe 24") is
  // removed whole instead of leaking its word part.
  q = ` ${normalizeText(q)} `;
  for (const v of terms.values ?? []) {
    const nv = normalizeText(v);
    if (nv.length >= 3) cut(wordRe(nv), "value");
  }
  for (const p of phrases(terms)) cut(wordRe(p), "name");
  cut(NUMBER, "number", (m) => years.has(m));
  // A possessive left behind by a removed name ("Hotel Group's" → "s").
  q = q.replace(/(?<=\s)s(?=\s)/g, " ");
  const clean = q.replace(/\s+/g, " ").trim().slice(0, 200);
  return { query: clean, removed };
}

/** True when `text` still contains a private term (in any spelling the normaliser folds) or a non-year number. */
export function leaksPrivate(text: string, terms: PrivateTerms): boolean {
  const norm = ` ${normalizeText(text)} `;
  if (phrases(terms).some((p) => wordRe(p).test(norm))) return true;
  if ((terms.values ?? []).some((v) => normalizeText(v).length >= 3 && norm.includes(normalizeText(v)))) return true;
  if ((text.match(EMAIL) ?? []).length) return true;
  return (foldDigits(text).match(NUMBER) ?? []).some((m) => !YEAR.test(m));
}
