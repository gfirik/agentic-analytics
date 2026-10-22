// Arm B's containment (accuracy.md §8.2, m14.md item 6): the two-phase build with the source tables only, the locked
// open read back option by option, refused statements from a scripted arm B, the timeout, the memory and spill caps,
// the result caps, the retry budget, and the per-run folder deleted after the run.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { FakeModel } from "@agentic-analytics/models/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AblationError,
  buildSourceDatabase,
  DEFAULT_LIMITS,
  LOCKED_OPTION_NAMES,
  readSources,
  runArmB,
  type SandboxLimits,
  type Sources,
  SqlSandbox,
  type TableInfo,
} from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "aa-ablation-test-"));
let sources: Sources;
let tables: TableInfo[];
const db = join(root, "source.duckdb");

beforeAll(async () => {
  sources = await readSources(Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes })));
  tables = await buildSourceDatabase(db, sources.tables, sources.fileOf);
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A locked open in its own temp dir, closed after `f`. */
async function withSandbox<T>(f: (s: SqlSandbox, tmp: string) => Promise<T>, limits: SandboxLimits = DEFAULT_LIMITS): Promise<T> {
  const tmp = mkdtempSync(join(root, "tmp-"));
  const s = await SqlSandbox.open(db, join(tmp, "spill"), limits);
  try {
    return await f(s, join(tmp, "spill"));
  } finally {
    s.close();
  }
}

/** "953.6 MiB" → bytes; "1GB" → bytes (DuckDB reads sizes back in binary units). */
function bytesOf(v: string): number {
  const m = /^([\d.]+)\s*([KMGT]i?B|bytes)$/i.exec(v.trim());
  if (!m) throw new Error(`not a size: ${v}`);
  const unit = (m[2] as string).toUpperCase();
  const pow = { BYTES: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 }[unit] ?? 0;
  return Number(m[1]) * (unit.includes("I") ? 1024 : 1000) ** pow;
}

describe("phase 1: the source tables only", () => {
  it("the per-run database holds the ingested tables and nothing from the engine's workspace", async () => {
    const names = await withSandbox(async (s) =>
      (await s.run("SELECT table_name FROM information_schema.tables ORDER BY table_name")).rows.map((r) => r[0]),
    );
    // coffee-roaster: Orders, and the Monthly sheet's two tables. No metrics, facts, sources, chunks or issues.
    expect(names).toEqual(["t_t1", "t_t2", "t_t3"]);
    expect(tables.map((t) => [t.name, t.file, t.sheet])).toEqual([
      ["t_t1", "sales-2026.xlsx", "Orders"],
      ["t_t2", "sales-2026.xlsx", "Monthly"],
      ["t_t3", "sales-2026.xlsx", "Monthly"],
    ]);
  });
});

describe("phase 2: the locked open", () => {
  it("applies exactly the nine options, in the stated order", () => {
    expect(LOCKED_OPTION_NAMES).toEqual([
      "temp_directory",
      "max_temp_directory_size",
      "access_mode",
      "enable_external_access",
      "autoinstall_known_extensions",
      "autoload_known_extensions",
      "memory_limit",
      "threads",
      "lock_configuration",
    ]);
  });

  it("reads every option back with current_setting (sizes as bytes, booleans and access_mode case-folded)", async () => {
    const got = await withSandbox(async (s, tmp) => ({ settings: await s.settings(), tmp }));
    const v = got.settings;
    const norm = (x: unknown) => String(x).toLowerCase();
    expect(v.temp_directory).toBe(got.tmp);
    // 1GB = 10^9 bytes, read back as "953.6 MiB" (rounded to 0.1 MiB).
    expect(Math.abs(bytesOf(String(v.max_temp_directory_size)) - 1e9)).toBeLessThan(0.1 * 1024 * 1024);
    expect(Math.abs(bytesOf(String(v.memory_limit)) - 1e9)).toBeLessThan(0.1 * 1024 * 1024);
    expect(norm(v.access_mode)).toBe("read_only");
    expect(norm(v.enable_external_access)).toBe("false");
    expect(norm(v.autoinstall_known_extensions)).toBe("false");
    expect(norm(v.autoload_known_extensions)).toBe("false");
    expect(Number(v.threads)).toBe(2);
    expect(norm(v.lock_configuration)).toBe("true");
    expect(Object.keys(v)).toEqual([...LOCKED_OPTION_NAMES]);
  });
});

/** Arm B scripted to run one statement, then refuse; returns the statement's outcome. */
async function scriptedB(sandbox: SqlSandbox, sql: string) {
  const model = new FakeModel([
    {
      match: "Question:",
      steps: [{ toolCalls: [{ toolName: "run_sql", input: { sql } }] }, { text: '{"answer":"no","refused":true,"caveat":"refused"}' }],
    },
  ]);
  const run = await runArmB(model, sandbox, tables, [], { kind: "question", id: "Q", question: "Run it." });
  return { run, query: run.queries?.[0] };
}

