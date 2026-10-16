// Intake → per-type parsing → tables, document sections and issues (docs/specs/ingestion-and-profiling.md §1–4).
// Nothing here is fatal: every failure becomes an issue and the job continues.
import { delimitedToGrid } from "./csv.ts";
import type { DoclingClient } from "./docs/docling.ts";
import { docxBlocks } from "./docs/docx.ts";
import { parseEmail } from "./docs/eml.ts";
import { hasTextLayer, pdfPages } from "./docs/pdf.ts";
import { type RawSection, sectionsFromBlocks, sectionsFromText } from "./docs/sections.ts";
import { IngestError, withTimeout } from "./errors.ts";
import { readWorkbookGrids } from "./grid.ts";
import { sha256Hex } from "./hash.ts";
import { type DetectedTable, detectTables } from "./regions.ts";
import { decodeText, sniff } from "./sniff.ts";
import type { DocumentMeta, DocumentSection, FileKind, FileRecord, IngestIssue, IngestResult, InputFile } from "./types.ts";
import { readZipEntries } from "./zip.ts";

export interface IngestLimits {
  readonly maxFiles: number;
  readonly maxJobBytes: number;
  readonly maxFileBytes: number;
  readonly maxZipUncompressedBytes: number;
  readonly timeoutMs: number;
}

/** Defaults from specs/ingestion-and-profiling.md §1 and specs/security.md §5. */
export const DEFAULT_LIMITS: IngestLimits = {
  maxFiles: 50,
  maxJobBytes: 200 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxZipUncompressedBytes: 300 * 1024 * 1024,
  timeoutMs: 60_000,
};

export interface IngestOptions {
  readonly limits?: Partial<IngestLimits>;
  /** docling-serve client for PDFs without a text layer (optional). */
  readonly docling?: DoclingClient;
}

interface Pending extends InputFile {
  readonly parent?: string;
}

