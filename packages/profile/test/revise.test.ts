// The confirm screen's role edits (semantics §5). Expectations are written by hand from the spec's rules: what is
// posted is confirmed, a changed role carries the user's evidence, a refused request applies nothing.
import { type ColumnType, loadTable, type NormalizedTable, type NormalizedValue, Workspace } from "@agentic-analytics/store";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyTable,
  detectRoles,
  inferBusinessModel,
  loadRoles,
  modelTables,
  profileTable,
  RoleError,
  reviseSemantics,
  type SemanticsSummary,
  saveRoles,
  saveTableKind,
} from "../src/index.ts";

const open: Workspace[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

const specs: { label: string; type: ColumnType }[] = [
  { label: "Order", type: "id" },
  { label: "Customer", type: "category" },
  { label: "Qty", type: "integer" },
  { label: "Std cost", type: "currency" },
];
const rows: NormalizedValue[][] = [
  ["O1", "A", 2, 10],
  ["O2", "B", 3, 12],
  ["O3", "A", 1, 11],
  ["O4", "C", 5, 9],
  ["O5", "B", 4, 13],
];
const table: NormalizedTable = {
  id: "T1",
  file_id: "F1",
  sheet: "S",
  range: "A1:D6",
  hidden_sheet: false,
  header_rows: [1],
  notes: [],
  transposed: false,
  columns: specs.map((s, i) => ({
    name: s.label.toLowerCase().replace(/\W+/g, "_"),
    label: s.label,
    letter: String.fromCharCode(65 + i),
    type: s.type,
  })),
  rows: rows.map((values, i) => ({ row: i + 2, is_total: false, period: null, values })),
};

async function setup() {
  const ws = await Workspace.open();
  open.push(ws);
  await loadTable(ws, table);
  const profile = await profileTable(ws, table);
  const roles = await detectRoles(ws, table, profile);
  await saveRoles(ws, roles);
  const kind = await classifyTable(ws, roles, profile, ["S"]);
  await saveTableKind(ws, kind);
  const business = await inferBusinessModel(
    ws,
    modelTables([{ ...profile, name: "t_t1", file: "f.csv", columns: profile.columns }], [roles], [kind]),
  );
  const semantics: SemanticsSummary = { roles: [roles], table_kinds: [kind], business_model: business };
  const tables = [{ ...profile, name: "t_t1", file: "f.csv", sheet: "S" }];
  return { ws, tables, semantics };
}
const stored = async (ws: Workspace) =>
  Object.fromEntries((await loadRoles(ws, "T1")).map((r) => [r.column_name, [r.role, r.status, r.source]]));

describe("reviseSemantics", () => {
  it("posting a role as proposed confirms it and changes nothing else", async () => {
    const { ws, tables, semantics } = await setup();
    const same = semantics.roles[0]?.columns.map((c) => ({ table: "t_t1", column: c.column, role: c.role })) ?? [];
    const r = await reviseSemantics(ws, tables, semantics, same);
    expect(r.changed).toEqual([]);
    expect(r.confirmed).toBe(4);
    expect(await stored(ws)).toEqual({
      order: ["order_id", "confirmed", "detector"],
      customer: ["customer", "confirmed", "detector"],
      qty: ["quantity", "confirmed", "detector"],
      std_cost: ["unit_cost", "confirmed", "detector"],
    });
    expect(r.semantics.roles[0]?.columns.map((c) => c.role)).toEqual(["order_id", "customer", "quantity", "unit_cost"]);
  });

  it("a changed role takes the user's evidence and ranks first; unposted roles stay proposed", async () => {
    const { ws, tables, semantics } = await setup();
    const r = await reviseSemantics(ws, tables, semantics, [{ table: "T1", column: "std_cost", role: "measure" }]);
    expect(r.changed).toEqual([{ table_id: "T1", column: "std_cost", from: "unit_cost", to: "measure" }]);
    const c = r.semantics.roles[0]?.columns.find((x) => x.column === "std_cost");
    expect(c).toMatchObject({ role: "measure", score: 1, source: "user" });
    expect(c?.evidence).toEqual([{ signal: "user", text: "set by the user (proposed unit_cost)", weight: 1 }]);
    const s = await stored(ws);
    expect(s.std_cost).toEqual(["measure", "confirmed", "user"]);
    expect(s.qty).toEqual(["quantity", "proposed", "detector"]);
  });

  it("none drops a role", async () => {
    const { ws, tables, semantics } = await setup();
    const r = await reviseSemantics(ws, tables, semantics, [{ table: "t_t1", column: "customer", role: "none" }]);
    expect(r.semantics.roles[0]?.columns.find((x) => x.column === "customer")?.evidence[0]?.text).toBe(
      "no role: dropped by the user (proposed customer)",
    );
    expect((await stored(ws)).customer).toEqual(["none", "confirmed", "user"]);
  });

  it("refuses an unknown role, column, table or business model, and applies nothing", async () => {
    const { ws, tables, semantics } = await setup();
    const good = { table: "t_t1", column: "qty", role: "measure" };
    const code = async (edits: { table: string; column: string; role: string }[], model?: { model: string }) => {
      try {
        await reviseSemantics(ws, tables, semantics, edits, model);
        return "no error";
      } catch (e) {
        return e instanceof RoleError ? e.code : String(e);
      }
    };
    expect(await code([good, { table: "t_t1", column: "std_cost", role: "wizard" }])).toBe("UNKNOWN_ROLE");
    expect(await code([good, { table: "t_t1", column: "nope", role: "measure" }])).toBe("UNKNOWN_COLUMN");
    expect(await code([good, { table: "t_nope", column: "qty", role: "measure" }])).toBe("UNKNOWN_COLUMN");
    expect(await code([good], { model: "cooperative" })).toBe("UNKNOWN_BUSINESS_MODEL");
    expect(Object.values(await stored(ws)).every(([, status]) => status === "proposed")).toBe(true);
  });

  it("a business model the person sets is confirmed and survives later role edits", async () => {
    const { ws, tables, semantics } = await setup();
    const set = await reviseSemantics(ws, tables, semantics, [], { model: "services" });
    expect(set.semantics.business_model).toMatchObject({ model: "services", status: "confirmed" });
    expect(set.business_model_changed).toBe(true);
    const later = await reviseSemantics(ws, tables, set.semantics, [{ table: "t_t1", column: "qty", role: "measure" }]);
    expect(later.semantics.business_model).toMatchObject({ model: "services", status: "confirmed" });
  });
});
