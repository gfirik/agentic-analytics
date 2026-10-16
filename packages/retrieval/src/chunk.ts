// Structure-aware chunking (retrieval spec §1). Ingest already cuts documents at headings (and emails per
// message), so a section is the first unit; a section over the token budget is split on paragraphs, then
// sentences, with ~15% overlap. Lines of a table stay together; a table over the budget is its own chunk.
// Chunk text is always an exact slice of the section text, so citation offsets stay true.
import type { Chunk, SectionInput } from "./types.ts";

export interface ChunkOptions {
  /** Token budget per chunk (spec: 300–600). */
  readonly maxTokens?: number;
  /** Overlap between consecutive chunks of one section, as a share of the budget (spec: 15%). */
  readonly overlap?: number;
}

/**
 * Token estimate: words × 1.3, a common ratio for subword tokenizers on English and Russian prose. The exact
 * count depends on the embedding model's tokenizer, which the chunker must not depend on.
 */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

interface Unit {
  readonly start: number;
  readonly end: number;
  readonly tokens: number;
}

const TABLE_LINE = /^\s*\|.*\|\s*$|\t/;

/** Paragraph-level units; consecutive table lines form one unit that is never split. */
function blocks(text: string): Unit[] {
  const lines: { start: number; end: number; table: boolean; blank: boolean }[] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    lines.push({ start: pos, end: pos + line.length, table: TABLE_LINE.test(line), blank: line.trim() === "" });
    pos += line.length + 1;
  }
  // Text with blank lines separates paragraphs by them; text without (DOCX, PDF lines) uses one line per unit.
  const byBlank = lines.some((l) => l.blank);
  const out: Unit[] = [];
  let cur: { start: number; end: number; table: boolean } | undefined;
  const flush = () => {
    if (cur) out.push({ start: cur.start, end: cur.end, tokens: estimateTokens(text.slice(cur.start, cur.end)) });
    cur = undefined;
  };
  for (const l of lines) {
    if (l.blank) {
      flush();
      continue;
    }
    if (cur && l.table === cur.table && (cur.table || byBlank)) cur.end = l.end;
    else {
      flush();
      cur = { start: l.start, end: l.end, table: l.table };
    }
  }
  flush();
  return out;
}

/** Sentence units inside one oversize non-table block. */
function sentences(text: string, block: Unit): Unit[] {
  const out: Unit[] = [];
  const re = /[^.!?]+(?:[.!?]+|$)/g;
  const slice = text.slice(block.start, block.end);
  for (const m of slice.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const s = block.start + (m.index ?? 0) + lead;
    const e = block.start + (m.index ?? 0) + raw.trimEnd().length;
    if (e > s) out.push({ start: s, end: e, tokens: estimateTokens(text.slice(s, e)) });
  }
  return out.length ? out : [block];
}

/** Local [start, end) spans of the chunks of one section text. */
export function chunkSpans(text: string, options: ChunkOptions = {}): { start: number; end: number }[] {
  const max = options.maxTokens ?? 600;
  const overlapTokens = Math.floor(max * (options.overlap ?? 0.15));
  const trimmedStart = text.length - text.trimStart().length;
  const trimmedEnd = text.trimEnd().length;
  if (trimmedEnd <= trimmedStart) return [];
  if (estimateTokens(text) <= max) return [{ start: trimmedStart, end: trimmedEnd }];
  const units = blocks(text).flatMap((b) => (b.tokens > max && !TABLE_LINE.test(text.slice(b.start, b.end)) ? sentences(text, b) : [b]));
  const spans: { start: number; end: number }[] = [];
  let i = 0;
  while (i < units.length) {
    let j = i;
    let tokens = 0;
    // Take units while they fit; an oversize unit (a big table, a giant sentence) is a chunk on its own.
    while (j < units.length && (j === i || tokens + (units[j] as Unit).tokens <= max)) {
      tokens += (units[j] as Unit).tokens;
      j++;
    }
    spans.push({ start: (units[i] as Unit).start, end: (units[j - 1] as Unit).end });
    if (j >= units.length) break;
    // Overlap: start the next chunk with the trailing units that fit in the overlap budget, but always advance.
    let k = j;
    let back = 0;
    while (k - 1 > i && back + (units[k - 1] as Unit).tokens <= overlapTokens) {
      back += (units[k - 1] as Unit).tokens;
      k--;
    }
    i = k;
  }
  return spans;
}

export function prefixOf(s: SectionInput): string {
  const parts: string[] = [s.file];
  if (s.kind === "email" && s.email) {
    if (s.email.from) parts.push(`from ${s.email.from}`);
    if (s.email.to) parts.push(`to ${s.email.to}`);
    if (s.email.subject) parts.push(s.email.subject);
    if (s.email.date) parts.push(s.email.date.slice(0, 10));
  } else {
    if (s.heading_path.length) parts.push(s.heading_path.join(" › "));
    if (s.page !== undefined) parts.push(`p. ${s.page}`);
  }
  return `[${parts.join(" · ")}]`;
}

/** Chunks for all sections, numbered C1… in section order. */
export function chunkSections(sections: readonly SectionInput[], options: ChunkOptions = {}): Chunk[] {
  const out: Chunk[] = [];
  for (const s of sections) {
    const prefix = prefixOf(s);
    for (const span of chunkSpans(s.text, options)) {
      out.push({
        id: `C${out.length + 1}`,
        source_id: s.source_id,
        ...(s.page !== undefined ? { page: s.page } : {}),
        char_start: s.char_start + span.start,
        char_end: s.char_start + span.end,
        heading_path: s.heading_path,
        prefix,
        text: s.text.slice(span.start, span.end),
      });
    }
  }
  return out;
}
