// examples/coffee-roaster is the demo input (README, docs, GIF): it must stay byte-identical to the generated
// eval dataset it is copied from.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "..", "..", "examples", "coffee-roaster");

describe("examples/coffee-roaster", () => {
  it("matches the coffee-roaster-v1 dataset byte for byte", () => {
    const files = coffeeRoasterFiles();
    expect(readdirSync(dir).sort()).toEqual(Object.keys(files).sort());
    for (const [name, bytes] of Object.entries(files))
      expect(Buffer.compare(readFileSync(join(dir, name)), Buffer.from(bytes)), name).toBe(0);
  });
});
