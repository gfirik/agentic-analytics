// Downloads each public dataset, verifies the SHA-256 of the download, of the archive entry and of the derived file,
// and writes them under evals/real/data/ (gitignored). Any mismatch fails loudly: a changed upstream file would
// silently change every number in the real-data results.
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { RealDataError } from "./errors.ts";
import type { RealDataset } from "./manifest.ts";

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
  const archiveName = `${d.id}.zip`;
  let archive = deps.read(archiveName);
  if (!archive || sha256(archive) !== d.download.sha256) {
    deps.print(`${d.id}: downloading ${d.download.url}`);
    const res = await deps.fetch(d.download.url);
    if (!res.ok) throw new RealDataError("DOWNLOAD_FAILED", `${d.id}: HTTP ${res.status} from ${d.download.url}`);
    archive = new Uint8Array(await res.arrayBuffer());
    verifySha256(`${d.id} download`, archive, d.download.sha256);
    deps.write(archiveName, archive);
  }
  const entry = zipEntry(archive, d.download.entry);
  verifySha256(`${d.id} ${d.download.entry}`, entry, d.download.entrySha256);
  const derived = d.derived.derive(entry);
  verifySha256(`${d.id} ${d.derived.file}`, derived, d.derived.sha256);
  deps.write(d.derived.file, derived);
  deps.print(`${d.id}: wrote ${d.derived.file} (${derived.length} bytes, verified)`);
  return { id: d.id, file: d.derived.file, sha256: d.derived.sha256, cached: false };
}
