// The safe fetcher (security spec §4). Only URLs the search provider returned are fetched (the caller enforces
// that); this module enforces the rest:
// - http(s) only, no credentials in the URL, standard ports only;
// - no query string carrying a private value;
// - every address DNS returns is checked against the blocklist inside the socket's own lookup, so the address
//   checked is the address connected to (no DNS-rebinding gap);
// - redirects are followed by hand (at most 3), each one re-checked;
// - no cookies, a 10 s timeout, a 3 MB cap, and only text content types.
// This is a Node adapter (node:http/https), the one place the web lane touches the network.
import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isBlockedAddress, parseIPv4, parseIPv6 } from "./ip.ts";
import { normalizeText, phrases, wordRe } from "./sanitize.ts";
import { WebError } from "./types.ts";

export interface FetchedPage {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly fetched_at: string;
}

export type Lookup = (host: string) => Promise<readonly string[]>;

export interface SafeFetchOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  /** Private strings (file names, ids, emails) that must not appear in a URL's query string (security §4). */
  readonly privateValues?: readonly string[];
  /** Private names (people, companies): matched with the sanitizer's spellings, whole words (security §4). */
  readonly privateNames?: readonly string[];
  /** DNS resolution (default: the system resolver, all addresses). Injected in tests. */
  readonly lookup?: Lookup;
  /** The address policy (default: `isBlockedAddress`). Tests may allow a loopback test server. */
  readonly blocked?: (ip: string) => boolean;
  /** Ports that may be fetched (default 80 and 443; tests add their server's port). */
  readonly ports?: readonly number[];
  readonly now?: () => Date;
}

const TEXT_TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml)\b/i;

const systemLookup: Lookup = (host) =>
  new Promise((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (err, addrs: LookupAddress[]) =>
      err ? reject(err) : resolve(addrs.map((a) => a.address)),
    ),
  );

