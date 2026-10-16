// The standalone `aa` binary (`bun build --compile`, scripts/build-binary.ts) embeds DuckDB's shared library, because
// the DuckDB addon links against libduckdb.so / libduckdb.dylib / duckdb.dll, which a compiled binary can't carry next
// to the addon it extracts. At start the library is written once to a per-version cache folder and loaded by its full
// path before the addon, which then finds it already loaded. Node runs of the CLI never use this module.
import { mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
  readonly arch?: string;
}

/** Thrown when the embedded library can't be staged (a read-only cache, a full disk). */
export class NativeLibError extends Error {
  readonly code = "NATIVE_LIB";
}

const sizeOf = (path: string): number | undefined => {
  try {
    return statSync(path).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
};

/** The per-user cache folder: XDG_CACHE_HOME or ~/.cache, ~/Library/Caches on macOS, LOCALAPPDATA on Windows. */
export function cacheRoot(env: Readonly<Record<string, string | undefined>> = process.env, platform = process.platform): string {
  if (platform === "win32") return env.LOCALAPPDATA ?? tmpdir();
  if (platform === "darwin") return join(homedir(), "Library", "Caches");
  return env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}

/** Writes the embedded library to the cache (unless an identical-size copy is there) and returns its path. */
export async function stageNativeLib(o: StageOptions): Promise<string> {
  // One folder per version, platform and architecture: x64 and arm64 binaries sharing a home never swap copies.
  const platform = o.platform ?? process.platform;
  const dir = join(cacheRoot(o.env, platform), "agentic-analytics", "native", `duckdb-${o.version}-${platform}-${o.arch ?? process.arch}`);
  const target = join(dir, o.name);
  const want = o.size(o.embedded);
  const fail = (err: unknown): never => {
    throw new NativeLibError(`could not stage ${o.name} in ${dir}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  };
  let have: number | undefined;
  try {
    have = sizeOf(target);
  } catch (err) {
    fail(err);
  }
  if (have === want) return target;
  // Write beside it, then rename: two binaries starting at once never load a half-written library.
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, await o.read(o.embedded));
  } catch (err) {
    fail(err);
  }
  try {
    renameSync(tmp, target);
  } catch (err) {
    // On Windows a DLL another binary has just staged and loaded can't be replaced: use that complete copy.
    try {
      unlinkSync(tmp);
    } catch {
      // Best effort: a leftover .tmp is rewritten on the next start.
    }
    if (sizeOf(target) === want) return target;
    fail(err);
  }
  return target;
}
