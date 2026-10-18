// The product site and docs (docs/DOCS-SITE.md, apps/docs/DESIGN.md): Astro Starlight for the docs, fully themed
// with the site's tokens. The landing page (src/pages/index.astro) and the 404 (src/pages/404.astro) are custom
// pages on the same tokens. Deployed to GitHub Pages under /agentic-analytics/.
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const SITE = "https://gfirik.github.io";
const BASE = "/agentic-analytics";
const OG_IMAGE = `${SITE}${BASE}/og.png`;

// Code blocks: GitHub's light syntax colours, re-based onto the site's raised panel (tokens.css --aa-raised), so
// Expressive Code's contrast correction measures against the background readers actually see. Light only.
const RAISED = "#ffffff";

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: "ignore",
  // Inline each page's CSS: no stylesheet request blocks the first paint (Lighthouse ≥ 95 on / and the Learn pages, M13i).
  build: { inlineStylesheets: "always" },
  integrations: [
    starlight({
      title: "agentic-analytics",
      description: "An AI analyst you can audit: files in, a verified and cited report out. Open source and self-hosted.",
      favicon: "/favicon.svg",
      disable404Route: true,
      customCss: [
        "./src/styles/fonts.css",
        "./src/styles/tokens.css",
        "./src/styles/components.css",
        "./src/styles/starlight.css",
        "./src/styles/notes.css",
      ],
      components: {
        Head: "./src/components/starlight/Head.astro",
        Header: "./src/components/starlight/Header.astro",
        Footer: "./src/components/starlight/Footer.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
        ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
        TwoColumnContent: "./src/components/starlight/TwoColumnContent.astro",
        PageSidebar: "./src/components/starlight/PageSidebar.astro",
        PageTitle: "./src/components/starlight/PageTitle.astro",
      },
      head: [
        { tag: "link", attrs: { rel: "icon", href: `${BASE}/favicon.ico`, sizes: "32x32" } },
        { tag: "meta", attrs: { property: "og:image", content: OG_IMAGE } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:image", content: OG_IMAGE } },
        { tag: "meta", attrs: { name: "theme-color", content: "#f8f8f6" } },
      ],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/gfirik/agentic-analytics" }],
      expressiveCode: {
        themes: ["github-light"],
        minSyntaxHighlightingColorContrast: 5,
        customizeTheme: (theme) => {
          const bg = RAISED;
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
          codeFontSize: "0.875rem",
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
      // Learn (M13g) is the beginner path, between the reference-level "How it works" and "Use it".
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
          label: "Learn",
          items: [
            { label: "The big picture", slug: "learn" },
            {
              label: "Stage by stage",
              items: [
                "learn/stages/ingestion",
                "learn/stages/metric-layer",
                "learn/stages/analysis",
                "learn/stages/retrieval",
                "learn/stages/web-lane",
                "learn/stages/planner",
                "learn/stages/verifier",
                "learn/stages/report",
                "learn/stages/models",
                "learn/stages/security",
              ],
            },
            {
              label: "Tutorials",
              items: [
                "learn/tutorials/first-file",
                "learn/tutorials/confirm-metrics",
                "learn/tutorials/documents-as-evidence",
                "learn/tutorials/claude-mcp",
                "learn/tutorials/evals-on-your-data",
              ],
            },
            "learn/glossary",
          ],
        },
        {
          label: "Use it",
          items: ["use-it/overview", "use-it/cli", "use-it/http-api", "use-it/mcp", "use-it/telegram", "use-it/viewer"],
        },
        {
          label: "Reference",
          items: ["reference/overview", "reference/config", "reference/metric-yaml", "reference/report-schema", "reference/templates"],
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
