// Presentation helpers for the landing page's hero exhibit (DESIGN.md §5): the fact's SQL laid out one clause per
// line, and tinted in ink shades. Pure functions of the recorded SQL: nothing is rewritten, only line breaks and
// indentation are added (whitespace between tokens is collapsed to one space).

const BREAK_BEFORE = ["FROM", "WHERE", "GROUP BY", "ORDER BY", "AND"] as const;

/**
 * The SQL as lines: a CTE body indented inside `WITH … AS (` / `)`, and a break before FROM, WHERE, GROUP BY,
 * ORDER BY and each top-level AND of a WHERE (not the AND of BETWEEN … AND, nor one inside parentheses).
 */
export function sqlLines(sql: string): string[] {
  const s = sql.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let line = "";
  let depth = 0;
  let quote: string | null = null;
  let between = false;
  // The depth each open parenthesis started a CTE body at (`AS (` followed by SELECT).
  const cte: number[] = [];
  const push = (indent: number) => {
    if (line.trim()) lines.push(`${"  ".repeat(Math.max(0, indent))}${line.trim()}`);
    line = "";
  };
  const indentOf = (extra = 0) => cte.length + extra;
  let cur = 0; // indent of the line being built
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (quote) {
      line += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      line += c;
      continue;
    }
    if (c === "(") {
      depth++;
      if (/\bAS\s*$/i.test(line) && /^\s*SELECT\b/i.test(s.slice(i + 1))) {
        line += "(";
        push(cur);
        cte.push(depth);
        cur = indentOf();
        while (s[i + 1] === " ") i++;
        continue;
      }
      line += c;
      continue;
    }
    if (c === ")") {
      if (cte.at(-1) === depth) {
        push(cur);
        cte.pop();
        depth--;
        cur = indentOf();
        line = ")";
        push(cur);
        cur = indentOf();
        while (s[i + 1] === " ") i++;
        continue;
      }
      depth--;
      line += c;
      continue;
    }
    // Keyword boundaries, outside quotes and at the statement's own depth.
    const atWord = (i === 0 || s[i - 1] === " ") && depth === (cte.at(-1) ?? 0);
    if (atWord) {
      const rest = s.slice(i);
      if (/^BETWEEN\b/i.test(rest)) between = true;
      const kw = BREAK_BEFORE.find((k) => new RegExp(`^${k.replace(" ", "\\s")}\\b`, "i").test(rest));
      if (kw === "AND" && between) between = false;
      else if (kw) {
        push(cur);
        cur = indentOf(kw === "AND" ? 1 : 0);
      }
    }
    line += c;
  }
  push(cur);
  return lines;
}

export type SqlToken = { readonly text: string; readonly kind: "kw" | "str" | "id" | "param" | "fn" | "plain" };

const KEYWORDS =
  /^(WITH|AS|SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|BETWEEN|GROUP|BY|ORDER|ALL|SUM|COUNT|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|DISTINCT|JOIN|ON|LEFT|FULL|OUTER|LIMIT)$/i;

/** One line of SQL as tokens for tinting in ink shades (keywords, strings, quoted identifiers, $n parameters). */
export function sqlTokens(line: string): SqlToken[] {
  const out: SqlToken[] = [];
  const re = /('[^']*')|("[^"]*")|(\$\d+)|([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()|([A-Za-z_][A-Za-z0-9_]*)|(\s+|[^A-Za-z0-9_'"$\s]+|\d+)/g;
  for (const m of line.matchAll(re)) {
    const [text, str, id, param, fn, word] = m;
    if (str) out.push({ text, kind: "str" });
    else if (id) out.push({ text, kind: "id" });
    else if (param) out.push({ text, kind: "param" });
    else if (fn) out.push({ text, kind: KEYWORDS.test(fn) ? "kw" : "fn" });
    else if (word) out.push({ text, kind: KEYWORDS.test(word) ? "kw" : "plain" });
    else out.push({ text, kind: "plain" });
  }
  return out;
}

/** The month of a `YYYY-MM` period in words ("2026-04" → "April"). */
export function monthName(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}
