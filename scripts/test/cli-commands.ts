// Checks that a shown `aa …` or `bun run …` command exists: the subcommand and every --flag against the CLI's citty
// definitions (apps/cli/src/main.ts), and every `bun run` script against the package.json that runs it. Scripts that
// run the CLI (`bun run eval -- …`) are checked as the `aa` command they expand to. Shared by the site's command test
// (site-commands.test.ts) and the Kaggle notebook's (kaggle-notebook.test.ts).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");

// ── The CLI, read from its source (main.ts runs the CLI on import, so it is parsed, not imported) ──
const main = readFileSync(join(ROOT, "apps", "cli", "src", "main.ts"), "utf8");
export const commands = new Map<string, Set<string>>();
for (const chunk of main.split("defineCommand(").slice(1)) {
  const name = /meta:\s*\{\s*name:\s*"([\w-]+)"/.exec(chunk)?.[1];
  if (!name || name === "aa") continue;
  const own = chunk.split(/subCommands:/)[0] ?? chunk;
  const flags = new Set([...own.matchAll(/"?([a-z][a-z-]*)"?:\s*\{\s*type:\s*"(?:string|boolean)"/g)].map((m) => m[1] as string));
  commands.set(name, flags);
}
export const top = new Set(
  (/export const main = defineCommand\(\{[\s\S]*?subCommands:\s*\{([^}]*)\}/.exec(main)?.[1] ?? "")
    .split(",")
    .map((s) => s.split(":")[0]?.trim())
    .filter((s): s is string => Boolean(s)),
);
const jobsSource = /const jobs = defineCommand\(([\s\S]*?)\n\}\);/.exec(main)?.[1] ?? "";
export const nested: Record<string, Set<string>> = {
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

/** Checks `aa <args…>`; returns why it doesn't exist, or undefined. */
export function checkAa(args: string[]): string | undefined {
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
export function checkBunRun(args: string[]): string | undefined {
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
export const words = (line: string) =>
  (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^\[|\]$/g, "")).filter((w) => w && w !== "\\");
