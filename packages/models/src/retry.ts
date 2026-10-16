// Structured-output reliability (docs/specs/models.md §5): validate with Zod; on failure retry up to
// `maxRetries` times with the validation error fed back to the model. After that, raise INVALID_OUTPUT so
// the stage can degrade gracefully.
import type { ZodType } from "zod";
import { ModelError } from "./errors.ts";
import { addUsage, type Usage, ZERO_USAGE } from "./types.ts";

/** One raw attempt: returns the candidate value, or a validation message from the provider layer. */
export type RawAttempt = (prompt: string) => Promise<{ value: unknown; usage: Usage } | { invalid: string; usage: Usage }>;

export const DEFAULT_MAX_RETRIES = 2;

export async function generateValidated<T>(schema: ZodType<T>, prompt: string, attempt: RawAttempt, maxRetries = DEFAULT_MAX_RETRIES) {
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
    feedbackPrompt = `${prompt}\n\nYour previous answer was rejected by validation: ${lastError}\nReturn only JSON that matches the schema.`;
  }
  throw new ModelError("INVALID_OUTPUT", `structured output failed validation after ${maxRetries + 1} attempts: ${lastError}`);
}
