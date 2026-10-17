// scripts/heavy.sh runs one heavy job at a time on a machine (AGENTS.md §9): a second job waits for the first one's
// lock instead of running beside it, and a nested call (gate.sh running evals) reuses the lock it holds.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const hasFlock = spawnSync("sh", ["-c", "command -v flock"]).status === 0;
const script = join(import.meta.dirname, "..", "heavy.sh");

function env(lock: string): NodeJS.ProcessEnv {
  const { CI: _ci, AA_HEAVY_LOCKED: _held, ...rest } = process.env;
  return { ...rest, AA_HEAVY_LOCK: lock, AA_HEAVY_MIN_MB: "0" };
}

describe.skipIf(!hasFlock)("heavy.sh", () => {
  it("runs the command and passes its exit code through", () => {
    const lock = join(mkdtempSync(join(tmpdir(), "aa-heavy-")), "lock");
    const ok = spawnSync("bash", [script, "sh", "-c", "echo ran; exit 3"], { env: env(lock), encoding: "utf8" });
    expect(ok.stdout.trim()).toBe("ran");
    expect(ok.status).toBe(3);
  });

  it("a second job waits for the first one's lock; a nested call does not wait for its own", async () => {
    const lock = join(mkdtempSync(join(tmpdir(), "aa-heavy-")), "lock");
    const first = spawn("bash", [script, "sh", "-c", 'sleep 1.5; bash "$0" echo nested', script], { env: env(lock) });
    let nested = "";
    first.stdout.on("data", (d: Buffer) => {
      nested += d.toString();
    });
    await new Promise((r) => setTimeout(r, 300));
    const started = Date.now();
    const second = spawnSync("bash", [script, "echo", "second"], { env: env(lock), encoding: "utf8" });
    const waited = Date.now() - started;
    await new Promise((r) => first.on("close", r));
    expect(second.stdout.trim()).toBe("second");
    expect(second.stderr).toContain("another heavy job is running");
    expect(waited).toBeGreaterThan(900);
    expect(nested.trim()).toBe("nested");
  });
});
