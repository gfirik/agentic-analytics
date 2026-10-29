// What the analysis reads of the stored column roles (semantics §1, `profile_roles`): PVM's readiness reads a table's roles
// once, and "any column with a cost role" filters in SQL with the roles as a parameter (AGENTS.md §4).
import type { Catalog } from "@agentic-analytics/metrics";
import type { MetricDef } from "@agentic-analytics/schema";
import { type Sql, sql, Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pvmReadiness } from "../src/decomp-inputs.ts";
import { anyColumnWithRole } from "../src/roles.sql.ts";

let ws: Workspace;
const queries: Sql[] = [];
/** The workspace, with every query it runs recorded. */
let spied: Workspace;

beforeAll(async () => {
  ws = await Workspace.open();
  for (const [column, role] of [
    ["qty", "quantity"],
    ["sku", "product_id"],
    ["amount", "amount"],
  ] as const)
    await ws.run(
      sql`INSERT INTO profile_roles (table_id, column_name, role, score, status, source) VALUES ('T1', ${column}, ${role}, 1, 'assumed', 'detector')`,
    );
  spied = new Proxy(ws, {
    get(target, key) {
      const v = Reflect.get(target, key, target);
      if (key !== "all" && key !== "one") return typeof v === "function" ? v.bind(target) : v;
      return (q: Sql) => {
        queries.push(q);
        return (v as (q: Sql) => Promise<unknown>).call(target, q);
      };
    },
  });
});
afterAll(() => ws.close());

const catalog: Catalog = new Map([
  [
    "t_t1",
    {
      name: "t_t1",
      id: "T1",
      label: "sales.csv",
      columns: new Map([
        ["qty", { name: "qty", label: "qty", type: "integer" as const }],
        ["sku", { name: "sku", label: "sku", type: "text" as const }],
        ["amount", { name: "amount", label: "amount", type: "currency" as const }],
      ]),
    },
  ],
]);
const revenue: MetricDef = {
  id: "revenue",
  label: "Revenue",
  type: "sum",
  unit: "currency",
  status: "assumed",
  table: "t_t1",
  expression: "amount",
  dimensions: ["sku"],
};

describe("stored roles (semantics §1)", () => {
  it("pvmReadiness reads the table's roles once for the quantity and the item", async () => {
    queries.length = 0;
    expect(await pvmReadiness(spied, catalog, revenue)).toEqual({ sum: true, quantity: true, item: true });
    expect(queries.filter((q) => q.text.includes("profile_roles"))).toHaveLength(1);
  });

  it("anyColumnWithRole filters in SQL, with the roles as a parameter", async () => {
    queries.length = 0;
    expect(await anyColumnWithRole(spied, ["unit_cost", "cost_amount"])).toBe(false);
    expect(await anyColumnWithRole(spied, ["quantity"])).toBe(true);
    expect(queries[0]?.text).toMatch(/WHERE .*role/);
    expect(queries[0]?.params).toContain(JSON.stringify(["unit_cost", "cost_amount"]));
  });
});
