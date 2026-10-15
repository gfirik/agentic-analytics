import type { ZodType } from "zod";

/**
 * Every schema that is exported as JSON Schema, keyed by output file name (without `.json`).
 * The committed files in `packages/schema/json/` must match what these generate; `bun run check`
 * fails on drift (AGENTS.md §3: JSON Schema is generated from Zod, never hand-written).
 * Empty until M1 adds report v1, metric YAML, config and events.
 */
export const jsonSchemaRegistry: Readonly<Record<string, ZodType>> = {};
