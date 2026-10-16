// DOCX via mammoth: semantic HTML → blocks (headings, paragraphs, list items, table cells) → text with
// one block per line. Sections start at each heading (spec §4).
import mammoth from "mammoth";
import { IngestError } from "../errors.ts";

export interface Block {
  readonly text: string;
  readonly level?: number; // heading level 1–6
}

export async function docxBlocks(bytes: Uint8Array): Promise<Block[]> {
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }));
  } catch (err) {
    throw new IngestError("UNREADABLE", `the DOCX could not be read: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  const blocks: Block[] = [];
  for (const m of html.matchAll(/<(h[1-6]|p|li|td|th)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const tag = m[1] ?? "p";
    const text = decodeEntities((m[2] ?? "").replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    blocks.push(tag.startsWith("h") ? { text, level: Number(tag.slice(1)) } : { text });
  }
  return blocks;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}
