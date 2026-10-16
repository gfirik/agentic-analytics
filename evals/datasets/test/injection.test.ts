import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { injectionFixtures } from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "..", "injection", "fixtures");

describe("injection fixtures", () => {
  it("the committed fixture files equal a fresh build", () => {
    const fixtures = injectionFixtures();
    expect(readdirSync(dir).sort()).toEqual(fixtures.map((f) => f.id).sort());
    for (const fx of fixtures) {
      for (const [name, bytes] of Object.entries(fx.files))
        expect(new Uint8Array(readFileSync(join(dir, fx.id, name))), `${fx.id}/${name}`).toEqual(new Uint8Array(bytes));
      if (fx.page) expect(readFileSync(join(dir, fx.id, "page.html"), "utf8")).toBe(fx.page);
    }
  });
});
