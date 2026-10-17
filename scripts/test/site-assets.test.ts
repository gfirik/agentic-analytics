// The site's rendered assets (apps/docs/scripts/site-assets.ts) must not go stale: public/og.png and favicon.ico are
// re-rendered whenever the run data, the mark, the renderer or the font versions change.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_DIR, SITE_ASSETS_MANIFEST, siteAssetInputsHash } from "../../apps/docs/scripts/site-assets-inputs.ts";

describe("site assets", () => {
  it("og.png and favicon.ico were rendered from the current inputs", () => {
    const manifest = JSON.parse(readFileSync(SITE_ASSETS_MANIFEST, "utf8")) as { inputs: string };
    expect(manifest.inputs, "re-render with `bun run --filter @agentic-analytics/docs assets`").toBe(siteAssetInputsHash());
  });

  it("og.png is a 1200×630 PNG and favicon.ico an ICO", () => {
    const png = readFileSync(join(DOCS_DIR, "public", "og.png"));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    const ico = readFileSync(join(DOCS_DIR, "public", "favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2);
  });
});