describe("refused statements, from a scripted arm B", () => {
  const REFUSED = [
    "COPY t_t1 TO '/tmp/aa-ablation-leak.csv'",
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM read_text('/etc/hostname')",
    "SELECT * FROM read_blob('/etc/hostname')",
    "SELECT * FROM glob('/*')",
    "INSTALL httpfs",
    "LOAD httpfs",
    "ATTACH '/tmp/aa-ablation-other.duckdb' AS other",
    "SET enable_external_access = true",
    "SET lock_configuration = false",
    "SET memory_limit = '8GB'",
    "PRAGMA threads = 16",
    "CREATE TABLE stolen (a INTEGER)",
  ];
  it.each(REFUSED)("%s → SQL_REFUSED, returned as a tool error that uses one retry", async (sql) => {
    const { run, query } = await withSandbox((s) => scriptedB(s, sql));
    expect(query?.error?.code).toBe("SQL_REFUSED");
    expect(query?.rows).toBeUndefined();
    expect(run.retries).toBe(1);
    expect(run.answer).toMatchObject({ refused: true });
  });

  it("an allowed statement returns rows", async () => {
    const { query } = await withSandbox((s) => scriptedB(s, "SELECT count(*) AS n FROM t_t1 WHERE NOT _is_total"));
    expect(query?.rows?.[0]?.[0]).toBeGreaterThan(1000);
  });
});

describe("timeout, memory and spill", () => {
  it("a runaway cross join is stopped by the timeout (connection.interrupt) with SQL_TIMEOUT", async () => {
    const t0 = Date.now();
    const { query } = await withSandbox((s) => scriptedB(s, "SELECT count(*) FROM range(100000000) a, range(100000000) b"), {
      ...DEFAULT_LIMITS,
      timeoutMs: 1000,
    });
    expect(query?.error?.code).toBe("SQL_TIMEOUT");
    expect(Date.now() - t0).toBeLessThan(15_000);
  });

  it("a statement that holds more than the memory limit fails with SQL_OUT_OF_MEMORY", async () => {
    const { query } = await withSandbox((s) => scriptedB(s, "SELECT list(range) FROM range(400000000)"));
    expect(query?.error?.code).toBe("SQL_OUT_OF_MEMORY");
  }, 60_000);

  // A sort of 12M rows with an md5 key needs more than the 1 GB memory limit, so it spills.
  const SORT = "SELECT count(*) AS n FROM (SELECT range AS i, md5(range::VARCHAR) AS s FROM range(12000000) ORDER BY s)";
  const watch = (dir: string) => {
    let most = 0;
    const timer = setInterval(() => {
      if (existsSync(dir)) most = Math.max(most, readdirSync(dir).length);
    }, 5);
    return () => {
      clearInterval(timer);
      return most;
    };
  };

  it("a sort over the memory limit completes and spills to the per-run temp directory", async () => {
    const { rows, spilled } = await withSandbox(async (s, tmp) => {
      const stop = watch(tmp);
      const r = await s.run(SORT);
      return { rows: r.rows, spilled: stop() };
    });
    expect(rows).toEqual([[12_000_000]]);
    expect(spilled).toBeGreaterThan(0);
  }, 120_000);

  it("the same sort with a tiny max_temp_directory_size (a test-only instance) fails with SQL_OUT_OF_SPACE", async () => {
    const err = await withSandbox((s) => s.run(SORT), { ...DEFAULT_LIMITS, maxTempDirectorySize: "1MB" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AblationError);
    expect((err as AblationError).code).toBe("SQL_OUT_OF_SPACE");
  }, 120_000);
});

describe("result caps and the retry budget", () => {
  it("a result past the row or byte cap is stopped with RESULT_TOO_LARGE", async () => {
    await withSandbox(async (s) => {
      await expect(s.run("SELECT range FROM range(201)")).rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
      expect((await s.run("SELECT range FROM range(200)")).rows).toHaveLength(200);
      await expect(s.run("SELECT repeat('x', 40000) AS big")).rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
    });
  });

  it("a third tool error stops the task (RETRY_BUDGET); the first two come back to the model", async () => {
    const bad = { toolName: "run_sql", input: { sql: "SELECT * FROM no_such_table" } };
    const model = new FakeModel([
      { match: "Question:", steps: [{ toolCalls: [bad] }, { toolCalls: [bad] }, { toolCalls: [bad] }, { text: "{}" }] },
    ]);
    const run = await withSandbox((s) => runArmB(model, s, tables, [], { kind: "question", id: "Q", question: "x" }));
    expect(run.queries?.map((q) => q.error?.code)).toEqual(["SQL_ERROR", "SQL_ERROR", "SQL_ERROR"]);
    expect(run.answer).toBeUndefined();
    expect(run.error).toMatch(/after 2 retries/);
  });

  it("an invalid JSON reply uses a retry too: two bad replies then a good one answers, three don't", async () => {
    const good = '{"answer":"It was 1.","refused":false}';
    const ok = new FakeModel([
      { match: "Question:", steps: [{ text: "I think it is 1" }] },
      { match: "not the JSON answer", steps: [{ text: "{bad" }] },
      { match: "not the JSON answer", steps: [{ text: good }] },
    ]);
    const r1 = await withSandbox((s) => runArmB(ok, s, tables, [], { kind: "question", id: "Q", question: "x" }));
    expect(r1).toMatchObject({ retries: 2, answer: { answer: "It was 1." } });
    const never = new FakeModel([{ steps: [{ text: "no json" }], repeat: true }]);
    const r2 = await withSandbox((s) => runArmB(never, s, tables, [], { kind: "question", id: "Q", question: "x" }));
    expect(r2.answer).toBeUndefined();
    expect(r2.error).toMatch(/not the JSON answer after 2 retries/);
  });
});
