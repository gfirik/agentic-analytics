// The files under the paths given to `aa analyze`, `aa metrics` and `aa run`. It uses the MCP door's walker, so both
// doors read a folder the same way: symlinks inside a folder are skipped (a link back to a parent can't loop until
// the OS throws ELOOP), and at most MAX_FILES files are taken in all (a LimitError, not a whole large tree read into
// memory). A path named on the command line itself is followed even when it is a symlink: the user chose it.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { collectFiles, LimitError, MAX_FILES } from "@agentic-analytics/mcp";

export function collectPaths(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory()) for (const n of readdirSync(p).sort()) collectFiles(join(p, n), out);
    else {
      out.push(p);
      if (out.length > MAX_FILES)
        throw new LimitError("TOO_MANY_FILES", `more than ${MAX_FILES} files under the given paths; point at a smaller folder`);
    }
  }
  return out;
}
