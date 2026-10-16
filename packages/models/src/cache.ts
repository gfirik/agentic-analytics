// The response cache (M13a): a model response is a pure function of the request, so an eval rerun with the same
// prompts, model and parameters is served from disk at no cost. The key is the SHA-256 of the URL and the exact
// request body (which holds the model, the messages and every parameter); only successful responses are stored.
// Tools still run locally on replay, so a cached run produces the same facts as the original.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ResponseCache {
  get(key: string): string | undefined;
  set(key: string, body: string): void;
}

export const cacheKey = (url: string, body: string): string => createHash("sha256").update(url).update("\n").update(body).digest("hex");

/** One file per response under `dir/<2 hex>/<key>.json`; writes go through a temp file so a crash never leaves half a response. */
export function fileCache(dir: string): ResponseCache {
  const path = (k: string) => join(dir, k.slice(0, 2), `${k}.json`);
  return {
    get: (k) => (existsSync(path(k)) ? readFileSync(path(k), "utf8") : undefined),
    set: (k, body) => {
      mkdirSync(join(dir, k.slice(0, 2)), { recursive: true });
      const tmp = `${path(k)}.${process.pid}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, path(k));
    },
  };
}

/** In memory, for tests. */
export function memoryCache(): ResponseCache & { readonly size: number } {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k),
    set: (k, b) => void m.set(k, b),
    get size() {
      return m.size;
    },
  };
}
