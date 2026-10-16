// The report headline (report-schema §1): one sentence on the most important finding. The planner writes it with
// placeholders from the findings only; small-model mode, or no findings, uses the first finding's title.
import type { ModelClient } from "@agentic-analytics/models";
import { type Finding, findFreeNumerals, placeholders } from "@agentic-analytics/schema";
import { z } from "zod";
import { renderPrompt } from "./prompts.ts";

const noNumerals = (s: string) => findFreeNumerals(s).length === 0;

export async function writeHeadline(model: ModelClient, findings: readonly Finding[], small: boolean): Promise<string> {
  const first = findings[0];
  if (!first) return "No material changes were found in this period.";
  if (small) return first.title;
  const allowed = new Set(findings.flatMap((f) => f.claims.flatMap((c) => c.facts)));
  const Headline = z.object({
    headline: z
      .string()
      .min(10)
      .max(240)
      .refine(noNumerals, "numbers only as {{N…}} placeholders; no other digits except dates")
      .refine((h) => placeholders(h).every((id) => allowed.has(id)), "use only fact placeholders that appear in the findings"),
  });
  const { object } = await model.generateObject({
    role: "planner",
    schema: Headline,
    system: renderPrompt("summary", {
      findings: JSON.stringify(findings.map((f) => ({ id: f.id, title: f.title, claims: f.claims.map((c) => c.text) }))),
    }),
    prompt: "Write the headline.",
  });
  return object.headline;
}
