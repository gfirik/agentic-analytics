// The landing page's hero exhibit and status strip (apps/docs/DESIGN.md §4–§5): every figure comes from generated
// data. The exhibit's figures are the recorded run's facts (the same run as the pipeline scene), its SQL is the
// facts' own SQL laid out on lines, its cited rows are the facts' cited rows read back from the run's DuckDB, and the
// strip's items are counts from the committed results and the repository.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ExhibitData, exhibitData, exhibitIds, exhibitRows, globToRegExp, statusStrip } from "../../apps/docs/scripts/landing-data.ts";
import { recordRun } from "../../apps/docs/scripts/pipeline-data.ts";
import { formatWithCurrency } from "../../apps/docs/src/components/format.ts";
import { monthName, sqlLines, sqlTokens } from "../../apps/docs/src/components/site/exhibit.ts";

let run: ReturnType<typeof recordRun<Awaited<ReturnType<typeof exhibitRows>>>> | undefined;
/** Whitespace-insensitive SQL, for comparing a laid-out query with the recorded one. */
const flat = (q: string) => q.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
const recorded = async () => {
  run = run ?? recordRun(async (ws, report) => exhibitRows(ws, report, exhibitIds(report).facts));
  const r = await run;
  return { report: r.report, exhibit: exhibitData(r.report, r.extra ?? {}) as ExhibitData };
};

