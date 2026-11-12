// Pre-tag B3, role edits: an empty `metrics: []` posted next to role edits is a revision when the edited roles draft
// metrics (semantics §5), and the redraft, not only the first draft, decides whether an empty list is accepted.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModel } from "@agentic-analytics/models/testing";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { JobManager } from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "aa-confirm-roles-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const manager = new JobManager({
  root,
  model: new FakeModel([]),
  deps: () => ({ model: new FakeModel([]), embedder: hashEmbedder() }),
});
const enc = (s: string) => new TextEncoder().encode(s);
const OPTS = { today: "2024-09-01", currency: "USD", autoConfirm: false };
const EMPTY_YAML = "version: 1\ngrain: month\nmetrics: []\n";

/** Thirty dated rows with money values: the dollar sign makes the amount column currency, so revenue can be drafted. */
const money = (header: string) => {
  const rows = Array.from({ length: 30 }, (_, i) => `2024-0${(i % 6) + 1}-1${i % 9},$${100 + i * 7}.50,C${i % 5}`);
  return { name: "m.csv", bytes: enc(`${header}\n${rows.join("\n")}\n`) };
};
const odd = { name: "odd.csv", bytes: enc("foo,bar,baz\nalpha,beta,gamma\none,two,three\nx,y,z\n") };
const ids = (v: { metrics: { id: string }[] }) => v.metrics.map((m) => m.id);
const role = (col: string, r: string) => `roles:\n  - { table: t_t1, column: ${col}, role: ${r} }\n`;

async function waiting(id: string, file: { name: string; bytes: Uint8Array }) {
  await manager.create([file], OPTS, id);
  expect((await manager.wait(id)).status).toBe("awaiting_confirmation");
}

describe("an empty list posted with role edits", () => {
  it("is a revision when the edited roles draft metrics: the job keeps waiting and shows them", async () => {
    await waiting("rev", money("date,howmuch,customer"));
    expect(ids(await manager.metrics("rev"))).toEqual([]);
    const s = await manager.confirm("rev", `version: 1\nmetrics: []\n${role("howmuch", "amount")}`);
    expect(s.status).toBe("awaiting_confirmation");
    const v = await manager.metrics("rev");
    expect(ids(v)).toContain("revenue");
    // The explanation step needs a model, which this test does not have; the job resuming is what is checked.
    expect((await manager.confirm("rev", v.yaml)).status).toBe("queued");
    await manager.wait("rev");
  }, 120_000);

  it("is accepted when the edited roles still draft nothing", async () => {
    await waiting("rev-none", odd);
    const v = await manager.metrics("rev-none");
    const first = v.roles[0];
    const col = first?.column ?? v.columns_without_role[0]?.column ?? "foo";
    const to = first?.role === "dimension" ? "measure" : "dimension";
    await manager.confirm("rev-none", `version: 1\nmetrics: []\n${role(col, to)}`);
    expect((await manager.wait("rev-none")).status).toBe("done");
    expect((await manager.report("rev-none")).summary.no_numbers).toBe("headers_not_recognised");
  }, 120_000);
});

describe("the redrafted list decides whether an empty one is accepted", () => {
  it("first draft empty, a revision drafts metrics: the empty list is then refused", async () => {
    await waiting("re-i", money("date,howmuch,customer"));
    expect((await manager.confirm("re-i", `version: 1\n${role("howmuch", "amount")}`)).status).toBe("awaiting_confirmation");
    expect(ids(await manager.metrics("re-i"))).toContain("revenue");
    await expect(manager.confirm("re-i", EMPTY_YAML)).rejects.toThrow(/no metric definitions given/);
  }, 120_000);

  it("first draft has metrics, a revision drafts none: the empty list is then accepted", async () => {
    await waiting("re-ii", money("date,amount,customer"));
    expect(ids(await manager.metrics("re-ii"))).toContain("revenue");
    await manager.confirm("re-ii", `version: 1\n${role("amount", "none")}`);
    expect(ids(await manager.metrics("re-ii"))).toEqual([]);
    await manager.confirm("re-ii", EMPTY_YAML);
    expect((await manager.wait("re-ii")).status).toBe("done");
    expect((await manager.report("re-ii")).summary.no_numbers).toBe("headers_not_recognised");
  }, 120_000);
});
