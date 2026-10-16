// Splitting extracted text into sections with heading paths and character offsets (spec §4).
import type { Block } from "./docx.ts";

export interface RawSection {
  readonly heading_path: string[];
  readonly char_start: number;
  readonly char_end: number;
  readonly text: string;
}

/** Blocks joined with "\n"; a new section starts at every heading, nested by heading level. */
export function sectionsFromBlocks(blocks: readonly Block[]): { text: string; sections: RawSection[] } {
  const text = blocks.map((b) => b.text).join("\n");
  const sections: RawSection[] = [];
  const path: { level: number; text: string }[] = [];
  let pos = 0;
  let current: { start: number; path: string[] } | undefined;
  const close = (end: number) => {
    if (current && end > current.start) {
      sections.push({ heading_path: current.path, char_start: current.start, char_end: end, text: text.slice(current.start, end) });
    }
  };
  for (const b of blocks) {
    if (b.level !== undefined) {
      close(pos > 0 ? pos - 1 : 0);
      while (path.length && (path[path.length - 1]?.level ?? 0) >= b.level) path.pop();
      path.push({ level: b.level, text: b.text });
      current = { start: pos, path: path.map((p) => p.text) };
    } else if (!current) current = { start: pos, path: [] };
    pos += b.text.length + 1;
  }
  close(text.length);
  return { text, sections };
}

/** Markdown: `#` headings; plain text: paragraphs separated by blank lines. Offsets are into `text`. */
export function sectionsFromText(text: string, markdown: boolean): RawSection[] {
  if (markdown) {
    const lines = text.split("\n");
    const blocks: Block[] = lines.map((l) => {
      const m = /^(#{1,6})\s+(.*)$/.exec(l);
      return m ? { text: l, level: m[1]?.length ?? 1 } : { text: l };
    });
    const { sections } = sectionsFromBlocks(blocks);
    return sections.map((s) => ({ ...s, heading_path: s.heading_path.map((h) => h.replace(/^#+\s+/, "")) })).filter((s) => s.text.trim());
  }
  const out: RawSection[] = [];
  for (const m of text.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g)) {
    const t = m[0];
    if (!t.trim()) continue;
    const start = m.index ?? 0;
    out.push({ heading_path: [], char_start: start, char_end: start + t.length, text: t });
  }
  return out;
}
