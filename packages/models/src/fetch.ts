// The HTTP layer under the OpenAI-compatible providers. Two fixes found running against Groq (M11):
// 1. A tool loop sends the model's own reasoning back as `reasoning_content` on assistant messages, which some
//    endpoints refuse ("property 'reasoning_content' is unsupported"). The reasoning is the model's scratchpad,
//    not part of the conversation, so it is dropped from requests.
// 2. Free tiers rate-limit by tokens per minute (HTTP 429). The request is retried after the wait the endpoint
//    asks for (Retry-After, or "try again in 24.7s" in the body), within a cap, instead of failing the stage.
// 4. With several routes for one model (router.ts), a 429 before the first request went out hands the call back to
//    the router instead of waiting, and every response's x-ratelimit-* headers feed the route's bucket.
// 5. Successful responses are cached by hash(URL, body) when a cache is given, and every call is reported with the
//    provider and model that served it. A cached answer is served even while every route is rate-limited.
// 3. Some free tiers also cap output tokens per minute and refuse a request whose possible output exceeds it
//    (HTTP 413 "Request too large … output tokens per minute (OTPM): Limit 1000"; Groq sometimes sends the same
//    refusal as a 429). Waiting doesn't help; the request is retried once, at once, with `max_tokens` just under the
//    limit. A 429 takes this path only when it refuses the request outright ("Request too large", or Requested >
//    Limit), before any rate-limit handling, so it neither waits nor hands the call to the router (which would block
//    the route for the requested wait). An OTPM *rate limit* ("Rate limit reached … Used 800, Requested 300") is
//    waited out like any 429. The refusal is logged as a failed call before the re-send.

import { cacheKey, type ResponseCache } from "./cache.ts";
import { ModelError } from "./errors.ts";
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
  readonly label?: {
    readonly role?: string;
    readonly provider: string;
    readonly endpoint?: string;
  };
  /** Secret values (the configured API keys) masked in logged error messages, whatever their format. */
  readonly secrets?: readonly string[];
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
  /**
   * Tokens from the provider's `usage` field (prompt_tokens, completion_tokens); 0 for a cached call, which spends
   * no quota. Absent when the response carried no usage (most failed calls): unknown, not 0.
   */
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** For a failed call, the provider's own short error message (never the prompt; key-like strings masked). */
  readonly error?: string;
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

/** The output-tokens-per-minute limit a 413 (or Groq's 429) names, if any. */
export function outputLimit(body: string): number | undefined {
  const m = /output tokens per minute[^\n]*?Limit\s+(\d+)/i.exec(body);
  return m ? Number(m[1]) : undefined;
}

/**
 * The OTPM limit of a response that refuses the request for its possible output, which a lower `max_tokens` fixes:
 * any 413 naming the limit, or a 429 that says "Request too large" or asks for more than the limit. A 429 "Rate limit
 * reached … OTPM: Limit 1000, Used 800, Requested 300" is a real rate limit (it fits once the minute passes): none.
 */
