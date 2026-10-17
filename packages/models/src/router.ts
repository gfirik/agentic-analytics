// The provider router (M13a): one model, reachable through several free providers. Each route (provider +
// model) keeps a small token bucket fed by the `x-ratelimit-*` headers and by 429s; a call goes to the first route
// with capacity, falls back to the next route serving the SAME model when one is limited, waits when every route
// will free up soon, and stops with a report when none will. It never switches to another model — the config
// refuses routes that name different models (config.ts), and evals record which route served every call.
import type { RouteModel } from "@agentic-analytics/schema";
import { describeRoleModel } from "./config.ts";
import { ModelError } from "./errors.ts";

/** Rate-limit facts read from a response's headers. */
export interface RateHeaders {
  readonly remainingRequests?: number;
  readonly remainingTokens?: number;
  readonly resetRequestsMs?: number;
  readonly resetTokensMs?: number;
}

/** "2m59.56s", "7.66s", "640ms", or plain seconds → milliseconds. */
export function durationMs(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t) * 1000;
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec(t);
  if (!m || !t) return undefined;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000 + Number(m[4] ?? 0);
}

const MAX_RESET_MS = 24 * 3600_000;

export function readRateHeaders(h: Headers): RateHeaders {
  const num = (k: string) => {
    const v = h.get(k);
    return v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  const out: { -readonly [K in keyof RateHeaders]?: number } = {};
  const rr = num("x-ratelimit-remaining-requests");
  const rt = num("x-ratelimit-remaining-tokens");
  // Groq/OpenAI-style headers only. A reset longer than a day is not a duration (some providers send an epoch
  // timestamp there): ignored rather than blocking the route for decades.
  const reset = (k: string) => {
    const ms = durationMs(h.get(k));
    return ms !== undefined && ms <= MAX_RESET_MS ? ms : undefined;
  };
  const sr = reset("x-ratelimit-reset-requests");
  const st = reset("x-ratelimit-reset-tokens");
  if (rr !== undefined) out.remainingRequests = rr;
  if (rt !== undefined) out.remainingTokens = rt;
  if (sr !== undefined) out.resetRequestsMs = sr;
  if (st !== undefined) out.resetTokensMs = st;
  return out;
}

/** Thrown by the transport when a route is limited and the router prefers to try another route. */
export class RouteBusyError extends Error {
  readonly code = "ROUTE_BUSY";
  constructor(readonly waitMs: number) {
    super(`route rate-limited for ${Math.round(waitMs)} ms`);
    this.name = "RouteBusyError";
  }
}

/** How often one call may try each route before it stops (with RATE_LIMITED) once limits are being hit. */
const MAX_ATTEMPTS_PER_ROUTE = 4;

/** Minimum token headroom before a route counts as empty (a request needs room for its prompt and answer). */
const TOKEN_HEADROOM = 1500;

class RouteState {
  blockedUntil = 0;
  /** When the bucket refills, if the last response said it was (nearly) empty. */
  emptyUntil = 0;

  observe(h: RateHeaders, now: number): void {
    const emptyReq = h.remainingRequests !== undefined && h.remainingRequests <= 0;
    const emptyTok = h.remainingTokens !== undefined && h.remainingTokens < TOKEN_HEADROOM;
    const until = Math.max(emptyReq ? now + (h.resetRequestsMs ?? 1000) : 0, emptyTok ? now + (h.resetTokensMs ?? 1000) : 0);
    this.emptyUntil = until;
  }

  availableIn(now: number): number {
    return Math.max(0, this.blockedUntil - now, this.emptyUntil - now);
  }
}

export interface RouterOptions {
  /** The longest the router waits for a route to free up before it stops (default 90 s). */
  readonly maxWaitMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** What a call gets from the router for one route: the route and the hooks its transport reports to. */
export interface RouteLease {
  readonly route: RouteModel;
  /**
   * True while this lease only probes the cache (every route is limited and no step of the call has been served):
   * the transport serves a cached answer, and on a miss throws RouteBusyError instead of sending a request.
   */
  cacheOnly(): boolean;
  /**
   * How long the route stays limited (0 on a route with capacity). A probe that has served a cached step is committed
   * to its route (tools may have run on that step): the transport waits this long before it sends, or stops if the
   * wait is too long, instead of handing the call back to the router.
   */
  limitedFor(): number;
  /** Waits `ms` on the router's clock. */
  pause(ms: number): Promise<void>;
  /** Feed response headers into the route's bucket. */
  observe(h: Headers): void;
  /**
   * On a 429 asking to wait `waitMs`: true means throw RouteBusyError so the router can use another route (only
   * while no request of this call has succeeded, so no tool has run); false means wait here.
   */
  shouldYield(waitMs: number): boolean;
  /** Called by the transport once a request on this lease succeeded; after that the call stays on this route. */
  started(): void;
}

export const routeKey = (r: RouteModel) => describeRoleModel(r);

export class Router {
  private readonly states = new Map<string, RouteState>();
  private readonly maxWait: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(o: RouterOptions = {}) {
    this.maxWait = o.maxWaitMs ?? 90_000;
    this.now = o.now ?? (() => Date.now());
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private state(r: RouteModel): RouteState {
    const k = routeKey(r);
    let s = this.states.get(k);
    if (!s) {
      s = new RouteState();
      this.states.set(k, s);
    }
    return s;
  }

  /** Marks a route limited (a 429, or a busy hand-off) for `ms`. */
  block(r: RouteModel, ms: number): void {
    const s = this.state(r);
    s.blockedUntil = Math.max(s.blockedUntil, this.now() + ms);
  }

  /**
   * Runs `call` on the first route with capacity. A RouteBusyError (or a 429 surfaced by the SDK) moves to the
   * next route of the same model; when all are limited it waits for the soonest, up to `maxWaitMs`, then stops
   * with RATE_LIMITED naming every route.
   */
  async run<T>(
    routes: readonly RouteModel[],
    call: (lease: RouteLease) => Promise<T>,
    options: { readonly probeCache?: boolean } = {},
  ): Promise<T> {
    // The waiting a call may do is bounded in total, not per wait: a provider that keeps answering 429 with a short
    // (or no) retry-after would otherwise keep the call looping for ever. The clock starts at the first limit hit.
    let deadline: number | undefined;
    const stop = (waits: readonly number[]) =>
      new ModelError(
        "RATE_LIMITED",
        `every route is rate-limited: ${routes.map((r, i) => `${routeKey(r)} for ${Math.ceil((waits[i] ?? 0) / 1000)} s`).join("; ")}. Stopped instead of switching models; rerun later (cached calls are free) or add a route for the same model.`,
      );
    // `attempt` counts every pass, sleeps included, so a call makes at most MAX_ATTEMPTS_PER_ROUTE × routes requests
    // once limits are hit (usually fewer). Past the deadline it stops even if a route has just freed up: the budget
    // is spent.
    for (let attempt = 0; ; attempt++) {
      const now = this.now();
      const waits = routes.map((r) => this.state(r).availableIn(now));
      const free = routes.filter((_, i) => waits[i] === 0);
      if (deadline !== undefined && (now > deadline || attempt > MAX_ATTEMPTS_PER_ROUTE * routes.length)) throw stop(waits);
      if (!free.length) {
        const soonest = Math.min(...waits);
        // A limited route still serves its cached answers: "cached calls are free" holds after a 429 too. Without
        // this, one job that hit the daily limit failed every later job in the run, finished ones included (M13h).
        // Only for a transport that honours the lease (providerFetch with a response cache). Every route is tried:
        // the cache key includes the URL and model id, so an answer cached on a fallback is found there.
        if (options.probeCache) {
          for (const r of [...routes].sort((a, b) => this.state(a).availableIn(now) - this.state(b).availableIn(now))) {
            const probe = await this.probeCache(r, call);
            if (probe.hit) return probe.value;
          }
        }
        deadline ??= now + this.maxWait;
        if (soonest > this.maxWait || now + soonest > deadline) throw stop(waits);
        await this.sleep(soonest + 50);
        continue;
      }
      const route = free[0] as RouteModel;
      const others = () => routes.some((r) => r !== route && this.state(r).availableIn(this.now()) === 0);
      let sent = false;
      const lease: RouteLease = {
        route,
        cacheOnly: () => false,
        limitedFor: () => 0,
        pause: (ms) => this.sleep(ms),
        observe: (h) => this.state(route).observe(readRateHeaders(h), this.now()),
        shouldYield: (waitMs) => !sent && others() && waitMs > 0,
        started: () => {
          sent = true;
        },
      };
      try {
        return await call(lease);
      } catch (err) {
        const busy = causeOf(err, RouteBusyError);
        if (busy) {
          this.block(route, busy.waitMs);
          deadline ??= this.now() + this.maxWait;
          continue;
        }
        const limited = rateLimitedWait(err);
        if (limited !== undefined && !sent) {
          this.block(route, limited);
          deadline ??= this.now() + this.maxWait;
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Runs `call` on a limited route with a cache-only lease. Its value on a cache hit; no hit when the first step
   * missed (nothing was sent and no tool ran). Once a step was served the lease is committed: a later miss waits on
   * this route (see RouteLease.limitedFor) and any error is the call's own, so tools never run twice.
   */
  private async probeCache<T>(
    route: RouteModel,
    call: (lease: RouteLease) => Promise<T>,
  ): Promise<{ hit: true; value: T } | { hit: false }> {
    let committed = false;
    const lease: RouteLease = {
      route,
      cacheOnly: () => !committed,
      limitedFor: () => this.state(route).availableIn(this.now()),
      pause: (ms) => this.sleep(ms),
      observe: (h) => this.state(route).observe(readRateHeaders(h), this.now()),
      shouldYield: () => false,
      started: () => {
        committed = true;
      },
    };
    try {
      return { hit: true, value: await call(lease) };
    } catch (err) {
      if (!committed && causeOf(err, RouteBusyError)) return { hit: false };
      throw err;
    }
  }
}

/** The first error of type `cls` in an error's cause chain (the SDK wraps transport errors). */
export function causeOf<E extends Error>(err: unknown, cls: new (...a: never[]) => E): E | undefined {
  let e: unknown = err;
  for (let i = 0; i < 8 && e; i++) {
    if (e instanceof cls) return e;
    e = e instanceof Error ? e.cause : undefined;
  }
  return undefined;
}

/** A 429 the transport gave up on (its own waits exhausted): how long the provider asked to wait. */
function rateLimitedWait(err: unknown): number | undefined {
  let e: unknown = err;
  for (let i = 0; i < 8 && e; i++) {
    if (e instanceof Error && "statusCode" in e && (e as { statusCode?: number }).statusCode === 429) {
      const headers = (e as { responseHeaders?: Record<string, string> }).responseHeaders ?? {};
      return durationMs(headers["retry-after"]) ?? 60_000;
    }
    e = e instanceof Error ? e.cause : undefined;
  }
  return undefined;
}
