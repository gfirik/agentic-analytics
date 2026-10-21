// A workspace whose migration fails is closed before the error is thrown, so the file can be opened again
// (code-quality fix 11, store row 1).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Workspace } from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "aa-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Workspace.open", () => {
  it("closes the database it opened when a migration fails, keeping the migration error", async () => {
    const path = join(dir, "job.duckdb");
    // A file whose `files` table already exists with no migration recorded: migration 1 fails on it.
    const raw = await DuckDBInstance.create(path);
    const c = await raw.connect();
    await c.run("CREATE TABLE files (id INTEGER)");
    c.closeSync();
    raw.closeSync();
    // The instance and connection the failed open made are closed (DuckDB lets the same process open the file again
    // either way, so the close itself is what is checked).
    const closedInstance = vi.spyOn(DuckDBInstance.prototype, "closeSync");
    const closedConnection = vi.spyOn(DuckDBConnection.prototype, "closeSync");
    await expect(Workspace.open(path)).rejects.toMatchObject({ code: "MIGRATION" });
    expect(closedInstance).toHaveBeenCalledTimes(1);
    expect(closedConnection).toHaveBeenCalledTimes(1);
    closedInstance.mockRestore();
    closedConnection.mockRestore();
  });
});
