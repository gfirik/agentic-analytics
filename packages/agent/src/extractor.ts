// The quarantined extractor (security spec §3, dual-LLM pattern). It alone reads untrusted document text, has
// no tools and no memory, and returns extracts that validate against a strict schema. Quotes must be exact
// substrings of the excerpt (anything else is dropped), and an excerpt that looks like it carries instructions,
// by the model's flag or a deterministic screen, is quarantined: its extracts are stored but never returned.
import type { ModelClient } from "@agentic-analytics/models";
import { findQuote, type SearchHit } from "@agentic-analytics/retrieval";
import type { Citation } from "@agentic-analytics/schema";
import { sql, type Workspace } from "@agentic-analytics/store";
import { z } from "zod";
import { renderPrompt } from "./prompts.ts";

export const ExtractOutput = z.object({
  events: z
    .array(
      z.object({
        date: z.string().max(40).optional(),
        actor: z.string().max(120).optional(),
        what: z.string().min(1).max(400),
        quote: z.string().min(1).max(300),
      }),
    )
    .max(10),
  statements: z
    .array(z.object({ topic: z.string().min(1).max(120), claim: z.string().min(1).max(400), quote: z.string().min(1).max(300) }))
    .max(10),
  suspicious_instructions: z.boolean(),
});
export type ExtractOutput = z.infer<typeof ExtractOutput>;

export interface Extract {
  readonly id: string; // "E1"
  readonly kind: "event" | "statement";
  readonly file: string;
  readonly date?: string;
  readonly actor?: string;
  readonly topic?: string;
  /** The extractor's paraphrase: untrusted, shown to the planner as data only. */
  readonly text: string;
  readonly quote: string;
  /** From a web page (security §4): labelled External wherever it is used, never mixed with the user's data. */
  readonly external?: true;
  readonly citation: Citation & { readonly char_start: number; readonly char_end: number; readonly page?: number };
}

/** Patterns that address a model or exfiltrate data (security spec §3). Matching text is quarantined. */
const SUSPICIOUS = [
  /\bignore\b[^.\n]{0,40}\b(instructions?|previous|prior|above)\b/i,
  /\bdisregard\b[^.\n]{0,40}\b(instructions?|previous|prior|above)\b/i,
  /\bsystem prompt\b/i,
  /\byou are now\b/i,
  /\b(assistant|AI|model|LLM)\s*[:,]\s*(please\s+)?(report|say|write|state|output)\b/i,
  /https?:\/\/[^\s?]+\?[^\s]*=/i,
  /игнорируй|забудь (все|предыдущие) инструкции/i,
];

export function screen(text: string): boolean {
  return SUSPICIOUS.some((re) => re.test(text));
}

export interface ExtractResult {
  readonly extracts: Extract[];
  /** Source ids quarantined for suspicious instructions (their extracts are stored, flagged, and excluded). */
  readonly quarantined: string[];
  /** Quotes the model returned that are not in the excerpt. */
  readonly droppedQuotes: number;
}

async function nextExtract(ws: Workspace): Promise<number> {
  const r = await ws.one<{ n: number | null }>(sql`SELECT max(CAST(substr(id, 2) AS INTEGER)) AS n FROM extracts`);
  return (r?.n ?? 0) + 1;
}

/** Extracts for each hit; one extractor call per hit, so one excerpt can never steer the reading of another. */
export async function extractFromHits(
  ws: Workspace,
  model: ModelClient,
  hits: readonly SearchHit[],
  task: string,
  options: { readonly external?: boolean } = {},
): Promise<ExtractResult> {
  const kept: { e: Extract; source: string }[] = [];
  // Quarantine is per source (security §3): one injected chunk excludes every extract of its document, in this
  // call and in earlier or later ones.
  const quarantined = new Set(await quarantinedSources(ws));
  let droppedQuotes = 0;
  let n = await nextExtract(ws);
  for (const hit of hits) {
    const { object } = await model.generateObject({
      role: "extractor",
      schema: ExtractOutput,
      system: renderPrompt("extract", { task }),
      // The data can't close its own block: a literal "</document>" in the text is neutralised.
      prompt: `<document source="${hit.file.replace(/["<>]/g, "_")}">\n${hit.text.replace(/<\/?document/gi, "‹document")}\n</document>`,
    });
    const suspicious = object.suspicious_instructions || screen(hit.text);
    const items = [
      ...object.events.map((e) => ({ kind: "event" as const, text: e.what, quote: e.quote, date: e.date, actor: e.actor })),
      ...object.statements.map((s) => ({ kind: "statement" as const, text: s.claim, quote: s.quote, topic: s.topic })),
    ];
    for (const item of items) {
      const q = findQuote(hit, item.quote);
      if (!q) {
        droppedQuotes++;
        continue;
      }
      const e: Extract = {
        id: `E${n++}`,
        kind: item.kind,
        file: hit.file,
        ...("date" in item && item.date ? { date: item.date } : {}),
        ...("actor" in item && item.actor ? { actor: item.actor } : {}),
        ...("topic" in item && item.topic ? { topic: item.topic } : {}),
        text: item.text,
        quote: q.quote,
        ...(options.external ? { external: true as const } : {}),
        citation: {
          source_id: q.source_id,
          quote: q.quote,
          char_start: q.char_start,
          char_end: q.char_end,
          ...(q.page !== undefined ? { page: q.page } : {}),
        },
      };
      await ws.run(
        sql`INSERT INTO extracts VALUES (${e.id}, ${hit.source_id}, ${hit.chunk_id}, ${JSON.stringify(e)}::JSON, ${suspicious})`,
      );
      kept.push({ e, source: hit.source_id });
    }
    if (suspicious) {
      quarantined.add(hit.source_id);
      // Mark the source's other extracts too, so later readers (DECIDE, the report) exclude them by row.
      await ws.run(sql`UPDATE extracts SET suspicious = true WHERE source_id = ${hit.source_id}`);
    }
  }
  const extracts = kept.filter((k) => !quarantined.has(k.source)).map((k) => k.e);
  const touched = new Set(hits.map((h) => h.source_id));
  return { extracts, quarantined: [...quarantined].filter((s) => touched.has(s)), droppedQuotes };
}

/** Sources with at least one suspicious extract. */
export async function quarantinedSources(ws: Workspace): Promise<string[]> {
  return (await ws.all<{ source_id: string }>(sql`SELECT DISTINCT source_id FROM extracts WHERE suspicious ORDER BY source_id`)).map(
    (r) => r.source_id,
  );
}

/** Stored, non-suspicious extracts by id (for citing them in claims). */
export async function readExtracts(ws: Workspace): Promise<Map<string, Extract>> {
  const rows = await ws.all<{ payload: string }>(
    sql`SELECT payload::VARCHAR AS payload FROM extracts
        WHERE source_id NOT IN (SELECT source_id FROM extracts WHERE suspicious)`,
  );
  return new Map(rows.map((r) => JSON.parse(r.payload) as Extract).map((e) => [e.id, e]));
}