describe("hero exhibit (from the recorded run)", () => {
  it("shows the report's own claim text, and every figure is a fact's stored value", async () => {
    const { report, exhibit } = await recorded();
    const facts = new Map(report.facts.map((f) => [f.id, f]));
    const finding = report.findings[0];
    const shownFacts = exhibit.lines.flat().flatMap((p) => ("fact" in p ? [p.fact] : []));
    expect(shownFacts.length).toBeGreaterThan(5);
    for (const id of shownFacts) {
      const f = facts.get(id);
      expect(f, id).toBeDefined();
      expect(exhibit.notes[id]?.value).toBe(formatWithCurrency(f as Parameters<typeof formatWithCurrency>[0]));
    }
    // The claim lines are the report's text with the facts in place of their placeholders.
    const claimTexts = finding?.claims.map((c) => c.text) ?? [];
    const recFacts = new Set([report.recommendations[0]?.impact?.low, report.recommendations[0]?.impact?.high]);
    const claimLines = exhibit.lines.filter((line) => !line.some((p) => "fact" in p && recFacts.has(p.fact)));
    expect(claimLines.length).toBeGreaterThanOrEqual(2);
    for (const line of claimLines) {
      const text = line.map((p) => ("text" in p ? p.text : "fact" in p ? `{{${p.fact}}}` : "")).join("");
      expect(claimTexts).toContain(text);
    }
    // The text holds no typed figures: digits only inside placeholders, or in the report's own periods (2026-04).
    const typed = exhibit.lines
      .flat()
      .flatMap((p) => ("text" in p ? [p.text.replace(/\b\d{4}-\d{2}\b/g, "")] : []))
      .join(" ");
    expect(typed).not.toMatch(/\d/);
  }, 120_000);

  it("walks through the story's key figures by role: the change, its SQL and rows, the driver, the cause", async () => {
    const { report, exhibit } = await recorded();
    const facts = new Map(report.facts.map((f) => [f.id, f]));
    const walk = exhibit.walk;
    expect(walk.length).toBeGreaterThanOrEqual(3);
    expect(walk.length).toBeLessThanOrEqual(4);
    // Every step opens a note of a chip the exhibit shows.
    for (const s of walk) {
      expect(exhibit.order, s.id).toContain(s.id);
      expect(exhibit.notes[s.id], s.id).toBeDefined();
      for (const f of s.figures) expect(exhibit.notes[f.id], f.id).toBeDefined();
    }
    const [change, input, driver, cause] = walk;
    // 1. The headline percent change, said with its direction.
    const head = facts.get(change?.id ?? "");
    expect(head?.unit).toBe("percent");
    expect(change?.title).toBe(head && head.value < 0 ? "Revenue fell" : "Revenue rose");
    expect(change?.how).toBe("how it was computed");
    // 2. One of the headline's inputs, an SQL fact with cited rows: the newest period.
    expect(head?.computation.inputs).toContain(input?.id);
    expect(exhibit.notes[input?.id ?? ""]?.kind).toBe("sql");
    expect(exhibit.notes[input?.id ?? ""]?.rows?.rows.some((r) => r.cited)).toBe(true);
    const inputPeriods = (head?.computation.inputs ?? []).map((i) => /(\d{4}-\d{2})/.exec(facts.get(i)?.label ?? "")?.[1] ?? "");
    const period = /(\d{4}-\d{2})/.exec(facts.get(input?.id ?? "")?.label ?? "")?.[1] ?? "";
    expect(period).toBe([...inputPeriods].sort().at(-1));
    expect(input?.title).toBe(`${monthName(period)} revenue,`);
    // 3. The driver's contribution, with its share of the change.
    expect(facts.get(driver?.id ?? "")?.computation.fn).toBe("delta");
    expect(driver?.figures.map((f) => facts.get(f.id)?.computation.fn)).toEqual(["delta", "contribution.v1"]);
    expect(driver?.how).toMatch(/^the change split by \w+$/);
    // 4. The quoted document.
    expect(exhibit.notes[cause?.id ?? ""]?.kind).toBe("source");
    expect(cause?.how).toContain(exhibit.notes[cause?.id ?? ""]?.value ?? "?");
    // No typed figures: the step texts carry no digits except the source file's name; values come from the notes.
    for (const s of walk) expect(`${s.title} ${s.how.replace(exhibit.notes[s.id]?.value ?? "", "")}`).not.toMatch(/\d/);
  }, 120_000);

  it("verifies one figure at a time, at most 10 (≤ 2.5 s at 250 ms each), in reading order", async () => {
    const { exhibit } = await recorded();
    const chips = exhibit.lines.flat().flatMap((p) => ("fact" in p ? [p.fact] : "source" in p ? [p.source] : []));
    expect(exhibit.order).toEqual(chips.filter((id, i) => chips.indexOf(id) === i));
    expect(exhibit.order.length).toBeLessThanOrEqual(10);
  }, 120_000);

  it("each margin note carries the fact's own SQL and parameters, or its function and inputs", async () => {
    const { report, exhibit } = await recorded();
    for (const f of report.facts.filter((x) => x.id in exhibit.notes)) {
      const n = exhibit.notes[f.id];
      if (f.computation.kind === "sql") {
        expect(flat(n?.sql?.join(" ") ?? "")).toBe(flat(f.computation.sql ?? ""));
        expect(n?.params?.map(([k]) => k)).toEqual(Object.keys(f.computation.params ?? {}).filter((k) => k.startsWith("$")));
      } else {
        expect(n?.fn).toBe(f.computation.fn);
        expect(n?.inputs?.map((i) => i.id)).toEqual(f.computation.inputs);
      }
    }
  }, 120_000);

  it("the cited rows are the fact's first cited row and its neighbours, marked by the fact's own citation", async () => {
    const { report, exhibit } = await recorded();
    const withRows = Object.values(exhibit.notes).filter((n) => n.rows);
    expect(withRows.length).toBeGreaterThanOrEqual(3);
    for (const n of withRows) {
      const f = report.facts.find((x) => x.id === n.id);
      const cited = new Set(f?.citations[0]?.rows ?? []);
      const first = f?.citations[0]?.rows?.[0] as number;
      expect(n.rows?.rows.map((r) => r.row)).toContain(first);
      for (const r of n.rows?.rows ?? []) {
        expect(Math.abs(r.row - first)).toBeLessThanOrEqual(1);
        expect(r.cited).toBe(cited.has(r.row));
        expect(r.cells).toHaveLength(n.rows?.columns.length ?? 0);
      }
      expect(n.rows?.count).toBe(f?.citations[0]?.rows?.length);
      // The columns are the ones the SQL reads.
      for (const c of n.rows?.columns ?? []) expect(f?.computation.sql).toContain(`"${c}"`);
    }
  }, 120_000);

  it("the definitions cell's two SQL lines are the first SQL fact's own SELECT and FROM", async () => {
    const { report, exhibit } = await recorded();
    const f = report.facts.find((x) => x.id === exhibit.compiled.fact);
    expect(f?.computation.kind).toBe("sql");
    expect(exhibit.compiled.lines).toHaveLength(2);
    expect(exhibit.compiled.lines[0]).toMatch(/^SELECT /);
    expect(exhibit.compiled.lines[1]).toMatch(/^FROM /);
    for (const l of exhibit.compiled.lines) expect(flat(f?.computation.sql ?? "")).toContain(l);
  }, 120_000);

  it("the cited document's quote is the claim's own citation", async () => {
    const { report, exhibit } = await recorded();
    const quotes = report.findings[0]?.claims.flatMap((c) => c.citations.map((x) => x.quote)) ?? [];
    const sources = Object.values(exhibit.notes).filter((n) => n.kind === "source");
    expect(sources.length).toBe(1);
    for (const s of sources) expect(quotes).toContain(s.quote);
  }, 120_000);
});

