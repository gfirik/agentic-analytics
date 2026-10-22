// The CLI's file walker (src/collect.ts): a symlink back to a parent folder must not loop until ELOOP, and a huge
// tree stops at the MCP door's 500-file cap instead of being read into memory.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectPaths } from "../src/collect.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "aa-collect-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("collectPaths", () => {
  it("lists a folder's files in name order and skips a symlink back to a parent", () => {
    const root = tmp();
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "b.csv"), "x\n");
    writeFileSync(join(root, "sub", "a.csv"), "x\n");
    symlinkSync(root, join(root, "sub", "loop"));
    symlinkSync(join(root, "b.csv"), join(root, "c-link.csv"));
    expect(collectPaths([root])).toEqual([join(root, "b.csv"), join(root, "sub", "a.csv")]);
  });

  it("follows a symlink named on the command line, file or folder", () => {
    const root = tmp();
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "sales.csv"), "x\n");
    symlinkSync(join(root, "data", "sales.csv"), join(root, "sales-link.csv"));
    symlinkSync(join(root, "data"), join(root, "data-link"));
    expect(collectPaths([join(root, "sales-link.csv"), join(root, "data-link")])).toEqual([
      join(root, "sales-link.csv"),
      join(root, "data-link", "sales.csv"),
    ]);
  });

  it("stops past 500 files in all with TOO_MANY_FILES", () => {
    const root = tmp();
    for (let i = 0; i < 501; i++) writeFileSync(join(root, `f${i}.csv`), "");
    expect(() => collectPaths([root])).toThrow(expect.objectContaining({ name: "LimitError", code: "TOO_MANY_FILES" }));
    // The cap counts files named one by one as well.
    const files = Array.from({ length: 300 }, (_, i) => join(root, `f${i}.csv`));
    expect(() => collectPaths([...files, ...files])).toThrow(expect.objectContaining({ code: "TOO_MANY_FILES" }));
    expect(collectPaths(files)).toHaveLength(300);
  });
});
