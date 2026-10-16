// Follow-up questions (interfaces §1 `POST /v1/jobs/{id}/ask`): the planner answers from a verified report only,
// as claims with fact placeholders. It names the report claims each answer rests on and code copies their
// citations and causal grade, so the model never writes a citation. The caller verifies the claims with the same
// passes as the report (agent-and-verifier §7) before showing them.
import type { ModelClient } from "@agentic-analytics/models";
import { type Claim, findFreeNumerals, placeholders, type Report } from "@agentic-analytics/schema";
import { z } from "zod";
import { data, renderPrompt } from "./prompts.ts";

type Grade = NonNullable<Claim["causal_grade"]>;
const GRADES: readonly Grade[] = ["observed", "correlated", "document_supported", "intervention_supported"];

export interface AskDraft {
  /** Unverified claims; verify before showing them. */
  readonly claims: Claim[];
  /** The model's note when the report does not cover the question. */
  readonly notCovered?: string;
}

/** Report claims addressable as "F1#0" / "R2#1". */
export function reportClaims(report: Report): Map<string, Claim> {
  const m = new Map<string, Claim>();
  for (const f of report.findings) for (const [i, c] of f.claims.entries()) m.set(`${f.id}#${i}`, c);
  for (const r of report.recommendations) for (const [i, c] of r.rationale.entries()) m.set(`${r.id}#${i}`, c);
  return m;
}

export async function answerQuestion(model: ModelClient, question: string, report: Report): Promise<AskDraft> {
  const claims = reportClaims(report);
  const facts = new Set(report.facts.map((f) => f.id));
  const Answer = z.object({
    claims: z
      .array(
        z.object({
          text: z
            .string()
            .min(3)
            .max(600)
            .refine((t) => findFreeNumerals(t).length === 0, "numbers only as {{N…}} placeholders; no other digits except dates")
            .refine((t) => placeholders(t).every((id) => facts.has(id)), "use only fact placeholders that appear in the report"),
          facts: z.array(z.string()),
          from: z.array(z.string()).min(1),
        }),
      )
      .max(6),
    not_covered: z.string().max(300).optional(),
  });
  const { object } = await model.generateObject({
    role: "planner",
    schema: Answer,
    system: renderPrompt("ask", {
      question: data(question),
      report: data({
        headline: report.summary.headline,
        facts: report.facts.map((f) => ({ id: f.id, label: f.label, value: f.value, unit: f.unit })),
        claims: [...claims].map(([ref, c]) => ({ ref, text: c.text, grade: c.causal_grade ?? "observed" })),
        findings: report.findings.map((f) => ({ id: f.id, title: f.title })),
        recommendations: report.recommendations.map((r) => ({ id: r.id, action: r.action })),
      }),
    }),
    prompt: "Answer the question.",
  });
  const out: Claim[] = [];
  for (const a of object.claims) {
    const base = a.from.map((ref) => claims.get(ref)).filter((c): c is Claim => c !== undefined);
    // A claim resting on nothing in the report is not an answer; the verifier would drop it anyway.
    if (!base.length) continue;
    const grade = GRADES[Math.min(...base.map((c) => GRADES.indexOf(c.causal_grade ?? "observed")))] ?? "observed";
    const cites = new Map(base.flatMap((c) => c.citations).map((c) => [JSON.stringify(c), c]));
    out.push({
      text: a.text,
      facts: [...new Set([...a.facts.filter((id) => facts.has(id)), ...placeholders(a.text)])],
      citations: [...cites.values()],
      causal_grade: grade,
      verified: false,
    });
  }
  return { claims: out, ...(object.not_covered ? { notCovered: object.not_covered } : {}) };
}
