// `aa eval --suite roles`: the scorer's arithmetic on a hand-labelled 6-column fixture, and the detector against the
// labels on the generated businesses (the CI part of acceptance A1; real files are scored locally after
// `bun run eval:real:fetch`).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Role, TableRoles } from "@agentic-analytics/profile";
import { afterEach, describe, expect, it } from "vitest";
import { expandRoleLabels, parseRoleLabels } from "../src/role-labels.ts";
import { ROLES_BAR, rolesLines, runRolesSuite, scoreTable, summarizeRoles } from "../src/roles-run.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const labels = parseRoleLabels(`
version: 1
entries:
  - id: real-a
    group: real
    datasets: [real-a]
    table: a.csv
    kind: sales_lines
    columns:
      - { header: Amt, role: amount }
      - { header: Qty, role: quantity, accept: [measure] }
      - { header: Junk, role: none }
      - { header: Cust, role: customer }
      - { header: State, role: status, accept: [dimension] }
      - { header: Month, role: period }
  - id: layout-b
    group: generated
    datasets: [g1, g2]
    table: Orders
    kind: sales_lines
    columns:
      - { header: Date, role: transaction_date }
      - { header: Total, role: amount }
`);

const proposals = (m: Record<string, Role>): TableRoles => ({
  table_id: "T1",
  identities: [],
  columns: Object.entries(m).map(([label, role], position) => ({
    column: label.toLowerCase(),
    label,
    position,
    candidates: [],
    role,
    score: role === "none" ? 0 : 0.6,
    evidence: [],
    source: "detector" as const,
  })),
});

describe("scoring a proposal against a label", () => {
  const [real] = expandRoleLabels(labels);
  // Amt amount ✓ · Qty measure ✓ (accepted) · Junk none ✓ (labelled none, proposed none) · Cust dimension ✗ ·
  // State dimension ✓ (accepted) · Month none ✗ (a role was labelled).
  const got = proposals({ Amt: "amount", Qty: "measure", Junk: "none", Cust: "dimension", State: "dimension", Month: "none" });

  it("a proposal is right when it is the label or in its accept list; none is right for a none label", () => {
    expect(scoreTable(real as NonNullable<typeof real>, got).map((s) => [s.header, s.correct])).toEqual([
      ["Amt", true],
      ["Qty", true],
      ["Junk", true],
      ["Cust", false],
      ["State", true],
      ["Month", false],
    ]);
  });

  it("pooled 4/6 = 66.7%; real alone the same; the bar is 95", () => {
    const r = summarizeRoles(scoreTable(real as NonNullable<typeof real>, got), [], { date: "2026-10-23", engine_commit: "abc" });
    expect(r.pooled).toEqual({ correct: 4, total: 6, rate: (4 / 6) * 100 });
    expect(r.real).toEqual({ correct: 4, total: 6, rate: (4 / 6) * 100 });
    expect(r.distinct).toEqual({ correct: 4, total: 6, rate: (4 / 6) * 100 });
    expect(r.bar).toBe(ROLES_BAR);
    expect(r.pass).toBe(false);
    expect(r.misses.map((m) => [m.header, m.label, m.proposed])).toEqual([
      ["Cust", "customer", { dimension: 1 }],
      ["Month", "period", { none: 1 }],
    ]);
  });

  it("a shared layout counts once in the distinct rate and is right only if right everywhere", () => {
    const g = expandRoleLabels(labels).filter((t) => t.group === "generated");
    // g1: both right. g2: Total wrong. Pooled 3/4 = 75%; distinct pairs: Date ✓, Total ✗ → 1/2 = 50%.
    const scores = [
      ...scoreTable(g[0] as NonNullable<(typeof g)[0]>, proposals({ Date: "transaction_date", Total: "amount" })),
      ...scoreTable(g[1] as NonNullable<(typeof g)[1]>, proposals({ Date: "transaction_date", Total: "measure" })),
    ];
    const r = summarizeRoles(scores, [], { date: "2026-10-23", engine_commit: "abc" });
    expect(r.pooled).toEqual({ correct: 3, total: 4, rate: 75 });
    expect(r.distinct).toEqual({ correct: 1, total: 2, rate: 50 });
    expect(r.real).toEqual({ correct: 0, total: 0, rate: null });
    expect(r.misses).toHaveLength(1);
    expect(r.misses[0]).toMatchObject({ header: "Total", datasets: 2, wrong: 1, proposed: { measure: 1 } });
  });

  it("prints the three rates and each miss", () => {
    const r = summarizeRoles(scoreTable(real as NonNullable<typeof real>, got), [], {
      date: "2026-10-23",
      engine_commit: "abcdef0123456789",
    });
    const text = rolesLines(r).join("\n");
    expect(text).toContain("pooled per-column (A1, bar 95%): 66.7% (4/6) FAIL");
    expect(text).toContain("real datasets alone: 66.7% (4/6)  BELOW BAR");
    expect(text).toContain("distinct (layout, column) pairs: 66.7% (4/6)");
    expect(text).toContain("real-a / Cust: labelled customer, proposed dimension");
  });
});

describe("the detector against the generated businesses' labels", () => {
  it("scores ≥ 95% on three businesses covering both layouts, and writes a results file with the engine commit", async () => {
    const out = mkdtempSync(join(tmpdir(), "aa-roles-"));
    dirs.push(out);
    const lines: string[] = [];
    const r = await runRolesSuite(
      {
        resultsDir: out,
        only: ["agency-v1", "saas-v2", "restaurant-v3"],
        dataDir: join(out, "no-real-data"),
        now: () => new Date("2026-10-23T00:00:00Z"),
      },
      (l) => lines.push(l),
    );
    expect(r.pooled.total).toBe(36); // 3 businesses × (8 Orders + 4 Costs) columns
    expect(r.pooled.rate).toBeGreaterThanOrEqual(ROLES_BAR);
    expect(r.misses).toEqual([]);
    expect(r.datasets.map((d) => d.dataset).sort()).toEqual(["agency-v1", "restaurant-v3", "saas-v2"]);
    const files = readdirSync(join(out, "roles"));
    expect(files).toEqual(["2026-10-23-roles-agency-v1_saas-v2_restaurant-v3.json"]);
    const written = JSON.parse(readFileSync(join(out, "roles", files[0] as string), "utf8"));
    expect(written).toMatchObject({ suite: "roles", date: "2026-10-23", model: "none (deterministic detector)" });
    expect(typeof written.engine_commit).toBe("string");
  }, 180_000);

  it("a labelled real dataset whose file isn't fetched is skipped with the command that gets it", async () => {
    const out = mkdtempSync(join(tmpdir(), "aa-roles-"));
    dirs.push(out);
    const r = await runRolesSuite({ resultsDir: out, only: ["real"], dataDir: join(out, "nothing-here") });
    expect(r.pooled.total).toBe(0);
    expect(r.skipped.map((s) => s.dataset)).toEqual(["online-retail-ii", "nz-card-spend", "hotel-bookings", "montgomery-warehouse-sales"]);
    expect(r.skipped[0]?.reason).toMatch(/bun run eval:real:fetch/);
  });

  it("refuses an --only that is neither a group nor a labelled dataset", async () => {
    await expect(runRolesSuite({ resultsDir: tmpdir(), only: ["nope-v9"], dataDir: tmpdir() })).rejects.toThrow(/not a group/);
  });
});
