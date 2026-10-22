// The engine-facing model contract (docs/specs/models.md §2). These types are ours, not the AI SDK's,
// so the SDK can be swapped without touching the engine (DECISIONS D4).
import { ModelRole } from "@agentic-analytics/schema";
import type { ZodType, z } from "zod";

// The roles a ModelClient serves: the report's ModelRole minus embedder and reranker, which don't generate text.
const ClientRole = ModelRole.extract(["planner", "extractor", "judge"]);
export type Role = z.infer<typeof ClientRole>;

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * A fixed tool the model may call (AGENTS.md §2.6: no free-form code execution).
 * `execute` uses method syntax on purpose, so a `ToolDef<{ id: string }>` fits in a `ToolSet`.
 */
export interface ToolDef<I = unknown, O = unknown> {
  readonly description: string;
  readonly inputSchema: ZodType<I>;
  execute(input: I): Promise<O>;
}

export type ToolSet = Readonly<Record<string, ToolDef>>;

export interface ToolCallRecord {
  readonly toolName: string;
  readonly input: unknown;
  readonly output?: unknown;
  readonly error?: string;
}

export interface Step {
  readonly text: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly usage: Usage;
}

export interface GenerateObjectArgs<T> {
  readonly role: Role;
  readonly schema: ZodType<T>;
  readonly system: string;
  readonly prompt: string;
  /** Extra attempts after a validation failure, with the error fed back (default 2, models.md §5). */
  readonly maxRetries?: number;
  /**
   * Input budget in estimated tokens: system, schema, prompt and the longest retry feedback (models §5). Over it the
   * call fails with INPUT_TOO_LARGE before anything is sent, and retry feedback is shortened so retries fit too.
   */
  readonly maxInputTokens?: number;
}

export interface GenerateWithToolsArgs {
  readonly role: Role;
  readonly system: string;
  readonly messages: readonly Message[];
  readonly tools: ToolSet;
  readonly maxSteps: number;
}

export interface ModelClient {
  generateObject<T>(args: GenerateObjectArgs<T>): Promise<{ object: T; usage: Usage }>;
  generateWithTools(args: GenerateWithToolsArgs): Promise<{ steps: Step[]; usage: Usage }>;
  embed(texts: readonly string[]): Promise<number[][]>;
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    latencyMs: a.latencyMs + b.latencyMs,
  };
}
