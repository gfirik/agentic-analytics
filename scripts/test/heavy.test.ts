// scripts/heavy.sh runs one heavy job at a time on a machine (AGENTS.md §9): a second job waits for the first one's
// lock instead of running beside it, a nested call (gate.sh running evals) reuses the lock it holds, and a machine
// without flock still runs the job (once, with a warning) instead of looping.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const which = (bin: string) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
const hasFlock = which("flock") !== "";
const script = join(import.meta.dirname, "..", "heavy.sh");
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "aa-heavy-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function env(lock: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { CI: _ci, AA_HEAVY_LOCKED: _held, ...rest } = process.env;
  return { ...rest, AA_HEAVY_LOCK: lock, AA_HEAVY_MIN_MB: "0", ...extra };
}

/** Starts a job that holds the lock for `ms` and resolves once it has taken it (it prints "locked"). */
async function holdLock(lock: string, ms: number, then = "true") {
  const job = spawn("bash", [script, "sh", "-c", `echo locked; sleep ${ms / 1000}; ${then}`], { env: env(lock) });
  let out = "";
  await new Promise<void>((resolve) =>
    job.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes("locked")) resolve();
    }),
  );
  const closed = new Promise<void>((r) => job.on("close", () => r()));
  return { output: () => out, closed };
}

describe.skipIf(!hasFlock)("heavy.sh", () => {
  it("runs the command and passes its exit code through", () => {
    const ok = spawnSync("bash", [script, "sh", "-c", "echo ran; exit 3"], { env: env(join(tmp(), "lock")), encoding: "utf8" });
    expect(ok.stdout.trim()).toBe("ran");
    expect(ok.status).toBe(3);
  });

  it("a second job waits for the first one's lock; a nested call does not wait for its own", async () => {
    const lock = join(tmp(), "lock");
    const first = await holdLock(lock, 1500, `bash ${script} echo nested`);
    const started = Date.now();
    const second = spawnSync("bash", [script, "echo", "second"], { env: env(lock), encoding: "utf8" });
    const waited = Date.now() - started;
    await first.closed;
    expect(second.stdout.trim()).toBe("second");
    expect(second.stderr).toContain("another heavy job is running");
    expect(waited).toBeGreaterThan(900);
    expect(first.output()).toContain("nested");
  });

  it("--if-free skips with exit 75 while another job holds the lock, or when RAM is short", async () => {
    const lock = join(tmp(), "lock");
    const first = await holdLock(lock, 1000);
    const busy = spawnSync("bash", [script, "--if-free", "echo", "ran"], { env: env(lock), encoding: "utf8" });
    await first.closed;
    expect(busy.status).toBe(75);
    expect(busy.stdout).toBe("");
    const short = spawnSync("bash", [script, "--if-free", "echo", "ran"], {
      env: env(lock, { AA_HEAVY_MIN_MB: "999999999" }),
      encoding: "utf8",
    });
    expect(short.status).toBe(75);
    expect(short.stderr).toContain("RAM");
  });

  it("without flock it warns and runs once, marked as holding the lock (so gate.sh's re-exec through it ends)", () => {
    // A PATH with the tools heavy.sh and gate.sh need, but no flock.
    const bin = join(tmp(), "bin");
    mkdirSync(bin);
    for (const tool of ["bash", "sh", "awk", "seq", "cat", "sleep", "tr", "sed", "git", "node", "dirname"]) {
      const path = which(tool);
      if (path) symlinkSync(path, join(bin, tool));
    }
    const res = spawnSync("bash", [script, "sh", "-c", 'echo "locked=$AA_HEAVY_LOCKED"'], {
      env: env(join(tmp(), "lock"), { PATH: bin }),
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(res.stderr).toContain("no flock");
    expect(res.stdout.trim()).toBe("locked=1");
    expect(res.status).toBe(0);
  });
});
