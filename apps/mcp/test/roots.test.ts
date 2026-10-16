// Security review: over HTTP, `analyze_files` reads only inside AA_MCP_ROOTS (none by default); stdio may read any path.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { allowedPath, PathNotAllowedError } from "../src/index.ts";

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
