import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { printingShopFiles } from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "printing-shop-v1", "files");

describe("printing-shop-v1", () => {
  it("committed files equal a fresh deterministic build, and nothing else is in the folder", () => {
    const built = printingShopFiles();
    expect(readdirSync(dir).sort()).toEqual(Object.keys(built).sort());
    for (const [name, data] of Object.entries(built)) expect(new Uint8Array(readFileSync(join(dir, name)))).toEqual(data);
  });

  it("stays under ingest's 50-file job limit", () => {
    expect(Object.keys(printingShopFiles()).length).toBeLessThanOrEqual(50);
  });
});
