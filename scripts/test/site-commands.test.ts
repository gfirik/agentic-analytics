// Every command the site shows must exist (apps/docs/DESIGN.md §2.5). This test collects each `aa …`, `bun run …`
// and `./aa-<os>-<arch> …` command from the landing page, the 404, the islands and the docs pages. It checks each one:
// the subcommand and every --flag against the CLI's citty definitions (apps/cli/src/main.ts), and every `bun run`
// script against the package.json that runs it. Scripts that run the CLI (`bun run eval -- …`) are checked as the
// `aa` command they expand to.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const DOCS = join(ROOT, "apps", "docs");

// ── The CLI, read from its source (main.ts runs the CLI on import, so it is parsed, not imported) ──
const main = readFileSync(join(ROOT, "apps", "cli", "src", "main.ts"), "utf8");
const commands = new Map<string, Set<string>>();
for (const chunk of main.split("defineCommand(").slice(1)) {
  const name = /meta:\s*\{\s*name:\s*"([\w-]+)"/.exec(chunk)?.[1];
  if (!name || name === "aa") continue;
  const own = chunk.split(/subCommands:/)[0] ?? chunk;
  const flags = new Set([...own.matchAll(/"?([a-z][a-z-]*)"?:\s*\{\s*type:\s*"(?:string|boolean)"/g)].map((m) => m[1] as string));
  commands.set(name, flags);
}
const top = new Set(
  (/export const main = defineCommand\(\{[\s\S]*?subCommands:\s*\{([^}]*)\}/.exec(main)?.[1] ?? "")
    .split(",")
    .map((s) => s.split(":")[0]?.trim())
    .filter((s): s is string => Boolean(s)),
);
const jobsSource = /const jobs = defineCommand\(([\s\S]*?)\n\}\);/.exec(main)?.[1] ?? "";
const nested: Record<string, Set<string>> = {
  jobs: new Set([...jobsSource.matchAll(/(\w+): defineCommand/g)].map((m) => m[1] as string)),
};

// ── package.json scripts ──
type Pkg = { name: string; scripts?: Record<string, string> };
const readPkg = (dir: string) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Pkg;
const rootPkg = readPkg(ROOT);
const packages = new Map<string, Pkg>();
for (const group of ["apps", "packages", "evals"])
  for (const name of readdirSync(join(ROOT, group))) {
    const dir = join(ROOT, group, name);
    if (existsSync(join(dir, "package.json"))) {
      const pkg = readPkg(dir);
      packages.set(pkg.name, pkg);
    }
  }

// ── The site's sources ──
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(astro|tsx|md|mdx)$/.test(name)) out.push(p);
  }
  return out;
}
// The Learn pages (src/content/docs/learn) are under src/content; their recorded transcripts are checked separately.
const sources = [...files(join(DOCS, "src", "pages")), ...files(join(DOCS, "src", "components")), ...files(join(DOCS, "src", "content"))];

/** Code spans: fenced blocks, <pre> blocks and inline `code`, with `\` line continuations joined. */
function codeOf(text: string): string[] {
  const out: string[] = [];
  const plain = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\\\n\s*/g, " ");
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) out.push(...plain(m[1] ?? "").split("\n"));
  for (const m of text.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)) out.push(...plain(m[1] ?? "").split("\n"));
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/<pre[\s\S]*?<\/pre>/g, "");
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) out.push(plain(m[1] ?? ""));
  return out.map((l) => l.replace(/#\s.*$/, "").trim()).filter(Boolean);
}

interface Problem {
  readonly file: string;
  readonly command: string;
  readonly why: string;
}

/** Checks `aa <args…>`; returns why it doesn't exist, or undefined. */
function checkAa(args: string[]): string | undefined {
  const [sub, second] = args;
  if (!sub || sub === "…") return undefined; // the bare name ("alias `aa`", "`bun run aa …` from a clone")
  if (!top.has(sub)) return `no aa subcommand "${sub}"`;
  const leaf = nested[sub] && second && !second.startsWith("-") && !second.startsWith("<") ? second : sub;
  if (leaf !== sub && !nested[sub]?.has(leaf)) return `no "aa ${sub} ${leaf}"`;
  const flags = commands.get(leaf) ?? new Set<string>();
  for (const a of args) {
    if (!a.startsWith("--")) continue;
    const flag = a.slice(2).split("=")[0] as string;
    if (flag !== "help" && !flags.has(flag)) return `"aa ${leaf}" has no --${flag}`;
  }
  return undefined;
}

/** Checks `bun run <…>`. */
function checkBunRun(args: string[]): string | undefined {
  let pkg: Pkg = rootPkg;
  let i = 0;
  if (args[0] === "--filter") {
    const name = args[1] ?? "";
    const found = packages.get(name);
    if (!found) return `no workspace package ${name}`;
    pkg = found;
    i = 2;
  }
  const script = args[i];
  if (!script) return "no script named";
  if (pkg === rootPkg && script === "aa") return checkAa(args.slice(i + 1));
  const body = pkg.scripts?.[script];
  if (body === undefined) return `${pkg.name} has no script "${script}"`;
  // A script that runs the CLI is checked as the aa command it expands to, with anything after `--`.
  const cli = /^node apps\/cli\/bin\/aa\.js\s*(.*)$/.exec(body);
  if (cli) {
    const rest = args.slice(i + 1);
    const extra = rest[0] === "--" ? rest.slice(1) : rest;
    return checkAa([...(cli[1] ?? "").split(/\s+/).filter(Boolean), ...extra]);
  }
  return undefined;
}

/** Split a line into words, keeping quoted strings whole and dropping [ ] around optional parts. */
const words = (line: string) =>
  (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^\[|\]$/g, "")).filter((w) => w && w !== "\\");

