#!/usr/bin/env node
// Runs the TypeScript CLI directly on Node via tsx (no bundled build yet).
import { register } from "tsx/esm/api";

register();
await import("../src/main.ts");