describe("landing markup", () => {
  // Every figure on the page is an expression over generated data; the markup itself types no figures. Allowed: step
  // and cell numbers, the Node version, the local port and address, and the first release with binaries.
  const ALLOWED = /Step [123]|0[123] ·|Node 22|127\.0\.0\.1:8080|v0\.1\.0|§\{|aa-|\bh[1-6]\b/g;
  const markup = (file: string) => {
    let s = readFileSync(join(import.meta.dirname, "..", "..", "apps", "docs", "src", file), "utf8");
    s = s
      .replace(/^---[\s\S]*?\n---\n/, "")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<script[\s\S]*?<\/script>/g, "");
    // Drop {expressions}, nested braces included.
    let out = "";
    let depth = 0;
    for (const ch of s) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
      else if (depth === 0) out += ch;
    }
    // Attributes are not reading text; SVG path data is drawing.
    return out.replace(/\s[a-z-]+="[^"]*"/g, "").replace(ALLOWED, "");
  };

  it("index.astro and Exhibit.astro type no figures in their text", () => {
    for (const [f, known] of [
      ["pages/index.astro", "An AI analyst you can audit."],
      ["components/site/Exhibit.astro", "Recorded from a real engine run."],
    ] as const) {
      const text = markup(f);
      expect(text).toContain(known); // the scan reads the page's text, not nothing
      expect(text.match(/.{0,30}\d.{0,30}/g) ?? [], f).toEqual([]);
    }
    // And it would catch one.
    expect(/\d/.test("<p>Revenue fell 17.9% in April</p>".replace(ALLOWED, ""))).toBe(true);
  });
});

describe("exhibit helpers", () => {
  const q =
    'WITH m1 AS (SELECT strftime("date", \'%Y-%m\') AS period, sum("amount") AS value FROM "t_t1" WHERE NOT _is_total AND (("status" IS NULL) OR ("status" NOT IN ($1))) AND strftime("date", \'%Y-%m\') BETWEEN $2 AND $3 GROUP BY ALL)\nSELECT period, value FROM m1 ORDER BY period';

  it("sqlLines breaks clauses and top-level ANDs, never the AND of BETWEEN or inside parentheses, and drops no text", () => {
    expect(sqlLines(q)).toEqual([
      "WITH m1 AS (",
      '  SELECT strftime("date", \'%Y-%m\') AS period, sum("amount") AS value',
      '  FROM "t_t1"',
      "  WHERE NOT _is_total",
      '    AND (("status" IS NULL) OR ("status" NOT IN ($1)))',
      "    AND strftime(\"date\", '%Y-%m') BETWEEN $2 AND $3",
      "  GROUP BY ALL",
      ")",
      "SELECT period, value",
      "FROM m1",
      "ORDER BY period",
    ]);
    expect(flat(sqlLines(q).join(" "))).toBe(flat(q));
  });

  it("sqlTokens keeps every character and tells keywords, strings, identifiers and parameters apart", () => {
    const line = `AND ("status" NOT IN ($1)) AND x = 'a b'`;
    const t = sqlTokens(line);
    expect(t.map((x) => x.text).join("")).toBe(line);
    expect(t.filter((x) => x.kind === "kw").map((x) => x.text)).toEqual(["AND", "NOT", "IN", "AND"]);
    expect(t.find((x) => x.kind === "str")?.text).toBe("'a b'");
    expect(t.find((x) => x.kind === "id")?.text).toBe('"status"');
    expect(t.find((x) => x.kind === "param")?.text).toBe("$1");
  });

  it("monthName names the month of a period", () => {
    expect(monthName("2026-04")).toBe("April");
    expect(monthName("Q2")).toBe("Q2");
  });
});

describe("status strip", () => {
  const base = {
    changelog: "# Changelog\n\n## v0.1.0 (unreleased)\n\ntext",
    testFiles: 94,
    real: { datasets: [{ checks: [{ pass: true }, { pass: true }] }, { checks: [{ pass: true }, { pass: false }] }] },
    smoke: { completed: 3, datasets: 3, mismatches: 0 },
    full: { datasets: 30 },
  };
  const text = (s: Parameters<typeof statusStrip>[0]) => statusStrip(s).map((i) => i.text);

  it("leads with what is proven and links the generated-business suite as the nightly regression check", () => {
    expect(text(base)).toEqual([
      "v0.1.0 pre-release",
      "real public data: 3/4 checks",
      "real-model smoke: 3/3 jobs, 0 wrong numbers",
      "94 test files",
      "verifier on every report",
      "nightly regression: 30 generated businesses",
    ]);
    expect(statusStrip(base).at(-1)?.href).toBe("#results");
    expect(statusStrip(base).filter((i) => i.href)).toHaveLength(1);
    expect(text({ ...base, changelog: "## v0.1.0\n", smoke: { completed: 2, datasets: 3, mismatches: 1 } }).slice(0, 3)).toEqual([
      "v0.1.0 release",
      "real public data: 3/4 checks",
      "real-model smoke: 2/3 jobs, 1 wrong number",
    ]);
    expect(text({ ...base, smoke: { completed: 0, datasets: 3, mismatches: null } })[2]).toBe("real-model smoke: 0/3 jobs");
  });

  it("never headlines the regression suite's partial pass", () => {
    expect(text(base).join(" · ")).not.toMatch(/in progress|partial|\/30/);
  });

  it("globToRegExp matches vitest's include globs", () => {
    const g = globToRegExp("packages/*/test/**/*.test.ts");
    expect(g.test("packages/models/test/fetch.test.ts")).toBe(true);
    expect(g.test("packages/models/test/deep/x.test.ts")).toBe(true);
    expect(g.test("packages/models/src/fetch.test.ts")).toBe(false);
    expect(g.test("packages/a/b/test/x.test.ts")).toBe(false);
  });
});