function problemsIn(file: string, lines: readonly string[] = codeOf(readFileSync(file, "utf8"))): { checked: number; problems: Problem[] } {
  const problems: Problem[] = [];
  let checked = 0;
  for (const line of lines) {
    // A line can hold alternatives ("aa jobs ls | rm <id>") or several commands joined by && or ;.
    for (const part of line.split(/\s*(?:&&|;|\s\\?\|\s)\s*/)) {
      const w = words(part);
      const at = w.findIndex((x, k) => (x === "aa" || /^(\.\/)?aa-[a-z]+-[a-z0-9]+(\.exe)?$/.test(x)) && w[k - 1] !== "run");
      const bun = w.findIndex((x, k) => x === "bun" && w[k + 1] === "run");
      let why: string | undefined;
      if (bun >= 0) {
        if (bun + 2 >= w.length) continue; // "prefix the commands with `bun run`"
        checked++;
        why = checkBunRun(w.slice(bun + 2));
      } else if (at >= 0 && (at === 0 || /^[A-Z_]+=/.test(w[at - 1] ?? "") || w[at - 1] === "$")) {
        const rest = w.slice(at + 1);
        if (!rest.length) continue;
        checked++;
        why = checkAa(rest);
      } else continue;
      if (why) problems.push({ file: relative(ROOT, file), command: part, why });
    }
  }
  return { checked, problems };
}

describe("commands on the site", () => {
  it("reads the CLI's commands and flags", () => {
    expect([...top].sort()).toEqual(["analyze", "ask", "doctor", "eval", "explain", "jobs", "mcp", "metrics", "run", "serve"]);
    expect(commands.get("analyze")?.has("small-model")).toBe(true);
    expect([...(nested.jobs ?? [])].sort()).toEqual(["ls", "resume", "rm"]);
  });

  it("flags a command that doesn't exist (the check works)", () => {
    expect(checkAa(["analyse", "x"])).toMatch(/no aa subcommand/);
    expect(checkAa(["analyze", "x", "--fast"])).toMatch(/no --fast/);
    expect(checkBunRun(["nope"])).toMatch(/no script/);
    expect(checkBunRun(["eval", "--", "--suite", "full", "--modle", "x"])).toMatch(/no --modle/);
    expect(checkBunRun(["--filter", "@agentic-analytics/telegram", "start"])).toBeUndefined();
  });

  it("every aa / bun run command in the landing page, the 404, the islands and the docs exists", () => {
    let checked = 0;
    const problems: Problem[] = [];
    for (const f of sources) {
      const r = problemsIn(f);
      checked += r.checked;
      problems.push(...r.problems);
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(20);
  });

  it("every MCP client config on the site launches an aa command that exists (the `args` of each server)", () => {
    let checked = 0;
    const problems: Problem[] = [];
    for (const f of sources) {
      for (const m of readFileSync(f, "utf8").matchAll(/```json[^\n]*\n([\s\S]*?)```/g)) {
        const config = JSON.parse(m[1] ?? "{}") as { mcpServers?: Record<string, { args?: string[] }> };
        for (const server of Object.values(config.mcpServers ?? {})) {
          const args = server.args ?? [];
          const at = args.findIndex((a) => /(^|\/)aa\.js$/.test(a));
          if (at < 0) continue;
          checked++;
          const why = checkAa(args.slice(at + 1));
          if (why) problems.push({ file: relative(ROOT, f), command: args.join(" "), why });
        }
      }
    }
    expect(problems).toEqual([]);
    // use-it/mcp and the Learn MCP tutorial.
    expect(checked).toBeGreaterThanOrEqual(2);
    expect(checkAa(["mcp", "--embeder", "hash"])).toMatch(/no --embeder/);
  });

  it("every command of a recorded Learn transcript exists (docs/assets/learn/learn.json)", () => {
    const file = join(ROOT, "docs", "assets", "learn", "learn.json");
    const learn = JSON.parse(readFileSync(file, "utf8")) as { transcripts: Record<string, { command: string }> };
    const commands = Object.values(learn.transcripts).map((t) => t.command);
    const r = problemsIn(file, commands);
    expect(r.problems).toEqual([]);
    expect(r.checked).toBe(commands.length);
  });
});
