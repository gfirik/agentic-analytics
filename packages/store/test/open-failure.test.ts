// A workspace whose migration fails is closed before the error is thrown, so the file can be opened again
// (code-quality fix 11, store row 1).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, describe, expect, it } from "vitest";
import { Workspace } from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "aa-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Workspace.open", () => {
  it("releases the database when a migration fails, so the next open gets the same clear error", async () => {
    const path = join(dir, "job.duckdb");
    // A file whose `files` table already exists with no migration recorded: migration 1 fails on it.
    const raw = await DuckDBInstance.create(path);
    const c = await raw.connect();
    await c.run("CREATE TABLE files (id INTEGER)");
    c.closeSync();
    raw.closeSync();
    await expect(Workspace.open(path)).rejects.toMatchObject({ code: "MIGRATION" });
    // Opening the file again (the database the failed open created must have been closed).
    const again = await DuckDBInstance.create(path).then(
      (i) => (i.closeSync(), "opened"),
      (err: unknown) => String(err),
    );
    expect(again).toBe("opened");
  });
});
