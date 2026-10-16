// Schema-drift check (part of `bun run check`): committed JSON Schema must equal what Zod generates.
// `--write` regenerates the committed files instead of checking them.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareSchemas, generateJsonSchemas, hasDrift, jsonSchemaRegistry } from "@agentic-analytics/schema";

const dir = join(import.meta.dirname, "..", "packages", "schema", "json");
const write = process.argv.includes("--write");

const generated = generateJsonSchemas(jsonSchemaRegistry);
const committed: Record<string, string> = {};
if (existsSync(dir)) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    committed[file] = readFileSync(join(dir, file), "utf8");
  }
}
const report = compareSchemas(generated, committed);

if (write) {
  mkdirSync(dir, { recursive: true });
  for (const file of report.extra) rmSync(join(dir, file));
  for (const [file, body] of Object.entries(generated)) writeFileSync(join(dir, file), body);
  process.stdout.write(`schema: wrote ${Object.keys(generated).length} JSON Schema file(s)\n`);
} else if (hasDrift(report)) {
  process.stderr.write(
    `schema drift: changed=${report.changed.join(",") || "-"} missing=${report.missing.join(",") || "-"} extra=${report.extra.join(",") || "-"}\nRun: bun run schema:write\n`,
  );
  process.exit(1);
} else {
  process.stdout.write(`schema: no drift (${Object.keys(generated).length} schema(s))\n`);
}