export function otpmRefusalLimit(status: number, body: string): number | undefined {
  if (status !== 413 && status !== 429) return undefined;
  const limit = outputLimit(body);
  if (limit === undefined || status === 413) return limit;
  const requested = /output tokens per minute[^\n]*?Requested\s+(\d+)/i.exec(body);
  return /request too large/i.test(body) || (requested && Number(requested[1]) > limit) ? limit : undefined;
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

/** providerFetch's defaults: retries after a 429, and the longest single wait (ms). */
export const DEFAULT_MAX_RETRIES = 4;
export const DEFAULT_MAX_WAIT_MS = 90_000;

export function providerFetch(base: typeof fetch = fetch, o: ProviderFetchOptions = {}): typeof fetch {
  const maxRetries = o.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxWait = o.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleep = o.sleep ?? sleepFor;
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = init?.body;
    let req: RequestInit | undefined =
      init && body !== undefined && body !== null ? { ...init, body: withoutReasoning(body) as string } : init;
    const started = Date.now();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const record = (status: number, cached: boolean, text?: string, error?: string) =>
      o.onCall?.({
        ...(o.label?.role ? { role: o.label.role } : {}),
        provider: o.label?.provider ?? "unknown",
        ...(o.label?.endpoint ? { endpoint: o.label.endpoint } : {}),
        model: modelOf(req?.body),
        status,
        cached,
        ms: Date.now() - started,
        ...(cached ? { inputTokens: 0, outputTokens: 0 } : text ? usageOf(text) : {}),
        ...(error ? { error } : {}),
      });
    const fail = async (res: Response) => record(res.status, false, undefined, errorOf(await res.clone().text(), o.secrets));
    const key = o.cache && typeof req?.body === "string" ? cacheKey(url, req.body) : undefined;
    if (key && o.cache) {
      const hit = o.cache.get(key);
      if (hit !== undefined) {
        // A cached step counts as progress like a live one: tools may have run on it, so the call stays on this route.
        o.lease?.started();
        // A cached answer spends no quota: it records 0 tokens, not the usage stored in the answer.
        record(200, true);
        return new Response(hit, { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    if (o.lease) {
      // Every route is limited and this lease only probes the cache: a miss sends nothing.
      if (o.lease.cacheOnly()) throw new RouteBusyError(o.lease.limitedFor());
      // A probe that served earlier steps stays on its route: wait for it, or stop if that is too long.
      const limited = o.lease.limitedFor();
      if (limited > Math.min(maxWait, o.lease.maxWait()))
        throw new ModelError(
          "RATE_LIMITED",
          `route rate-limited for ${Math.ceil(limited / 1000)} s after cached steps; rerun later (cached calls are free)`,
        );
      if (limited > 0) await o.lease.pause(limited + 250);
    }
    let netRetries = 0;
    // One re-send with a lower max_tokens per call, whenever the refusal comes (also after an ordinary 429's wait).
    let lowered = false;
    for (let attempt = 0; ; attempt++) {
      // The timeout is per request, so the waits between attempts don't count against it.
      const signals = [req?.signal, o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined].filter((x): x is AbortSignal => !!x);
      let res: Response;
      try {
        res = await base(input, { ...req, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) });
      } catch (err) {
        // No response at all (a reset connection, a DNS hiccup, the per-request timeout): logged like a failed call,
        // and a transient network error is retried, since nothing has run on this request yet. The caller's own
        // abort is never retried.
        record(0, false, undefined, maskSecrets(describeError(err), o.secrets));
        if (req?.signal?.aborted || !transientNetworkError(err) || netRetries >= MAX_NET_RETRIES) throw err;
        netRetries++;
        await sleep(2_000 * netRetries);
        attempt--;
        continue;
      }
      o.lease?.observe(res.headers);
      if (res.ok) {
        // From now on the call has made progress (a tool loop may have run tools): it stays on this route.
        o.lease?.started();
        const text = await res.clone().text();
        if (key && o.cache && cacheable(text)) o.cache.set(key, text);
        record(res.status, false, text);
        return res;
      }
      if ((res.status === 413 || res.status === 429) && !lowered && req?.body) {
        const limit = otpmRefusalLimit(res.status, await res.clone().text());
        if (limit && limit > 64) {
          // Logged like any failed call, so the call log's 413/429 counts stay true.
          await fail(res);
          lowered = true;
          req = { ...req, body: withMaxTokens(req.body, Math.floor(limit * 0.95)) as string };
          continue;
        }
      }
      if (res.status !== 429 || attempt >= maxRetries) {
        await fail(res);
        return res;
      }
      const text = await res.clone().text();
      const wait = retryAfterMs(res.headers, text) ?? 2 ** attempt * 5_000;
      // Another route of the same model may be free right now: hand the call back to the router.
      if (o.lease?.shouldYield(wait)) {
        await fail(res);
        throw new RouteBusyError(wait);
      }
      if (wait > maxWait) {
        await fail(res);
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

/**
 * A provider's error message, short enough for a log line: `error.message` from a JSON body, else the text. Anything
 * that looks like a key or token is masked, since some providers echo part of the credential back.
 */
export function errorOf(text: string, secrets: readonly string[] = []): string | undefined {
  let msg = text;
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown };
    const e = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? j.detail);
    if (typeof e === "string") msg = e;
    else if (e !== undefined) msg = JSON.stringify(e);
  } catch {
    // Not JSON: keep the text.
  }
  const clean = maskSecrets(msg, secrets).replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 200) : undefined;
}

/** Network retries per request when the provider gives no response at all. */
const MAX_NET_RETRIES = 2;

const causeCode = (err: unknown): string | undefined => {
  const c = err instanceof Error ? (err.cause as { code?: unknown } | undefined) : undefined;
  return typeof c?.code === "string" ? c.code : undefined;
};

/** A thrown fetch error as a short log line: its name, message and cause code (e.g. "TypeError: fetch failed (ECONNRESET)"). */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 200);
  const code = causeCode(err);
  return `${err.name}: ${err.message}${code ? ` (${code})` : ""}`.slice(0, 200);
}

/** A connection-level failure worth one more try; a timeout or an abort is not (it already waited its full time). */
export function transientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error) || err.name === "AbortError" || err.name === "TimeoutError") return false;
  const code = causeCode(err) ?? "";
  return (
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_CLOSED)$/.test(code) ||
    (err.name === "TypeError" && /fetch failed|terminated|socket/i.test(err.message))
  );
}

/**
 * Masks key-like strings in text that leaves the process (logs, job status, API and chat replies): known key prefixes
 * (Groq `gsk_`, OpenAI-style `sk-`/`csk-`, Google `AIza`, NVIDIA `nvapi-`, bearer tokens), the provider's
 * organization id (Groq's ULID form, "in organization `org_01…`": `org_` + 20 or more lowercase letters and digits, as
 * `org_***`) and, exactly, any of the given secret values (the configured API keys, whatever their format).
 */
export function maskSecrets(text: string, secrets: readonly string[] = []): string {
  // Word-bounded, so "whisk-large" or "task-12" stay readable; "bearer" in any case.
  let out = text
    .replace(/\b(gsk_|c?sk-|sk_|AIza|nvapi-)[\w.-]{4,}/g, "$1***")
    .replace(/\b(bearer\s+)[\w.~+/=-]{4,}/gi, "$1***")
    // Long enough that identifiers like `org_name` or `org_region_code` stay readable.
    .replace(/\borg_[0-9a-z]{20,}(?![0-9a-z])/g, "org_***");
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join("***");
  return out;
}
