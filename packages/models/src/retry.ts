// Structured-output reliability (docs/specs/models.md §5): validate with Zod; on failure retry up to
// `maxRetries` times with the validation error fed back to the model. After that, raise INVALID_OUTPUT so
// the stage can degrade gracefully.
import type { ZodType } from "zod";
import { ModelError } from "./errors.ts";
import { addUsage, type Usage, ZERO_USAGE } from "./types.ts";

/** One raw attempt: returns the candidate value, or a validation message from the provider layer. */
export type RawAttempt = (prompt: string) => Promise<{ value: unknown; usage: Usage } | { invalid: string; usage: Usage }>;

export const DEFAULT_MAX_RETRIES = 2;

/** With an input budget, retry feedback quotes at most this many characters of the validation error (models §5). */
export const FEEDBACK_MAX_CHARS = 300;

/** The retry suffix appended to the prompt after a validation failure. */
export const feedbackSuffix = (error: string): string =>
  `\n\nYour previous answer was rejected by validation: ${error}\nReturn only JSON that matches the schema.`;

/**
 * Validation feedback that fits FEEDBACK_MAX_CHARS. The AI SDK's message repeats the model's whole answer before the
 * reason ("Type validation failed: Value: {…}. Error message: [issues]"), so cutting it from the front would keep
 * only the echo; the issues are kept instead, as "path: message", then cut to the limit.
 */
export function boundedFeedback(error: string): string {
  const m = /Error message:\s*(\[[\s\S]*\])\s*$/.exec(error);
  let text = error;
  if (m?.[1]) {
    try {
      const issues = JSON.parse(m[1]) as unknown;
      if (Array.isArray(issues))
        text = issues
          .map((i: { path?: unknown; message?: unknown }) => {
            const path = Array.isArray(i.path) ? i.path.join(".") : "";
            return `${path || "(root)"}: ${String(i.message ?? "")}`;
          })
          .join("; ");
    } catch {
      // Not the SDK's JSON issue list: fall back to the text as given.
    }
  }
  return [...text].slice(0, FEEDBACK_MAX_CHARS).join("");
}

export async function generateValidated<T>(
  schema: ZodType<T>,
  prompt: string,
  attempt: RawAttempt,
  maxRetries = DEFAULT_MAX_RETRIES,
  options: { readonly boundedFeedback?: boolean } = {},
) {
  let usage = ZERO_USAGE;
  let feedbackPrompt = prompt;
  let lastError = "";
  for (let i = 0; i <= maxRetries; i++) {
    const res = await attempt(feedbackPrompt);
    usage = addUsage(usage, res.usage);
    if ("value" in res) {
      const parsed = schema.safeParse(res.value);
      if (parsed.success) return { object: parsed.data, usage, attempts: i + 1 };
      lastError = parsed.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ");
    } else {
      lastError = res.invalid;
    }
    // A budgeted call keeps its retries within the budget: the estimate reserves FEEDBACK_MAX_CHARS for the error.
    feedbackPrompt = `${prompt}${feedbackSuffix(options.boundedFeedback ? boundedFeedback(lastError) : lastError)}`;
  }
  throw new ModelError("INVALID_OUTPUT", `structured output failed validation after ${maxRetries + 1} attempts: ${lastError}`);
}
