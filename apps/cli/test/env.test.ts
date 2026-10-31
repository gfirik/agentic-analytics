// The CLI names a .env it reads from outside the repo (security §6).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dotEnvNotice, loadDotEnv } from "../src/env.ts";

describe(".env notice", () => {
  it("is silent for the repo's own .env and names any other, quoted", () => {
    expect(dotEnvNotice("/home/u/agentic-analytics", "/home/u/agentic-analytics")).toBeUndefined();
    expect(dotEnvNotice("/home/u/agentic-analytics/", "/home/u/agentic-analytics/apps/cli/src/../../..")).toBeUndefined();
    expect(dotEnvNotice("/home/u/clients/acme", "/home/u/agentic-analytics")).toBe('aa: reading settings from "/home/u/clients/acme/.env"');
    expect(dotEnvNotice("/home/u/x\u001b[2J", "/home/u/agentic-analytics")).not.toContain("\u001b");
  });
});

describe("loadDotEnv", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env.AA_ENV_TEST_KEY;
  });

  it("does nothing when the folder has no .env", () => {
    dir = mkdtempSync(join(tmpdir(), "aa-env-"));
    const lines: string[] = [];
    loadDotEnv("/repo/apps/cli/src", dir, (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it("loads a .env outside the repo and names its path, never its values", () => {
    dir = mkdtempSync(join(tmpdir(), "aa-env-"));
    writeFileSync(join(dir, ".env"), "AA_ENV_TEST_KEY=s3cret-value-123\n");
    const lines: string[] = [];
    loadDotEnv("/repo/apps/cli/src", dir, (line) => lines.push(line));
    expect(process.env.AA_ENV_TEST_KEY).toBe("s3cret-value-123");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(join(dir, ".env"));
    expect(lines[0]).not.toContain("s3cret");
  });
});
