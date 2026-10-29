// Site-wide constants for the landing page, the 404 and the Starlight overrides.
export const SITE_NAME = "agentic-analytics";
export const SITE_URL = "https://gfirik.github.io/agentic-analytics";
export const SITE_DESCRIPTION =
  "An AI analyst you can audit. Open-source and self-hosted: give it a business's files and get back what changed, why, and what to do next, with every number computed by SQL, recomputed by a verifier, and cited.";
export const GITHUB_URL = "https://github.com/gfirik/agentic-analytics";
export const RELEASES_URL = `${GITHUB_URL}/releases`;
export const FHSYSTEMS_URL = "https://fhsystems.dev";
export const OG_IMAGE = `${SITE_URL}/og.png`;
export const OG_IMAGE_ALT = "agentic-analytics: an AI analyst you can audit. Every number computed by SQL, recomputed, and cited.";

/** A path under the site's base (`/agentic-analytics`), for links in .astro files. */
export const withBase = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

/** The docs home (src/content/docs/docs/index.mdx): section cards, never a 404. */
export const DOCS_HOME = "docs/";
export const START_HERE = "start/what-it-is/";

/** The links of the header, on the landing page, the 404 and the docs alike. */
export const SITE_LINKS = [
  { href: "#how", base: "/", label: "How it works" },
  { href: "#results", base: "/", label: "Results" },
  { href: DOCS_HOME, base: "", label: "Docs" },
  { href: GITHUB_URL, base: null, label: "GitHub" },
] as const;

/** A header link's final URL: GitHub as is, the rest under the site's base. */
export const linkHref = (l: (typeof SITE_LINKS)[number]) => (l.base === null ? l.href : withBase(`${l.base}${l.href}`));
