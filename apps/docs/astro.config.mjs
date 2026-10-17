// The product site and docs (docs/DOCS-SITE.md, apps/docs/DESIGN.md): Astro Starlight for the docs, fully themed
// with the site's tokens. The landing page (src/pages/index.astro) and the 404 (src/pages/404.astro) are custom
// pages on the same tokens. Deployed to GitHub Pages under /agentic-analytics/.
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const SITE = "https://gfirik.github.io";
const BASE = "/agentic-analytics";
const OG_IMAGE = `${SITE}${BASE}/og.png`;

// Code blocks: GitHub's light/dark syntax colours, re-based onto the site's slate surface (tokens.css
// --aa-surface), so Expressive Code's contrast correction measures against the background readers actually see.
const SURFACE = { light: "#eef2f6", dark: "#101a2b" };

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: "ignore",
  integrations: [
    starlight({
      title: "agentic-analytics",
      description: "An AI analyst you can audit: files in, a verified and cited report out. Open source and self-hosted.",
      favicon: "/favicon.svg",
      disable404Route: true,
      customCss: ["./src/styles/fonts.css", "./src/styles/tokens.css", "./src/styles/components.css", "./src/styles/starlight.css"],
      components: {
        Header: "./src/components/starlight/Header.astro",
        Footer: "./src/components/starlight/Footer.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
        PageTitle: "./src/components/starlight/PageTitle.astro",
      },
      head: [
        { tag: "link", attrs: { rel: "icon", href: `${BASE}/favicon.ico`, sizes: "32x32" } },
        { tag: "meta", attrs: { property: "og:image", content: OG_IMAGE } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:image", content: OG_IMAGE } },
        { tag: "meta", attrs: { name: "theme-color", content: "#f7f9fb", media: "(prefers-color-scheme: light)" } },
        { tag: "meta", attrs: { name: "theme-color", content: "#0b1220", media: "(prefers-color-scheme: dark)" } },
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/gfirik/agentic-analytics" }],
      expressiveCode: {
        themes: ["github-dark", "github-light"],
        minSyntaxHighlightingColorContrast: 5,
        customizeTheme: (theme) => {
          const bg = theme.type === "dark" ? SURFACE.dark : SURFACE.light;
          theme.bg = bg;
          theme.colors["editor.background"] = bg;
          theme.colors["editorGroupHeader.tabsBackground"] = bg;
          theme.colors["tab.activeBackground"] = bg;
          theme.colors["titleBar.activeBackground"] = bg;
          theme.colors["terminal.background"] = bg;
          return theme;
        },
        styleOverrides: {
          borderRadius: "4px",
          borderColor: "var(--aa-rule)",
          codeFontFamily: "var(--aa-font-mono)",
          uiFontFamily: "var(--aa-font-sans)",
          codeFontSize: "0.8125rem",
          codeLineHeight: "1.7",
          frames: {
            frameBoxShadowCssValue: "none",
            shadowColor: "transparent",
            editorActiveTabIndicatorTopColor: "var(--aa-ink)",
            terminalTitlebarDotsOpacity: "0",
            terminalTitlebarBorderBottomColor: "var(--aa-rule)",
            editorTabBarBorderBottomColor: "var(--aa-rule)",
            inlineButtonBorder: "var(--aa-rule-strong)",
            inlineButtonForeground: "var(--aa-ink)",
          },
        },
      },
      // Navigation (M13f): sections in reading order, each opening with a page that says what the section is for.
      // A later "Learn" section (concept guides per stage, tutorials) slots in between "How it works" and "Use it".
      sidebar: [
        {
          label: "Start",
          items: [
            "start/what-it-is",
            "start/quickstart",
            "start/first-report",
            { label: "Running on free models", slug: "models/running-free" },
          ],
        },
        { label: "How it works", autogenerate: { directory: "how-it-works" } },
        {
          label: "Use it",
          items: ["use-it/overview", "use-it/cli", "use-it/http-api", "use-it/mcp", "use-it/telegram", "use-it/viewer"],
        },
        {
          label: "Reference",
          items: ["reference/config", "reference/metric-yaml", "reference/report-schema", "reference/templates"],
        },
        { label: "Quality", items: ["quality/evals", "quality/results"] },
        {
          label: "Project",
          items: [
            "project/architecture",
            "project/decisions",
            "project/roadmap",
            "project/changelog",
            "project/contributing",
            "project/security-policy",
          ],
        },
      ],
      editLink: { baseUrl: "https://github.com/gfirik/agentic-analytics/edit/main/apps/docs/" },
    }),
    react(),
  ],
});
