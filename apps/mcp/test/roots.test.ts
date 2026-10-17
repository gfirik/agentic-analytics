// Security review: over HTTP, `analyze_files` reads only inside AA_MCP_ROOTS (none by default); stdio may read any path.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { afterAll, describe, expect, it } from "vitest";
import { allowedPath, mcpHttpHandler, PathNotAllowedError } from "../src/index.ts";

const base = mkdtempSync(join(tmpdir(), "aa-roots-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const root = join(base, "shared");
const outside = join(base, "private");
mkdirSync(root);
mkdirSync(outside);
writeFileSync(join(root, "sales.csv"), "a,b\n1,2\n");
writeFileSync(join(outside, "secret.csv"), "k\nv\n");
symlinkSync(join(outside, "secret.csv"), join(root, "link.csv"));

describe("allowedPath", () => {
  it("stdio ('any') resolves any path", () => {
    expect(allowedPath(join(outside, "secret.csv"), "any")).toBe(join(outside, "secret.csv"));
  });

  it("with no roots (HTTP default), every local path is refused", () => {
    expect(() => allowedPath(join(root, "sales.csv"), [])).toThrow(PathNotAllowedError);
  });

  it("inside a root is allowed; outside, a ../ escape, a symlink out and a prefix look-alike are refused", () => {
    expect(allowedPath(join(root, "sales.csv"), [root])).toMatch(/shared[/\\]sales\.csv$/);
    expect(allowedPath(root, [root])).toMatch(/shared$/);
    for (const p of [join(outside, "secret.csv"), join(root, "..", "private", "secret.csv"), join(root, "link.csv"), `${root}-x`]) {
      expect(() => allowedPath(p, [root]), p).toThrow(PathNotAllowedError);
    }
  });
});

describe("MCP over HTTP (handler level)", () => {
  const manager = new JobManager({
    root: join(base, "jobs"),
    model: coffeePlanner(),
    deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }),
  });
  const rpc = async (handler: (r: Request) => Promise<Response>, body: unknown) => {
    const res = await handler(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
      }),
    );
    return (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
  };
  const call = (handler: (r: Request) => Promise<Response>) =>
    rpc(handler, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "analyze_files", arguments: { paths: [join(root, "sales.csv")] } },
    });

  it("refuses local paths by default, and accepts them inside AA_MCP_ROOTS", async () => {
    const refused = await call(mcpHttpHandler(manager, { today: () => "2026-07-01" }));
    expect(refused.result?.isError).toBe(true);
    expect(refused.result?.content?.[0]?.text).toMatch(/^PATH_NOT_ALLOWED: local paths are off/);
    const allowed = await call(mcpHttpHandler(manager, { today: () => "2026-07-01", roots: [root] }));
    expect(allowed.result?.isError).toBeUndefined();
    const id = allowed.result?.content?.[0]?.text?.match(/^job-[\w-]+/)?.[0];
    expect(id).toBeDefined();
    // The job runs in the background: wait for it, or afterAll removes its folder while it still writes (ENOTEMPTY).
    expect((await manager.wait(id as string)).status).toBe("done");
  });

  it("a configured root that doesn't exist allows nothing and leaks no path", () => {
    expect(() => allowedPath(join(root, "sales.csv"), [join(base, "missing")])).toThrow("path not found or not allowed");
  });
});
