// The HTTP layer under the OpenAI-compatible providers. Two fixes found running against Groq (M11):
// 1. A tool loop sends the model's own reasoning back as `reasoning_content` on assistant messages, which some
//    endpoints refuse ("property 'reasoning_content' is unsupported"). The reasoning is the model's scratchpad,
//    not part of the conversation, so it is dropped from requests.
// 2. Free tiers rate-limit by tokens per minute (HTTP 429). The request is retried after the wait the endpoint
//    asks for (Retry-After, or "try again in 24.7s" in the body), within a cap, instead of failing the stage.
// 3. Some free tiers also cap output tokens per minute and refuse a request whose possible output exceeds it
//    (HTTP 413 "Request too large … output tokens per minute (OTPM): Limit 1000"). Waiting doesn't help; the request
//    is retried once with `max_tokens` just under the limit.

export interface ProviderFetchOptions {
  /** Retries after a 429 (default 4). */
  readonly maxRetries?: number;
  /** Longest single wait in ms (default 90 s); a longer requested wait fails at once. */
  readonly maxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Timeout of each HTTP request (the model's `timeouts.model_ms`). */
  readonly timeoutMs?: number;
}

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
    for (let attempt = 0; ; attempt++) {
      // The timeout is per request, so the waits between attempts don't count against it.
      const signals = [req?.signal, o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined].filter((x): x is AbortSignal => !!x);
      const res = await base(input, { ...req, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) });
      if (res.status === 413 && attempt === 0 && req?.body) {
        const limit = outputLimit(await res.clone().text());
        if (limit && limit > 64) {
          req = { ...req, body: withMaxTokens(req.body, Math.floor(limit * 0.95)) as string };
          continue;
        }
      }
      if (res.status !== 429 || attempt >= maxRetries) return res;
      const text = await res.clone().text();
      const wait = retryAfterMs(res.headers, text) ?? 2 ** attempt * 5_000;
      if (wait > maxWait) return res;
      await sleep(wait + 250);
    }
  }) as typeof fetch;
}
