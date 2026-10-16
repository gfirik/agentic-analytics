// The engine-facing model contract (docs/specs/models.md §2). These types are ours, not the AI SDK's,
// so the SDK can be swapped without touching the engine (DECISIONS D4).
import type { ZodType } from "zod";

export type Role = "planner" | "extractor" | "judge";

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
