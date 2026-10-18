// The docs collection. `epigraph` (Learn stage pages): one sentence on the problem the stage solves, set in serif
// italic under the title (PageTitle.astro, DESIGN.md §7).
import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema({ extend: z.object({ epigraph: z.string().optional() }) }) }),
};