export async function ingest(inputs: readonly InputFile[], options: IngestOptions = {}): Promise<IngestResult> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const result: IngestResult = { files: [], tables: [], documents: [], documents_meta: [], issues: [] };
  const byHash = new Map<string, string>();
  const queue: Pending[] = [...inputs];
  let jobBytes = 0;
  let accepted = 0;

  for (let item = queue.shift(); item; item = queue.shift()) {
    const id = `F${result.files.length + 1}`;
    const base = { id, name: item.name, size: item.bytes.length, ...(item.parent ? { parent: item.parent } : {}) };
    const issue = (i: Omit<IngestIssue, "file" | "file_id">) => result.issues.push({ file: item?.name ?? "", file_id: id, ...i });
    const sha256 = await sha256Hex(item.bytes);

    if (!item.parent && accepted >= limits.maxFiles) {
      result.files.push({ ...base, sha256, kind: "unknown", mime: "", status: "rejected" });
      issue({ kind: "too_many_files", severity: "medium", message: `more than ${limits.maxFiles} files in one job; this one was skipped` });
      continue;
    }
    if (item.bytes.length > limits.maxFileBytes || jobBytes + item.bytes.length > limits.maxJobBytes) {
      result.files.push({ ...base, sha256, kind: "unknown", mime: "", status: "rejected" });
      issue({
        kind: "too_large",
        severity: "medium",
        message: `file of ${item.bytes.length} bytes exceeds the per-file or per-job size limit`,
      });
      continue;
    }
    const dup = byHash.get(sha256);
    if (dup) {
      result.files.push({ ...base, sha256, kind: "unknown", mime: "", status: "duplicate", duplicate_of: dup });
      issue({ kind: "duplicate_file", severity: "low", message: `identical to ${dup}; ingested once` });
      continue;
    }
    byHash.set(sha256, id);
    if (!item.parent) accepted++;
    jobBytes += item.bytes.length;

    const sniffed = sniff(item.bytes, item.name);
    if (sniffed.kind === "archive" || sniffed.kind === "unknown") {
      result.files.push({ ...base, sha256, kind: "unknown", mime: sniffed.mime, status: "rejected" });
      issue({
        kind:
          sniffed.kind === "archive" ? "archive_rejected" : sniffed.reason.startsWith("damaged") ? "unreadable_file" : "unsupported_type",
        severity: "medium",
        message: sniffed.reason,
      });
      continue;
    }
    const kind = sniffed.kind;
    if (kind === "xlsx" || kind === "docx") {
      const uncompressed = (readZipEntries(item.bytes) ?? []).reduce((s, e) => s + e.uncompressedSize, 0);
      if (uncompressed > limits.maxZipUncompressedBytes) {
        result.files.push({ ...base, sha256, kind, mime: sniffed.mime, status: "rejected" });
        issue({
          kind: "too_large",
          severity: "high",
          message: `decompresses to ${uncompressed} bytes (limit ${limits.maxZipUncompressedBytes}); possible ZIP bomb`,
        });
        continue;
      }
    }

    const record: FileRecord = { ...base, sha256, kind, mime: sniffed.mime, status: "ingested" };
    try {
      await withTimeout(parseFile(kind, item, id, result, options, queue), limits.timeoutMs, `parsing ${item.name}`);
      result.files.push(record);
    } catch (err) {
      result.files.push({ ...record, status: "failed" });
      const code = err instanceof IngestError ? err.code : "UNREADABLE";
      issue({
        kind: code === "PASSWORD" ? "password_protected" : "unreadable_file",
        severity: "high",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

async function parseFile(
  kind: FileKind,
  file: Pending,
  fileId: string,
  out: IngestResult,
  options: IngestOptions,
  queue: Pending[],
): Promise<void> {
  const addTables = (tables: DetectedTable[]) => {
    for (const t of tables) out.tables.push({ id: `T${out.tables.length + 1}`, file_id: fileId, ...t });
  };
  const addSections = (docKind: DocumentSection["kind"], sections: RawSection[], page?: number) => {
    for (const s of sections) {
      out.documents.push({
        id: `D${out.documents.length + 1}`,
        file_id: fileId,
        kind: docKind,
        ...(page !== undefined ? { page } : {}),
        ...s,
      });
    }
  };
  const issue = (i: Omit<IngestIssue, "file" | "file_id">) => out.issues.push({ file: file.name, file_id: fileId, ...i });

  switch (kind) {
    case "xlsx":
    case "xls": {
      const { grids, issues } = readWorkbookGrids(file.bytes);
      for (const i of issues) {
        issue({
          kind: i.kind,
          severity: i.kind === "hidden_sheet" ? "low" : "medium",
          message: i.message,
          sheet: i.sheet,
          ...(i.cell ? { cell: i.cell } : {}),
        });
      }
      const before = out.tables.length;
      for (const g of grids) addTables(detectTables(g));
      if (out.tables.length === before)
        issue({ kind: "no_tables_found", severity: "low", message: "no table-shaped region found in any sheet" });
      return;
    }
    case "csv":
    case "tsv": {
      const text = decodeText(file.bytes);
      if (text === undefined) throw new IngestError("UNREADABLE", "the file is not valid UTF-8 text");
      addTables(detectTables(delimitedToGrid(text, kind === "tsv" ? "\t" : undefined), { headerFirstRow: true }));
      return;
    }
    case "pdf": {
      let pages = await pdfPages(file.bytes);
      let via: DocumentMeta["via"] = "unpdf";
      if (!hasTextLayer(pages)) {
        if (!options.docling) {
          issue({
            kind: "needs_ocr",
            severity: "medium",
            message: "the PDF has no text layer; start the docling profile (docker compose --profile docling up -d)",
          });
          out.documents_meta.push({ file_id: fileId, kind: "pdf", pages: pages.length, texts: pages, via });
          return;
        }
        pages = await options.docling.convertPdf(file.bytes, file.name);
        via = "docling";
      }
      out.documents_meta.push({ file_id: fileId, kind: "pdf", pages: pages.length, texts: pages, via });
      pages.forEach((text, i) => {
        if (text.trim()) addSections("pdf", [{ heading_path: [], char_start: 0, char_end: text.length, text }], i + 1);
      });
      return;
    }
    case "docx": {
      const { text, sections } = sectionsFromBlocks(await docxBlocks(file.bytes));
      out.documents_meta.push({ file_id: fileId, kind: "docx", texts: [text], via: "mammoth" });
      addSections("docx", sections);
      return;
    }
    case "eml": {
      const mail = await parseEmail(file.bytes);
      const email = {
        ...(mail.from ? { from: mail.from } : {}),
        ...(mail.to ? { to: mail.to } : {}),
        ...(mail.date ? { date: mail.date } : {}),
        ...(mail.subject ? { subject: mail.subject } : {}),
      };
      out.documents_meta.push({ file_id: fileId, kind: "eml", texts: [mail.body], email, via: "mailparser" });
      if (mail.body.trim()) {
        addSections("eml", [
          { heading_path: mail.subject ? [mail.subject] : [], char_start: 0, char_end: mail.body.length, text: mail.body },
        ]);
      }
      // Attachments re-enter intake with the email as their parent (spec §4).
      for (const a of mail.attachments) queue.push({ name: a.name, bytes: a.bytes, parent: fileId });
      return;
    }
    case "txt":
    case "md": {
      const text = decodeText(file.bytes);
      if (text === undefined) throw new IngestError("UNREADABLE", "the file is not valid UTF-8 text");
      out.documents_meta.push({ file_id: fileId, kind, texts: [text], via: "text" });
      addSections(kind, sectionsFromText(text, kind === "md"));
      return;
    }
  }
}
