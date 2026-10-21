// FakeModel (docs/specs/models.md §6): scripted responses keyed by role and prompt (hash or substring).
// Every unit and integration test uses it; it never touches the network (AGENTS.md §2.4).
import { checkInputBudget } from "../budget.ts";
import { ModelError } from "../errors.ts";
import { generateValidated } from "../retry.ts";
import {
  addUsage,
  type GenerateObjectArgs,
  type GenerateWithToolsArgs,
  type ModelClient,
  type Role,
  type Step,
  type ToolCallRecord,
  type Usage,
  ZERO_USAGE,
} from "../types.ts";

export interface FakeToolCall {
  readonly toolName: string;
  readonly input: unknown;
}

export interface FakeStep {
  readonly text?: string;
  readonly toolCalls?: readonly FakeToolCall[];
}

/** A scripted step, or a function of the steps already taken (to use ids an earlier tool call returned). */
export type FakeScriptStep = FakeStep | ((done: readonly Step[]) => FakeStep);

export interface FakeScriptEntry {
  readonly role?: Role;
  /** Matches when the prompt (or the last user message) contains this text or matches this RegExp. */
  readonly match?: string | RegExp;
  /** Matches an exact prompt by `promptHash(system, prompt)`. */
  readonly promptHash?: string;
  /**
   * For generateObject: the raw object the "model" returns (validated by the caller's schema), or a function of
   * the call that builds it, for scripts that must name ids only known at run time (fact ids, extract ids).
   */
  readonly object?: unknown | ((call: FakeRequest) => unknown);
  /** For generateWithTools: the steps the "model" takes (or a function building them); tool calls run against the real tools. */
  readonly steps?: readonly FakeScriptStep[] | ((call: FakeRequest) => readonly FakeScriptStep[]);
  /** Keep the entry after use (default: each entry answers once, in order). */
  readonly repeat?: boolean;
}

/** What a function-valued script entry sees: the system prompt and the prompt (or last user message). */
export interface FakeRequest {
  readonly role: Role;
  readonly system: string;
  readonly prompt: string;
}

export interface FakeCall {
  readonly kind: "object" | "tools" | "embed";
  readonly role?: Role;
  readonly system?: string;
  readonly prompt: string;
  readonly hash: string;
}

const FAKE_USAGE: Usage = { inputTokens: 10, outputTokens: 5, latencyMs: 0 };

/** FNV-1a over system + prompt, as 8 hex chars. Synchronous and runtime-agnostic. */
export function promptHash(system: string, prompt: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${system}\n${prompt}`) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export class FakeModel implements ModelClient {
  readonly calls: FakeCall[] = [];
  private readonly script: FakeScriptEntry[];

  constructor(
    script: readonly FakeScriptEntry[] = [],
    private readonly options: { embeddingDims?: number } = {},
  ) {
    this.script = [...script];
  }

  async generateObject<T>(args: GenerateObjectArgs<T>): Promise<{ object: T; usage: Usage }> {
    // The real client's budget check: an over-budget call never reaches the script, as it never reaches a provider.
    checkInputBudget(args);
    const { object, usage } = await generateValidated(
      args.schema,
      args.prompt,
      async (prompt) => {
        const hash = promptHash(args.system, prompt);
        this.calls.push({ kind: "object", role: args.role, system: args.system, prompt, hash });
        // Retries carry feedback appended to the prompt, so match on the original prompt.
        const entry = this.take(args.role, args.system, args.prompt, (e) => e.object !== undefined);
        const value =
          typeof entry.object === "function" ? entry.object({ role: args.role, system: args.system, prompt: args.prompt }) : entry.object;
        return { value, usage: FAKE_USAGE };
      },
      args.maxRetries,
      { boundedFeedback: args.maxInputTokens !== undefined },
    );
    return { object, usage };
  }

  async generateWithTools(args: GenerateWithToolsArgs): Promise<{ steps: Step[]; usage: Usage }> {
    const prompt = args.messages.at(-1)?.content ?? "";
    this.calls.push({ kind: "tools", role: args.role, system: args.system, prompt, hash: promptHash(args.system, prompt) });
    const entry = this.take(args.role, args.system, prompt, (e) => e.steps !== undefined);
    const steps: Step[] = [];
    const scripted =
      typeof entry.steps === "function" ? entry.steps({ role: args.role, system: args.system, prompt }) : (entry.steps ?? []);
    for (const scriptedStep of scripted.slice(0, args.maxSteps)) {
      const s = typeof scriptedStep === "function" ? scriptedStep(steps) : scriptedStep;
      const toolCalls: ToolCallRecord[] = [];
      for (const call of s.toolCalls ?? []) {
        const t = args.tools[call.toolName];
        if (!t) {
          toolCalls.push({ toolName: call.toolName, input: call.input, error: `no such tool: ${call.toolName}` });
          continue;
        }
        const parsed = t.inputSchema.safeParse(call.input);
        if (!parsed.success) {
          toolCalls.push({ toolName: call.toolName, input: call.input, error: `invalid input: ${parsed.error.message}` });
          continue;
        }
        // A tool that throws fails the call, as in the real client: it is an engine failure, not a model mistake.
        toolCalls.push({ toolName: call.toolName, input: parsed.data, output: await t.execute(parsed.data) });
      }
      steps.push({ text: s.text ?? "", toolCalls, usage: FAKE_USAGE });
    }
    return { steps, usage: steps.reduce((a, s) => addUsage(a, s.usage), ZERO_USAGE) };
  }

  /** Deterministic bag-of-words hashing embeddings, L2-normalized; similar texts get similar vectors. */
  async embed(texts: readonly string[]): Promise<number[][]> {
    const dims = this.options.embeddingDims ?? 64;
    return texts.map((text) => {
      this.calls.push({ kind: "embed", prompt: text, hash: promptHash("", text) });
      const v = new Array<number>(dims).fill(0);
      for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        const h = Number.parseInt(promptHash("", token), 16);
        v[h % dims] = (v[h % dims] ?? 0) + 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }

  /** Entries not consumed yet (handy to assert a script was fully used). */
  remaining(): readonly FakeScriptEntry[] {
    return this.script;
  }

  private take(role: Role, system: string, prompt: string, kind: (e: FakeScriptEntry) => boolean): FakeScriptEntry {
    const hash = promptHash(system, prompt);
    const i = this.script.findIndex(
      (e) =>
        kind(e) &&
        (e.role === undefined || e.role === role) &&
        (e.promptHash === undefined || e.promptHash === hash) &&
        (e.match === undefined || (typeof e.match === "string" ? prompt.includes(e.match) : e.match.test(prompt))),
    );
    const entry = this.script[i];
    if (!entry) {
      throw new ModelError(
        "FAKE_NO_SCRIPT",
        `FakeModel has no scripted response for role=${role} promptHash=${hash}: ${prompt.slice(0, 80)}`,
      );
    }
    if (!entry.repeat) this.script.splice(i, 1);
    return entry;
  }
}
