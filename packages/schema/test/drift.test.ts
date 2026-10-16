import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compareSchemas, generateJsonSchemas, hasDrift, jsonSchemaRegistry } from "../src/index.ts";

const registry = { b: z.object({ n: z.number() }), a: z.string() };

describe("schema drift", () => {
  it("generates one file per schema with stable JSON", () => {
    const files = generateJsonSchemas(registry);
    expect(Object.keys(files)).toEqual(["a.json", "b.json"]);
    expect(JSON.parse(files["a.json"] ?? "")).toMatchObject({ type: "string" });
    expect(files["b.json"]?.endsWith("\n")).toBe(true);
  });

  it("reports no drift when committed files match", () => {
    const files = generateJsonSchemas(registry);
    const report = compareSchemas(files, { ...files });
    expect(hasDrift(report)).toBe(false);
  });

  it("reports changed, missing and extra files", () => {
    const files = generateJsonSchemas(registry);
    const report = compareSchemas(files, { "a.json": "{}\n", "old.json": "{}\n" });
    expect(report).toEqual({ changed: ["a.json"], missing: ["b.json"], extra: ["old.json"] });
    expect(hasDrift(report)).toBe(true);
  });

  it("registers the report, metrics, config and events schemas", () => {
    expect(Object.keys(jsonSchemaRegistry).sort()).toEqual(["config.schema", "events.schema", "metrics.schema", "report.schema"]);
  });
});
