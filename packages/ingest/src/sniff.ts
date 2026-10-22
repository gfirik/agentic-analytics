// File-type detection from magic bytes; the extension is only a hint (ingestion spec §1).
import type { FileKind } from "./types.ts";
import { readZipEntries } from "./zip.ts";

export type Sniffed =
  | { readonly kind: FileKind; readonly mime: string }
  | { readonly kind: "archive" | "unknown"; readonly mime: string; readonly reason: string };

const MIME: Record<FileKind, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  eml: "message/rfc822",
  txt: "text/plain",
  md: "text/markdown",
};

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";

export function sniff(bytes: Uint8Array, name: string): Sniffed {
  const e = ext(name);
  const known = (kind: FileKind): Sniffed => ({ kind, mime: MIME[kind] });

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return known("pdf"); // %PDF
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    const entries = readZipEntries(bytes);
    const names = entries?.map((x) => x.name) ?? [];
    if (names.some((n) => n.startsWith("xl/"))) return known("xlsx");
    if (names.some((n) => n.startsWith("word/"))) return known("docx");
    if (!entries && (e === "xlsx" || e === "xlsm" || e === "docx"))
      return { kind: "unknown", mime: "application/zip", reason: "damaged Office file (ZIP directory unreadable)" };
    return { kind: "archive", mime: "application/zip", reason: "ZIP archives are not supported in v0.1; upload the files inside it" };
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // OLE2 container: legacy .xls (SheetJS reads it). Legacy .doc is not supported.
    return e === "doc"
      ? { kind: "unknown", mime: "application/msword", reason: "legacy .doc is not supported; save as .docx" }
      : known("xls");
  }
  if (startsWith(bytes, [0x1f, 0x8b]))
    return { kind: "archive", mime: "application/gzip", reason: "gzip archives are not supported in v0.1" };
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
    return { kind: "archive", mime: "application/x-7z-compressed", reason: "7z archives are not supported in v0.1" };
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21]))
    return { kind: "archive", mime: "application/vnd.rar", reason: "RAR archives are not supported in v0.1" };

  const text = decodeText(bytes.subarray(0, 64 * 1024));
  if (text === undefined) return { kind: "unknown", mime: "application/octet-stream", reason: "unrecognized binary file" };
  if (looksLikeEmail(text)) return known("eml");
  if (e === "md" || e === "markdown") return known("md");
  if (e === "txt") return known("txt");
  if (e === "tsv") return known("tsv");
  if (e === "csv") return known("csv");
  const d = delimiterOf(text);
  if (d === "\t") return known("tsv");
  return d ? known("csv") : known("txt");
}

/** UTF-8 text with no NUL bytes, or undefined for binary content. */
export function decodeText(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Allow a truncated multi-byte sequence at the cut-off point.
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.max(0, bytes.length - 3)));
    } catch {
      return undefined;
    }
  }
}

function looksLikeEmail(text: string): boolean {
  const head = text.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const headers = head.split(/\r?\n/).filter((l) => /^(From|To|Subject|Date|Received|Message-ID|MIME-Version|Return-Path):/i.test(l));
  return headers.length >= 3;
}

/** The delimiter of a delimited text table: consistent count ≥ 1 on the first non-empty lines. */
export function delimiterOf(text: string): "," | ";" | "\t" | "|" | undefined {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 10);
  if (lines.length < 2) return undefined;
  let best: { d: "," | ";" | "\t" | "|"; n: number } | undefined;
  for (const d of ["\t", ";", ",", "|"] as const) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0] ?? 0;
    if (first >= 1 && counts.every((c) => c === first) && (!best || first > best.n)) best = { d, n: first };
  }
  return best?.d;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === d && !quoted) n++;
  }
  return n;
}
