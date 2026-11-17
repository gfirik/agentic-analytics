// The generated test count (scripts/test-count.ts): one per `it(`/`test(` declaration, modifiers included, an
// `.each` table once, and nothing for helpers or words that merely contain "it(".
import { describe, expect, it } from "vitest";
import { countDeclarations } from "../test-count.ts";

describe("countDeclarations", () => {
  it("counts each declaration once, with its modifiers", () => {
    const src = [
      'it("a", () => {});',
      '  test("b", () => {});',
      '\tit.skip("c", () => {});',
      '  it.each([1, 2, 3])("d %i", () => {});',
      '  it.concurrent("e", async () => {});',
    ].join("\n");
    expect(countDeclarations(src)).toBe(5);
  });

  it("ignores calls that are not at the start of a line or only end in it", () => {
    const src = ['const x = submit("a");', "  expect(it).toBe(1);", '  commit("b");', '  describe("s", () => {});'].join("\n");
    expect(countDeclarations(src)).toBe(0);
  });
});
