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

export function readRateHeaders(h: Headers): RateHeaders {
  const num = (k: string) => {
    const v = h.get(k);
    return v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  const out: { -readonly [K in keyof RateHeaders]?: number } = {};
  const rr = num("x-ratelimit-remaining-requests");
  const rt = num("x-ratelimit-remaining-tokens");
  const sr = durationMs(h.get("x-ratelimit-reset-requests"));
  const st = durationMs(h.get("x-ratelimit-reset-tokens"));
  if (rr !== undefined) out.remainingRequests = rr;
  if (rt !== undefined) out.remainingTokens = rt;
  if (sr !== undefined) out.resetRequestsMs = sr;
  if (st !== undefined) out.resetTokensMs = st;
  return out;
}

/** Thrown by the transport when a route is limited and the router prefers to try another route. */
export class RouteBusyError extends Error {
  constructor(readonly waitMs: number) {
    super(`route rate-limited for ${Math.round(waitMs)} ms`);
    this.name = "RouteBusyError";
  }
}

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
  async run<T>(routes: readonly RouteModel[], call: (lease: RouteLease) => Promise<T>): Promise<T> {
    for (;;) {
      const now = this.now();
      const waits = routes.map((r) => this.state(r).availableIn(now));
      const free = routes.filter((_, i) => waits[i] === 0);
      if (!free.length) {
        const soonest = Math.min(...waits);
        if (soonest > this.maxWait)
          throw new ModelError(
            "RATE_LIMITED",
            `every route is rate-limited: ${routes.map((r, i) => `${routeKey(r)} for ${Math.ceil((waits[i] ?? 0) / 1000)} s`).join("; ")}. Stopped instead of switching models; rerun later (cached calls are free) or add a route for the same model.`,
          );
        await this.sleep(soonest + 50);
        continue;
      }
      const route = free[0] as RouteModel;
      const others = () => routes.some((r) => r !== route && this.state(r).availableIn(this.now()) === 0);
      let sent = false;
      const lease: RouteLease = {
        route,
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
          continue;
        }
        const limited = rateLimitedWait(err);
        if (limited !== undefined && !sent) {
          this.block(route, limited);
          continue;
        }
        throw err;
      }
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
