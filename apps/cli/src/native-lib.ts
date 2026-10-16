// The standalone `aa` binary (`bun build --compile`, scripts/build-binary.ts) embeds DuckDB's shared library, because
// the DuckDB addon links against libduckdb.so / libduckdb.dylib / duckdb.dll, which a compiled binary can't carry next
// to the addon it extracts. At start the library is written once to a per-version cache folder and loaded by its full
// path before the addon, which then finds it already loaded. Node runs of the CLI never use this module.
import { mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export interface StageOptions {
  /** The embedded file's path inside the binary. */
  readonly embedded: string;
  /** The library's file name (libduckdb.so, libduckdb.dylib, duckdb.dll). */
  readonly name: string;
  /** DuckDB version: one cache folder per version, so an upgrade never loads an old library. */
  readonly version: string;
  readonly read: (path: string) => Promise<Uint8Array>;
  readonly size: (path: string) => number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
}

/** The per-user cache folder: XDG_CACHE_HOME or ~/.cache, ~/Library/Caches on macOS, LOCALAPPDATA on Windows. */
export function cacheRoot(env: Readonly<Record<string, string | undefined>> = process.env, platform = process.platform): string {
  if (platform === "win32") return env.LOCALAPPDATA ?? tmpdir();
  if (platform === "darwin") return join(homedir(), "Library", "Caches");
  return env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}

/** Writes the embedded library to the cache (unless an identical-size copy is there) and returns its path. */
export async function stageNativeLib(o: StageOptions): Promise<string> {
  const dir = join(cacheRoot(o.env, o.platform), "agentic-analytics", "native", `duckdb-${o.version}`);
  const target = join(dir, o.name);
  const want = o.size(o.embedded);
  let have = -1;
  try {
    have = statSync(target).size;
  } catch {
    // Not staged yet.
  }
  if (have !== want) {
    mkdirSync(dir, { recursive: true });
    // Write beside it, then rename: two binaries starting at once never load a half-written library.
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, await o.read(o.embedded));
    renameSync(tmp, target);
  }
  return target;
}
