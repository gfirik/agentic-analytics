// Per-model facts (docs/specs/models.md §4). Filled from eval results in M11; never from launch headlines.
export interface ModelProfile {
  readonly id: string; // "ollama:qwen3.5:9b"
  readonly contextTokens: number;
  readonly toolCalling: "reliable" | "flaky" | "none" | "unknown";
  readonly jsonMode: boolean;
  /** Small-model mode halves tool budgets (agent-and-verifier §3). */
  readonly smallModel: boolean;
}

export const MODEL_PROFILES: readonly ModelProfile[] = [];

export function profileFor(id: string): ModelProfile | undefined {
  return MODEL_PROFILES.find((p) => p.id === id);
}
