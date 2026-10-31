// The CLI's .env (security §6): read from the folder `aa` runs in, so `cp .env.example .env` at the repo root works.
// A .env anywhere else is named on stderr: one inside a client's unpacked files could set the model routes, the MCP
// roots or AA_ALLOW_NO_AUTH, and it would otherwise be read without a word. Values are never printed.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** The line naming a .env read from `cwd`, or undefined for the repo's own (`root`). Quoted, so a folder name can't
 * put control characters on the terminal. */
export function dotEnvNotice(cwd: string, root: string): string | undefined {
  const path = resolve(cwd, ".env");
  return path === resolve(root, ".env") ? undefined : `aa: reading settings from ${JSON.stringify(path)}`;
}

/** Loads `<cwd>/.env` when there is one; `srcDir` is this package's src (or dist) folder, three levels under the repo. */
export function loadDotEnv(
  srcDir: string,
  cwd = process.cwd(),
  warn: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): void {
  const path = join(cwd, ".env");
  if (!existsSync(path)) return;
  process.loadEnvFile(path);
  const notice = dotEnvNotice(cwd, join(srcDir, "..", "..", ".."));
  if (notice) warn(notice);
}
