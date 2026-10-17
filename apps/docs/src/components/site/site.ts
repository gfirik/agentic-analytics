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

export const DOCS_HOME = "start/what-it-is/";
