import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cacheRoot, NativeLibError, stageNativeLib } from "../src/native-lib.ts";

const root = mkdtempSync(join(tmpdir(), "aa-native-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("stageNativeLib (standalone binary)", () => {
  it("writes the embedded library once per version, and rewrites a copy of the wrong size", async () => {
    const src = join(root, "embedded.so");
    writeFileSync(src, "LIBDUCKDB-BYTES");
    let reads = 0;
    const o = {
      embedded: src,
      name: "libduckdb.so",
      version: "1.5.6",
      read: async (p: string) => {
        reads++;
        return new Uint8Array(readFileSync(p));
      },
      size: (p: string) => statSync(p).size,
      env: { XDG_CACHE_HOME: join(root, "cache") },
      platform: "linux" as const,
      arch: "x64",
    };
    const path = await stageNativeLib(o);
    expect(path).toBe(join(root, "cache", "agentic-analytics", "native", "duckdb-1.5.6-linux-x64", "libduckdb.so"));
    expect(readFileSync(path, "utf8")).toBe("LIBDUCKDB-BYTES");
    await stageNativeLib(o);
    expect(reads).toBe(1);
    writeFileSync(path, "partial");
    await stageNativeLib(o);
    expect(reads).toBe(2);
    expect(readFileSync(path, "utf8")).toBe("LIBDUCKDB-BYTES");
  });

  it("uses the platform's cache folder", () => {
    expect(cacheRoot({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32")).toBe("C:\\Users\\u\\AppData\\Local");
    expect(cacheRoot({ XDG_CACHE_HOME: "/x/cache" }, "linux")).toBe("/x/cache");
    expect(cacheRoot({}, "darwin")).toMatch(/Library[/\\]Caches$/);
  });

  it("a cache folder that can't be written is a typed error", async () => {
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "a file where the cache folder should be");
    await expect(
      stageNativeLib({
        embedded: join(root, "embedded.so"),
        name: "libduckdb.so",
        version: "9.9.9",
        read: async () => new Uint8Array([1]),
        size: () => 1,
        env: { XDG_CACHE_HOME: blocker },
        platform: "linux",
        arch: "x64",
      }),
    ).rejects.toThrow();
    void NativeLibError;
  });
});
