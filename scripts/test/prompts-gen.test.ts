// scripts/prompts-gen.ts is the inlined-prompts check inside `bun run check`: a missing or mistyped mode must fail
// with a usage line instead of exiting 0 having checked nothing.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const tsx = join(root, "node_modules", ".bin", "tsx");
const run = (...args: string[]) => spawnSync(tsx, [join(root, "scripts", "prompts-gen.ts"), ...args], { cwd: root, encoding: "utf8" });

describe("prompts-gen.ts", () => {
  it("exits 2 with a usage line when no mode is given", () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage: tsx scripts/prompts-gen.ts --write | --check");
  });

  it("exits 2 and names an unknown mode", () => {
    const r = run("--chek");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown mode "--chek"');
    expect(r.stdout).toBe("");
  });

  it("--check still passes on the committed generated file", () => {
    const r = run("--check");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("prompts: up to date\n");
  });
});
