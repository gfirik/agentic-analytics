// What public/og.png and public/favicon.ico are rendered from (scripts/site-assets.ts). The renderer records this hash
// in scripts/site-assets.json; scripts/test/site-assets.test.ts fails when an input changed without re-rendering.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DOCS_DIR = join(import.meta.dirname, "..");
const ROOT = join(DOCS_DIR, "..", "..");

/** The inputs, as paths relative to the repo root: the run data, the mark, the renderer and the font versions. */
export const SITE_ASSET_INPUTS = [
  "docs/assets/readme/pipeline.json",
  "apps/docs/public/favicon.svg",
  "apps/docs/scripts/site-assets.ts",
  "apps/docs/package.json",
] as const;

export function siteAssetInputsHash(): string {
  const h = createHash("sha256");
  for (const rel of SITE_ASSET_INPUTS) {
    h.update(rel);
    h.update(readFileSync(join(ROOT, rel)));
  }
  return h.digest("hex");
}

export const SITE_ASSETS_MANIFEST = join(DOCS_DIR, "scripts", "site-assets.json");
