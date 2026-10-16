// The HTTP layer under the OpenAI-compatible providers. Two fixes found running against Groq (M11):
// 1. A tool loop sends the model's own reasoning back as `reasoning_content` on assistant messages, which some
//    endpoints refuse ("property 'reasoning_content' is unsupported"). The reasoning is the model's scratchpad,
//    not part of the conversation, so it is dropped from requests.
// 2. Free tiers rate-limit by tokens per minute (HTTP 429). The request is retried after the wait the endpoint
//    asks for (Retry-After, or "try again in 24.7s" in the body), within a cap, instead of failing the stage.
// 4. With several routes for one model (router.ts), a 429 before the first request went out hands the call back to
//    the router instead of waiting, and every response's x-ratelimit-* headers feed the route's bucket.
// 5. Successful responses are cached by hash(URL, body) when a cache is given, and every call is reported with the
//    provider and model that served it.
// 3. Some free tiers also cap output tokens per minute and refuse a request whose possible output exceeds it
//    (HTTP 413 "Request too large … output tokens per minute (OTPM): Limit 1000"). Waiting doesn't help; the request
//    is retried once with `max_tokens` just under the limit.

import { cacheKey, type ResponseCache } from "./cache.ts";
import { RouteBusyError, type RouteLease } from "./router.ts";

export interface ProviderFetchOptions {
  /** Retries after a 429 (default 4). */
  readonly maxRetries?: number;
  /** Longest single wait in ms (default 90 s); a longer requested wait fails at once. */
  readonly maxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Timeout of each HTTP request (the model's `timeouts.model_ms`). */
  readonly timeoutMs?: number;
  /** The router's lease on this route: rate headers go to its bucket, and a 429 may hand off to another route. */
  readonly lease?: RouteLease;
  /** Serve and store successful responses by hash(URL, request body). */
  readonly cache?: ResponseCache;
  /** Every call, with the provider and model that served it (M13a). */
  readonly onCall?: (c: CallRecord) => void;
  /** Who is calling, for the call record. */
  readonly label?: { readonly role?: string; readonly provider: string; readonly endpoint?: string };
}

export interface CallRecord {
  readonly role?: string;
  readonly provider: string;
  readonly endpoint?: string;
  /** The model id as sent to the provider. */
  readonly model: string;
  readonly status: number;
  readonly cached: boolean;
  readonly ms: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

const modelOf = (body: unknown) => {
  try {
    return typeof body === "string" ? String((JSON.parse(body) as { model?: unknown }).model ?? "") : "";
  } catch {
    return "";
  }
};

const usageOf = (text: string): { inputTokens?: number; outputTokens?: number } => {
  try {
    const u = (JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    return {
      ...(u?.prompt_tokens !== undefined ? { inputTokens: u.prompt_tokens } : {}),
      ...(u?.completion_tokens !== undefined ? { outputTokens: u.completion_tokens } : {}),
    };
  } catch {
    return {};
  }
};

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The output-tokens-per-minute limit a 413 names, if any. */
export function outputLimit(body: string): number | undefined {
  const m = /output tokens per minute[^\n]*?Limit\s+(\d+)/i.exec(body);
  return m ? Number(m[1]) : undefined;
}

function withMaxTokens(body: unknown, max: number): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.stringify({ ...(JSON.parse(body) as object), max_tokens: max });
  } catch {
    return body;
  }
}

/** Milliseconds a 429 asks us to wait: the Retry-After header (seconds), else "try again in 1m2.5s" in the body. */
export function retryAfterMs(headers: Headers, body: string): number | undefined {
  const h = headers.get("retry-after");
  if (h && Number.isFinite(Number(h))) return Number(h) * 1000;
  const m = /try again in (?:(\d+)m)?([\d.]+)(ms|s)/i.exec(body);
  if (!m) return undefined;
  const value = Number(m[2]);
  return (Number(m[1] ?? 0) * 60 + (m[3] === "ms" ? value / 1000 : value)) * 1000;
}

function withoutReasoning(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    const json = JSON.parse(body) as { messages?: Record<string, unknown>[] };
    if (!Array.isArray(json.messages) || !json.messages.some((m) => "reasoning_content" in m)) return body;
    json.messages = json.messages.map(({ reasoning_content: _, ...m }) => m);
    return JSON.stringify(json);
  } catch {
    return body;
  }
}

export function providerFetch(base: typeof fetch = fetch, o: ProviderFetchOptions = {}): typeof fetch {
  const maxRetries = o.maxRetries ?? 4;
  const maxWait = o.maxWaitMs ?? 90_000;
  const sleep = o.sleep ?? sleepFor;
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = init?.body;
    let req: RequestInit | undefined =
      init && body !== undefined && body !== null ? { ...init, body: withoutReasoning(body) as string } : init;
    const started = Date.now();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const record = (status: number, cached: boolean, text?: string) =>
      o.onCall?.({
        ...(o.label?.role ? { role: o.label.role } : {}),
        provider: o.label?.provider ?? "unknown",
        ...(o.label?.endpoint ? { endpoint: o.label.endpoint } : {}),
        model: modelOf(req?.body),
        status,
        cached,
        ms: Date.now() - started,
        ...(text ? usageOf(text) : {}),
      });
    const key = o.cache && typeof req?.body === "string" ? cacheKey(url, req.body) : undefined;
    if (key && o.cache) {
      const hit = o.cache.get(key);
      if (hit !== undefined) {
        // A cached step counts as progress like a live one: tools may have run on it, so the call stays on this route.
        o.lease?.started();
        record(200, true, hit);
        return new Response(hit, { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    for (let attempt = 0; ; attempt++) {
      // The timeout is per request, so the waits between attempts don't count against it.
      const signals = [req?.signal, o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined].filter((x): x is AbortSignal => !!x);
      const res = await base(input, { ...req, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) });
      o.lease?.observe(res.headers);
      if (res.ok) {
        // From now on the call has made progress (a tool loop may have run tools): it stays on this route.
        o.lease?.started();
        const text = await res.clone().text();
        if (key && o.cache && cacheable(text)) o.cache.set(key, text);
        record(res.status, false, text);
        return res;
      }
      if (res.status === 413 && attempt === 0 && req?.body) {
        const limit = outputLimit(await res.clone().text());
        if (limit && limit > 64) {
          req = { ...req, body: withMaxTokens(req.body, Math.floor(limit * 0.95)) as string };
          continue;
        }
      }
      if (res.status !== 429 || attempt >= maxRetries) {
        record(res.status, false);
        return res;
      }
      const text = await res.clone().text();
      const wait = retryAfterMs(res.headers, text) ?? 2 ** attempt * 5_000;
      // Another route of the same model may be free right now: hand the call back to the router.
      if (o.lease?.shouldYield(wait)) {
        record(res.status, false);
        throw new RouteBusyError(wait);
      }
      if (wait > maxWait) {
        record(res.status, false);
        return res;
      }
      await sleep(wait + 250);
    }
  }) as typeof fetch;
}

/**
 * Only a complete answer is cached: a 200 can still carry `{"error": …}` (OpenRouter) or an answer cut off at the
 * token limit, and a rerun must not replay that failure.
 */
function cacheable(text: string): boolean {
  try {
    const j = JSON.parse(text) as { error?: unknown; choices?: { finish_reason?: string }[] };
    return !j.error && !!j.choices?.length && j.choices.every((c) => c.finish_reason === "stop" || c.finish_reason === "tool_calls");
  } catch {
    return false;
  }
}
