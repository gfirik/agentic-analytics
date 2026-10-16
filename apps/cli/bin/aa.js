#!/usr/bin/env node
// Runs the TypeScript CLI directly on Node via tsx; a bundled build replaces this in M10.
import { register } from "tsx/esm/api";

register();
await import("../src/main.ts");
