import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generatedDatasets, tableHeaders } from "@agentic-analytics/eval-generator";
import { describe, expect, it } from "vitest";
import {
  countRoleLabels,
  expandRoleLabels,
  headerDifferences,
  loadRoleLabels,
  parseRoleLabels,
  ROLES,
  TABLE_KINDS,
} from "../src/role-labels.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const labels = loadRoleLabels();

describe("role labels", () => {
  it("uses exactly the vocabulary and table kinds of the spec", () => {
    const spec = readFileSync(join(root, "docs", "specs", "semantics.md"), "utf8");
    const vocab = spec.slice(spec.indexOf("## 1. The role vocabulary"), spec.indexOf("## 2. The role detector"));
    // The role is the second cell of each row (the first is the group, empty after its first row).
    const roles = [...vocab.matchAll(/^\|[^|]*\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(roles).toEqual([...ROLES]);
    const kinds = spec.slice(spec.indexOf("## 3. Table kinds"), spec.indexOf("**What each kind unlocks"));
    expect([...kinds.matchAll(/^\| \d \| `([a-z_]+)` \|/gm)].map((m) => m[1])).toEqual([...TABLE_KINDS]);
  });

  it("counts: 55 real columns, 360 generated, 12 distinct generated", () => {
    const c = countRoleLabels(labels);
    expect(c.byGroup).toEqual({ real: 55, generated: 360 });
    expect(c.columns).toBe(415);
    expect(c.tables).toBe(63);
    expect(c.distinct).toBe(55 + 12);
  });

  it("expands a layout per dataset", () => {
    const t = expandRoleLabels(labels).filter((x) => x.entry === "generated-orders");
    expect(t).toHaveLength(30);
    expect(new Set(t.map((x) => x.dataset)).size).toBe(30);
  });

  it("every one of the 30 generated datasets has the labelled headers", () => {
    const tables = expandRoleLabels(labels).filter((t) => t.group === "generated");
    const diffs: string[] = [];
    const all = generatedDatasets();
    for (const ds of all) {
      const have = tableHeaders(ds);
      for (const t of tables.filter((x) => x.dataset === ds.id)) {
        const found = have.find((h) => h.table === t.table);
        if (!found) diffs.push(`${ds.id}: no ${t.table} table`);
        else diffs.push(...headerDifferences(t, found.headers));
      }
    }
    expect(diffs).toEqual([]);
    expect(new Set(all.map((d) => d.id)).size).toBe(30);
  }, 120_000);

  const data = join(root, "evals", "real", "data");
  const files: Record<string, string> = {
    "online-retail-ii": "online_retail_II.sample10.csv",
    "nz-card-spend": "nz-card-spend-by-industry.csv",
    "hotel-bookings": "hotel-bookings.csv",
  };
  for (const t of expandRoleLabels(labels).filter((x) => x.group === "real"))
    it.skipIf(!existsSync(join(data, files[t.dataset] as string)))(`${t.dataset}: labelled columns are the file's header`, () => {
      const first = readFileSync(join(data, files[t.dataset] as string), "utf8").split("\n", 1)[0] ?? "";
      expect(headerDifferences(t, first.replace(/\r$/, "").split(","))).toEqual([]);
    });

  it("refuses a repeated header, an unknown role and an accept that repeats the role", () => {
    const base = (cols: string) =>
      `version: 1\nentries:\n  - { id: a, group: real, datasets: [d], table: t, kind: sales_lines, columns: [${cols}] }\n`;
    expect(() => parseRoleLabels(base("{ header: A, role: amount }, { header: A, role: quantity }"))).toThrow(/duplicate header/);
    expect(() => parseRoleLabels(base("{ header: A, role: money }"))).toThrow(/invalid role labels/);
    expect(() => parseRoleLabels(base("{ header: A, role: amount, accept: [amount] }"))).toThrow(/repeats/);
    expect(parseRoleLabels(base("{ header: A, role: amount, accept: [measure] }")).entries[0]?.columns[0]?.accept).toEqual(["measure"]);
  });
});
