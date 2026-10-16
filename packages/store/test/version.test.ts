import { describe, expect, it } from "vitest";
import { duckdbVersion } from "../src/index.ts";

describe("duckdbVersion", () => {
  it("returns the embedded DuckDB version", async () => {
    expect(await duckdbVersion()).toMatch(/^v1\.\d+\.\d+/);
  });
});
