// The site's rendered assets (apps/docs/scripts/site-assets.ts) must not go stale: public/og.png and favicon.ico are
// re-rendered whenever the run data, the lettermark, the renderer or the font versions change; so are the engine machine's
// stills, whenever its scene, its station data or the colour tokens change.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_DIR, MACHINE_STILLS, SITE_ASSETS_MANIFEST, siteAssetsManifest } from "../../apps/docs/scripts/site-assets-inputs.ts";
import { STILLS } from "../../apps/docs/src/components/site/engine-machine.ts";

/** A WebP's width and height, from its first chunk (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(b: Buffer): [number, number] {
  expect(b.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(b.subarray(8, 12).toString("latin1")).toBe("WEBP");
  const chunk = b.subarray(12, 16).toString("latin1");
  if (chunk === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (chunk === "VP8X") return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  throw new Error(`unknown WebP chunk ${chunk}`);
}

describe("site assets", () => {
  it("og.png and favicon.ico were rendered from the current inputs, and are the files that render recorded", () => {
    const recorded = JSON.parse(readFileSync(SITE_ASSETS_MANIFEST, "utf8")) as unknown;
    // The inputs' hash catches stale assets; the outputs' sha256 catches a hand-edited manifest or a hand-edited image.
    expect(recorded, "re-render with `bun run --filter @agentic-analytics/docs assets`").toEqual(siteAssetsManifest());
  });

  it("og.png is a 1200×630 PNG and favicon.ico an ICO", () => {
    const png = readFileSync(join(DOCS_DIR, "public", "og.png"));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    const ico = readFileSync(join(DOCS_DIR, "public", "favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2);
  });

  it("the engine machine's stills are a WebP and a PNG each, at the width and height the page gives them", () => {
    expect(MACHINE_STILLS).toHaveLength(4);
    for (const name of ["wide", "tall"] as const) {
      const [w, h] = STILLS[name];
      const png = readFileSync(join(DOCS_DIR, "public", `machine-${name}.png`));
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], name).toEqual([w, h]);
      const webp = readFileSync(join(DOCS_DIR, "public", `machine-${name}.webp`));
      expect(webpSize(webp), name).toEqual([w, h]);
      // The WebP is what browsers fetch; shaded faces cost more than the old line drawing, so the budget is 80 KB (the
      // PNG is the fallback for the rest).
      expect(webp.length, name).toBeLessThan(80_000);
    }
  });
});
