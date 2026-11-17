// The test count the README status line and the landing page's status strip show, generated so it can't drift.
// A vitest run gives the exact number but is too heavy for every generate and `readme:check`, so this counts the
// declarations instead: every `it(` and `test(` (with `.skip`, `.only`, `.todo`, `.concurrent`, `.each`) at the start
// of a line in the files vitest's own include globs select. An `.each` table counts once.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A vitest include glob (`packages/*\/test/**\/*.test.ts`) as a RegExp over repo-relative paths. */
export function globToRegExp(glob: string): RegExp {
  const re = glob
    .split(/(\*\*\/|\*)/)
    .map((part) => (part === "**/" ? "(?:.*/)?" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${re}$`);
}

const DECLARATION = /^[ \t]*(?:it|test)(?:\.(?:skip|only|todo|concurrent|fails|each))*\(/gm;

/** The test declarations in one file's source. */
export const countDeclarations = (source: string): number => source.match(DECLARATION)?.length ?? 0;

const TOP = ["packages", "apps", "evals", "scripts"];
const SKIP = new Set(["node_modules", "dist", ".astro", ".turbo"]);

/** The test files under `root` that `include` (vitest's include globs) selects, and the tests declared in them. */
export function countTests(root: string, include: readonly string[]): { readonly files: number; readonly tests: number } {
  const globs = include.map(globToRegExp);
  const walk = (rel: string): string[] =>
    readdirSync(join(root, rel), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (SKIP.has(e.name) ? [] : walk(`${rel}/${e.name}`)) : [`${rel}/${e.name}`],
    );
  const files = TOP.flatMap(walk).filter((f) => globs.some((g) => g.test(f)));
  return { files: files.length, tests: files.reduce((n, f) => n + countDeclarations(readFileSync(join(root, f), "utf8")), 0) };
}
