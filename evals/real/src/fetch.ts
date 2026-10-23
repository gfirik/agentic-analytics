// Downloads each public dataset, verifies the SHA-256 of the download, of the archive entry and of the derived file,
// and writes them under evals/real/data/ (gitignored). Any mismatch fails loudly: a changed upstream file would
// silently change every number in the real-data results.
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { RealDataError } from "./errors.ts";
import type { PendingDataset, RealDataset } from "./manifest.ts";

export { RealDataError };

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Throws CHECKSUM_MISMATCH unless `bytes` hash to `expected`. */
export function verifySha256(what: string, bytes: Uint8Array, expected: string): void {
  const got = sha256(bytes);
  if (got !== expected)
    throw new RealDataError("CHECKSUM_MISMATCH", `${what}: SHA-256 ${got} does not match the expected ${expected}; refusing to use it`);
}

/** One file out of a ZIP archive (SheetJS's container reader; no extra dependency). */
export function zipEntry(zip: Uint8Array, name: string): Uint8Array {
  const container = XLSX.CFB.read(zip, { type: "array" });
  const entry = XLSX.CFB.find(container, name);
  if (!entry?.content) throw new RealDataError("ENTRY_MISSING", `${name} is not in the downloaded archive`);
  return entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content as ArrayLike<number>);
}

/**
 * A page as plain text: JSON-escaped slashes and quotes and the common entities decoded first (a page may carry its
 * text as entity-encoded HTML inside JSON, as Stats NZ's does), then tags dropped and whitespace collapsed.
 */
export function plainText(html: string): string {
  return html
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:)])/g, "$1")
    .trim();
}

/**
 * Re-reads the licence before a download: the page must still state it, word for word as we recorded it. Throws
 * LICENCE_CHANGED when it doesn't (or DOWNLOAD_FAILED when the page can't be read), and nothing is downloaded.
 */
export async function checkLicence(id: string, check: { url: string; text: string }, deps: Pick<FetchDeps, "fetch" | "print">) {
  const res = await deps.fetch(check.url);
  if (!res.ok) throw new RealDataError("DOWNLOAD_FAILED", `${id}: HTTP ${res.status} from the licence page ${check.url}`);
  const page = plainText(new TextDecoder().decode(await res.arrayBuffer()));
  if (!page.includes(plainText(check.text)))
    throw new RealDataError(
      "LICENCE_CHANGED",
      `${id}: ${check.url} no longer states "${check.text}"; read the licence again before using the data`,
    );
  deps.print(`${id}: licence re-checked at ${check.url}`);
}

export interface FetchDeps {
  readonly fetch: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Reads a cached file, or undefined when it isn't there. */
  readonly read: (name: string) => Uint8Array | undefined;
  readonly write: (name: string, bytes: Uint8Array) => void;
  readonly print: (line: string) => void;
}

export interface Fetched {
  readonly id: string;
  readonly file: string;
  readonly sha256: string;
  readonly cached: boolean;
}

/**
 * Makes `derived.file` present and verified. A cached download or derived file is reused only when its checksum
 * matches; otherwise the archive is downloaded again. The derived file's checksum is checked every time.
 */
export async function fetchDataset(d: RealDataset, deps: FetchDeps): Promise<Fetched> {
  const cachedDerived = deps.read(d.derived.file);
  if (cachedDerived && sha256(cachedDerived) === d.derived.sha256) {
    deps.print(`${d.id}: ${d.derived.file} present and verified`);
    return { id: d.id, file: d.derived.file, sha256: d.derived.sha256, cached: true };
  }
  // A repaired cache is never silent: say which file failed its checksum and what was done about it.
  const archiveName = `${d.id}.${d.download.raw ? "download.csv" : "zip"}`;
  let archive = deps.read(archiveName);
  if (archive && sha256(archive) === d.download.sha256) {
    if (cachedDerived) deps.print(`${d.id}: checksum mismatch on ${d.derived.file}: rebuilding it from the cached ${archiveName}`);
  } else {
    const bad = [cachedDerived ? d.derived.file : "", archive ? archiveName : ""].filter(Boolean);
    if (bad.length) deps.print(`${d.id}: checksum mismatch on ${bad.join(" and ")}: re-downloading`);
    if (d.licence.check) await checkLicence(d.id, d.licence.check, deps);
    deps.print(`${d.id}: downloading ${d.download.url}`);
    const res = await deps.fetch(d.download.url);
    if (!res.ok) throw new RealDataError("DOWNLOAD_FAILED", `${d.id}: HTTP ${res.status} from ${d.download.url}`);
    archive = new Uint8Array(await res.arrayBuffer());
    verifySha256(`${d.id} download`, archive, d.download.sha256);
    deps.write(archiveName, archive);
  }
  const entries = d.download.raw
    ? [archive]
    : d.download.entries.map((e) => {
        const bytes = zipEntry(archive as Uint8Array, e.name);
        verifySha256(`${d.id} ${e.name}`, bytes, e.sha256);
        return bytes;
      });
  const derived = d.derived.derive(entries);
  verifySha256(`${d.id} ${d.derived.file}`, derived, d.derived.sha256);
  deps.write(d.derived.file, derived);
  deps.print(`${d.id}: wrote ${d.derived.file} (${derived.length} bytes, verified)`);
  return { id: d.id, file: d.derived.file, sha256: d.derived.sha256, cached: false };
}

/** An error's message plus its cause's code: Node's fetch says only "fetch failed", the code says why (ETIMEDOUT…). */
export function fetchFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? `${err.message} (${code})` : err.message;
}

/**
 * A pending dataset (manifest.ts): re-checks its licence and probes its data page. Returns "reachable" (pin it now)
 * or "deferred" with the reason; it never downloads data, since there is nothing pinned to verify it against. A
 * changed licence still throws LICENCE_CHANGED: that is news, not a network problem.
 */
export async function probePending(d: PendingDataset, deps: Pick<FetchDeps, "fetch" | "print">): Promise<"reachable" | "deferred"> {
  try {
    await checkLicence(d.id, d.licence.check, deps);
    const res = await deps.fetch(d.page);
    if (!res.ok) throw new RealDataError("DOWNLOAD_FAILED", `HTTP ${res.status} from ${d.page}`);
  } catch (err) {
    if (err instanceof RealDataError && err.code === "LICENCE_CHANGED") throw err;
    deps.print(`${d.id}: DEFERRED, not reachable (${fetchFailure(err)}); see evals/real/DATASETS.md "Pending"`);
    return "deferred";
  }
  deps.print(`${d.id}: reachable and the licence still reads as recorded: pin it now (evals/real/DATASETS.md "Pending")`);
  return "reachable";
}
