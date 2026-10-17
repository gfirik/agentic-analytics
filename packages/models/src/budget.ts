// Input-token estimates (docs/specs/models.md §5 "Input budget"). Free tiers refuse a request whose input is over
// their tokens-per-minute limit (Groq: "Request too large … ITPM: Limit 7000"), and waiting doesn't help, so a
// caller with a budget must know the request's size before sending it. There is no tokenizer here (each model has
// its own and none is free to load in-process for every provider); this is a deterministic, conservative estimate.
//
// The rule: every digit and every non-ASCII character counts as one token, everything else as one token per 3.2
// characters, plus 8 tokens per chat message. Calibrated on 97 real requests replayed from the eval cache (Groq,
// qwen/qwen3.8-27b and gpt-oss-120b/20b, 2026-10-17): the estimate was 1.11–1.26× the provider's own
// `prompt_tokens`, never below it. Digits weigh most because Qwen-style tokenizers split numbers into single
// digits, which is why a fact sheet runs near 3 characters per token while prose runs near 4.
import { type ZodType, z } from "zod";
import { ModelError } from "./errors.ts";
import { DEFAULT_MAX_RETRIES, FEEDBACK_MAX_CHARS, feedbackSuffix } from "./retry.ts";

const OTHER_CHARS_PER_TOKEN = 3.2;
const PER_MESSAGE = 8;

/** Conservative token estimate of a text: digits and non-ASCII characters one each, the rest 3.2 characters a token. */
export function estimateTokens(text: string): number {
  let heavy = 0;
  let other = 0;
  // `for … of` walks code points, so a character outside the BMP counts once.
  for (const ch of text) {
    if ((ch >= "0" && ch <= "9") || ch > "\x7f") heavy++;
    else other++;
  }
  return heavy + Math.ceil(other / OTHER_CHARS_PER_TOKEN);
}

/** The schema text a structured-output request carries (in the system prompt or as `response_format`). */
export const schemaText = (schema: ZodType): string => JSON.stringify(z.toJSONSchema(schema));

/** The instruction ai-sdk.ts appends to the system prompt when the endpoint has no native structured outputs. */
export const schemaInstruction = (schema: ZodType): string =>
  `\n\nRespond with JSON only. It must match this JSON Schema:\n${schemaText(schema)}`;

export interface ObjectRequest {
  readonly system: string;
  readonly prompt: string;
  readonly schema: ZodType;
  readonly maxRetries?: number;
}

/**
 * The estimated input of a structured-output request: the system prompt, the JSON Schema (counted whether it travels
 * in the prompt or as `response_format`, since providers count both), the prompt, and, when retries are allowed, the
 * longest retry feedback (FEEDBACK_MAX_CHARS at one token a character, the all-digits worst case). Every attempt of
 * the call is therefore within the estimate.
 */
export function estimateObjectRequest(args: ObjectRequest): number {
  const retries = (args.maxRetries ?? DEFAULT_MAX_RETRIES) > 0;
  return (
    estimateTokens(args.system) +
    estimateTokens(schemaInstruction(args.schema)) +
    estimateTokens(args.prompt) +
    (retries ? estimateTokens(feedbackSuffix("")) + FEEDBACK_MAX_CHARS : 0) +
    2 * PER_MESSAGE
  );
}

/**
 * Refuses, before anything is sent, a structured-output call whose estimated input is over its `maxInputTokens`
 * (INPUT_TOO_LARGE). The provider would refuse it anyway, with an error that waiting can't fix.
 */
export function checkInputBudget(args: ObjectRequest & { readonly maxInputTokens?: number }): void {
  if (args.maxInputTokens === undefined) return;
  const estimate = estimateObjectRequest(args);
  if (estimate > args.maxInputTokens)
    throw new ModelError(
      "INPUT_TOO_LARGE",
      `the request is about ${estimate} input tokens (estimated), over its budget of ${args.maxInputTokens}; it was not sent`,
    );
}
