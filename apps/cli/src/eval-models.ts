// The model client `aa eval` builds per dataset (docs/EVALS.md §3), with the response cache on or off, as a function
// so the wiring is tested with a stubbed transport (never a network model, AGENTS.md §2.4).
import {
  type CallRecord,
  createModelClient,
  type Env,
  type ModelClient,
  type ResponseCache,
  type Router,
  type resolveModelConfig,
} from "@agentic-analytics/models";

type Config = ReturnType<typeof resolveModelConfig>;

export interface EvalModelOptions {
  readonly env: Env;
  /** The model config for an environment (one model for every role, or `configured`'s per-role settings). */
  readonly config: (env: Env) => Config;
  /** Shared across datasets and runs: it keeps each route's rate state. */
  readonly router: Router;
  /** The response cache, built only when it is used. */
  readonly cache: () => ResponseCache;
  /** `--no-cache` (implied by `--repeat`): the cache is never built, read or written, so every call is live. */
  readonly cacheOff: boolean;
  readonly log: (c: CallRecord) => void;
  /** Injected in tests; the global fetch otherwise. */
  readonly fetch?: typeof fetch;
}

/** `modelFor(name, onCall)` for evalCommand and evalRepeat. */
export function evalModelFor(o: EvalModelOptions): (name: string, onCall?: (c: CallRecord) => void) => ModelClient {
  let cache: ResponseCache | undefined;
  return (name, onCall) => {
    // One model for every role, unless "configured" keeps the per-role settings.
    const env = name === "configured" ? o.env : { ...o.env, PLANNER_MODEL: name, EXTRACTOR_MODEL: name, JUDGE_MODEL: name };
    if (!o.cacheOff) cache ??= o.cache();
    return createModelClient(o.config(env), {
      env: o.env,
      router: o.router,
      ...(cache ? { cache } : {}),
      ...(o.fetch ? { fetch: o.fetch } : {}),
      onCall: (c) => {
        onCall?.(c);
        o.log(c);
      },
    });
  };
}