/** Checks a URL before any connection: scheme, credentials, port, literal private hosts, private query values. */
export function checkUrl(
  raw: string,
  privateValues: readonly string[] = [],
  blocked: (ip: string) => boolean = isBlockedAddress,
  ports: readonly number[] = [80, 443],
  privateNames: readonly string[] = [],
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebError("BAD_URL", `not a URL: ${raw.slice(0, 100)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new WebError("BAD_URL", `only http and https are fetched, not ${url.protocol}`);
  if (url.username || url.password) throw new WebError("BAD_URL", "URLs with credentials are not fetched");
  if (url.port && !ports.includes(Number(url.port))) throw new WebError("BAD_URL", `non-standard port ${url.port} is not fetched`);
  // "localhost." and "localhost" are the same name: drop the trailing dot before matching.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  // The URL parser already turns "2130706433" and "0x7f.1" into dotted IPv4, so literal checks see the real address.
  if ((parseIPv4(host) !== undefined || parseIPv6(host)) && blocked(host))
    throw new WebError("BLOCKED_ADDRESS", `${host} is a private or reserved address`);
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host))
    throw new WebError("BLOCKED_ADDRESS", `${host} is a local name`);
  const query = decodeLenient(url.search.replace(/\+/g, " ")).toLowerCase();
  // Matched the way the query sanitizer matches (security §4). Names: every spelling `phrases` gives (full, without
  // legal forms, joined, leading two words), whole words on the normalised query, and a joined spelling in the query
  // with its spaces removed ("HotelGroupLLC"). Values (file names, ids): anywhere, as written or normalised, as the
  // sanitizer removes them ("4821" in "A4821").
  const nq = ` ${normalizeText(query)} `;
  const squeezed = nq.replace(/ /g, "");
  const leak =
    privateValues.find((v) => {
      const nv = normalizeText(v);
      return v.trim().length >= 3 && (query.includes(v.trim().toLowerCase()) || (nv.length >= 3 && nq.includes(nv)));
    }) ??
    privateNames.find((n) =>
      phrases({ names: [n] }).some(
        (p) => p.length >= 3 && (wordRe(p).test(nq) || (!p.includes(" ") && p.length >= 6 && squeezed.includes(p))),
      ),
    );
  if (leak !== undefined) throw new WebError("PRIVATE_VALUE", "the URL's query string contains private data; not fetched");
  return url;
}

/**
 * `decodeURIComponent` that never throws: a malformed escape ("%zz") in a search result or redirect must not fail
 * the stage. Each run of escapes is decoded as UTF-8 with only an invalid byte becoming U+FFFD, so one bad byte in
 * front of an encoded private value can't keep the value from being decoded and matched.
 */
const utf8 = new TextDecoder("utf-8", { fatal: false });
function decodeLenient(s: string): string {
  return s.replace(/(?:%[0-9a-f]{2})+/gi, (run) => utf8.decode(Uint8Array.from(run.slice(1).split("%"), (h) => Number.parseInt(h, 16))));
}

/**
 * The page's text in its own charset: the Content-Type header's, else a `<meta charset>` in the first 2 KB, else UTF-8
 * (also for a label TextDecoder doesn't know). Russian and Uzbek sites still serve windows-1251, which read as UTF-8
 * would be mojibake that no quote or screen could match.
 */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const label =
    /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function request(
  url: URL,
  options: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxBytes" | "lookup" | "blocked">>,
): Promise<{
  status: number;
  location?: string;
  contentType: string;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const fail = (e: Error) =>
      reject(
        timedOut
          ? new WebError("TIMEOUT", `no complete answer within ${options.timeoutMs} ms`)
          : e instanceof WebError
            ? e
            : new WebError("FETCH_FAILED", e.message),
      );
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        headers: { "user-agent": "agentic-analytics/0 (+web lane; no cookies)", accept: "text/html,text/plain;q=0.9" },
        agent: false,
        // Every address is checked here, at connect time: what we check is what we connect to.
        lookup: ((host: string, opts: { all?: boolean }, cb: (err: Error | null, address: unknown, family?: number) => void) => {
          options
            .lookup(host)
            .then((addrs) => {
              const bad = addrs.find((a) => options.blocked(a));
              if (!addrs.length) return cb(new WebError("BAD_URL", `${host} did not resolve`), opts.all ? [] : "", 4);
              if (bad) return cb(new WebError("BLOCKED_ADDRESS", `${host} resolves to blocked address ${bad}`), opts.all ? [] : "", 4);
              const list = addrs.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }));
              // Node asks for every address (`all: true`, happy eyeballs) or for one; answer in the shape asked.
              if (opts.all) return cb(null, list);
              const first = list[0] as { address: string; family: number };
              return cb(null, first.address, first.family);
            })
            .catch((err: unknown) => cb(err instanceof Error ? err : new Error(String(err)), opts.all ? [] : "", 4));
        }) as unknown as typeof dnsLookup,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          // Only a 3xx with a Location is a redirect. Without one (or a 304, which never redirects) the target would
          // resolve to this same URL and be re-requested until the redirect cap: it is an HTTP_STATUS failure instead.
          const location = res.headers.location;
          resolve({ status, ...(location && status !== 304 ? { location } : {}), contentType, body: "" });
          return;
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > options.maxBytes) {
          res.destroy();
          reject(new WebError("TOO_LARGE", `page is ${declared} bytes; the limit is ${options.maxBytes}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > options.maxBytes) {
            res.destroy();
            reject(new WebError("TOO_LARGE", `page exceeds ${options.maxBytes} bytes`));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, contentType, body: decodeBody(Buffer.concat(chunks), contentType) }));
        res.on("error", fail);
      },
    );
    // A total deadline, not an idle timeout: a server dripping one byte at a time can't hold the job.
    const deadline = setTimeout(() => {
      timedOut = true;
      req.destroy(new WebError("TIMEOUT", `no complete answer within ${options.timeoutMs} ms`));
    }, options.timeoutMs);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", fail);
    req.end();
  });
}

export async function safeFetch(raw: string, options: SafeFetchOptions = {}): Promise<FetchedPage> {
  const opts = {
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: options.maxBytes ?? 3 * 1024 * 1024,
    lookup: options.lookup ?? systemLookup,
    blocked: options.blocked ?? isBlockedAddress,
  };
  const maxRedirects = options.maxRedirects ?? 3;
  let url = checkUrl(raw, options.privateValues, opts.blocked, options.ports, options.privateNames);
  const start = Date.now();
  for (let hop = 0; ; hop++) {
    // One budget for the whole fetch, redirects included.
    const left = opts.timeoutMs - (Date.now() - start);
    if (left <= 0) throw new WebError("TIMEOUT", `no complete answer within ${opts.timeoutMs} ms`);
    const res = await request(url, { ...opts, timeoutMs: left });
    if (res.location !== undefined) {
      if (hop >= maxRedirects) throw new WebError("TOO_MANY_REDIRECTS", `more than ${maxRedirects} redirects`);
      // Each redirect target goes through every check again.
      url = checkUrl(new URL(res.location, url).toString(), options.privateValues, opts.blocked, options.ports, options.privateNames);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new WebError("HTTP_STATUS", `HTTP ${res.status}`);
    if (!TEXT_TYPES.test(res.contentType)) throw new WebError("NOT_TEXT", `content type ${res.contentType || "(none)"} is not fetched`);
    return {
      url: url.toString(),
      status: res.status,
      contentType: res.contentType,
      body: res.body,
      fetched_at: (options.now ?? (() => new Date()))().toISOString(),
    };
  }
}
