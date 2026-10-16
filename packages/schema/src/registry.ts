import type { ZodType } from "zod";
import { Config } from "./config.ts";
import { JobEvent } from "./events.ts";
import { MetricFile } from "./metric.ts";
import { Report } from "./report.ts";

/**
 * Every schema that is exported as JSON Schema, keyed by output file name (without `.json`).
 * The committed files in `packages/schema/json/` must match what these generate; `bun run check`
 * fails on drift (AGENTS.md §3: JSON Schema is generated from Zod, never hand-written).
 */
export const jsonSchemaRegistry: Readonly<Record<string, ZodType>> = {
  "report.schema": Report,
  "metrics.schema": MetricFile,
  "config.schema": Config,
  "events.schema": JobEvent,
};
