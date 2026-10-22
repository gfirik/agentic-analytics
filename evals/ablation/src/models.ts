// The model clients of the ablation (docs/specs/accuracy.md §8.2). Arm A feeds raw untrusted text to a model, which
// AGENTS.md §2.5 keeps out of the engine, so its text must never reach an engine prompt or the engine's response
// cache: every arm gets its own ModelClient, with no cache at all and its own call log, never the engine's.
import {
  addUsage,
  type CallRecord,
  createModelClient,
  type Env,
  type ModelClient,
  type Router,
  resolveModelConfig,
  type Usage,
  ZERO_USAGE,
} from "@agentic-analytics/models";

export interface ArmClientOptions {
  readonly env: Env;
  /** One per arm, so the arms' rate state is their own. */
  readonly router: Router;
  /** The arm's own call log (written beside the results), never data/logs/model-calls.jsonl. */
  readonly log: (c: CallRecord) => void;
  /** Injected in tests (a stubbed transport, never a network model); the global fetch otherwise. */
  readonly fetch?: typeof fetch;
}

/**
 * A client for one arm: `name` serves every role (the same model in every arm), and no response cache is passed, so
 * nothing is read from or written to evals/.cache (or AA_MODEL_CACHE).
 */
export function armModelClient(name: string, o: ArmClientOptions): ModelClient {
  const env = { ...o.env, PLANNER_MODEL: name, EXTRACTOR_MODEL: name, JUDGE_MODEL: name };
  return createModelClient(resolveModelConfig(env), {
    env: o.env,
    router: o.router,
    ...(o.fetch ? { fetch: o.fetch } : {}),
    onCall: o.log,
  });
}

/** A client that adds up the usage of every call it serves (tokens per arm). */
export function counting(client: ModelClient): { client: ModelClient; usage: () => Usage } {
  let total = ZERO_USAGE;
  return {
    usage: () => total,
    client: {
      async generateObject(args) {
        const r = await client.generateObject(args);
        total = addUsage(total, r.usage);
        return r;
      },
      async generateWithTools(args) {
        const r = await client.generateWithTools(args);
        total = addUsage(total, r.usage);
        return r;
      },
      embed: (texts) => client.embed(texts),
    },
  };
}
