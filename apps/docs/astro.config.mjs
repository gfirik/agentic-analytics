// The docs site (docs/DOCS-SITE.md): Astro Starlight, deployed to GitHub Pages under /agentic-analytics/.
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://gfirik.github.io",
  base: "/agentic-analytics",
  integrations: [
    starlight({
      title: "agentic-analytics",
      description: "Open-source, self-hosted agentic analytics: files in, a verified and cited report out.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/gfirik/agentic-analytics" }],
      sidebar: [
        { label: "Start", autogenerate: { directory: "start" } },
        { label: "How it works", autogenerate: { directory: "how-it-works" } },
        { label: "Use it", autogenerate: { directory: "use-it" } },
        { label: "Reference", autogenerate: { directory: "reference" } },
        { label: "Models", autogenerate: { directory: "models" } },
        { label: "Quality", autogenerate: { directory: "quality" } },
        { label: "Project", autogenerate: { directory: "project" } },
      ],
      editLink: { baseUrl: "https://github.com/gfirik/agentic-analytics/edit/main/apps/docs/" },
    }),
    react(),
  ],
});
