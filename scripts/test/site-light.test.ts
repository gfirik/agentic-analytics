// The site is light only (apps/docs/DESIGN.md §3): no dark tokens, no theme control, no colour-scheme media queries
// and no stored theme anywhere in the site's sources. The pipeline scene (pipeline-scene.ts) is excluded: it is the
// README GIF's renderer, which still draws a dark variant for GitHub's dark mode; the site never asks for it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCS = join(import.meta.dirname, "..", "..", "apps", "docs");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "data" ? [] : walk(join(dir, e.name))) : [join(dir, e.name)],
  );
const sources = [...walk(join(DOCS, "src")), join(DOCS, "astro.config.mjs")].filter(
  (f) => /\.(css|astro|tsx?|mjs|mdx?)$/.test(f) && !f.endsWith("pipeline-scene.ts"),
);

describe("light only", () => {
  it("no dark tokens, theme control, colour-scheme media query or stored theme in the site's sources", () => {
    const found: string[] = [];
    for (const f of sources) {
      const text = readFileSync(f, "utf8");
      for (const re of [
        /prefers-color-scheme/,
        /data-theme=["']?dark/,
        /starlight-theme/,
        /ThemeToggle/,
        /github-dark/,
        /color-scheme:\s*dark/,
      ])
        if (re.test(text)) found.push(`${f.slice(DOCS.length + 1)}: ${re.source}`);
    }
    expect(found).toEqual([]);
    expect(sources.length).toBeGreaterThan(40);
  });

  it("tokens.css defines each colour once, and DESIGN.md's colour table has the same values", () => {
    const tokens = readFileSync(join(DOCS, "src", "styles", "tokens.css"), "utf8");
    const defs = [...tokens.matchAll(/(--aa-[a-z0-9-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1] as string, m[2] as string] as const);
    expect(new Set(defs.map(([k]) => k)).size).toBe(defs.length);
    const design = readFileSync(join(DOCS, "DESIGN.md"), "utf8");
    const table = [...design.matchAll(/^\| `(--aa-[a-z0-9-]+)` \| `(#[0-9a-f]{6})` \|/gm)].map(
      (m) => [m[1] as string, m[2] as string] as const,
    );
    expect(table.length).toBe(defs.length);
    expect(Object.fromEntries(table)).toEqual(Object.fromEntries(defs));
  });
});
