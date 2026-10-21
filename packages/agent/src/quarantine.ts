// Screening every untrusted source before any model reads it (security spec §3): documents, emails and the text
// cells of tables. A hit quarantines the whole source; its text is then never sent to the extractor, and the
// report lists it under data quality. Numbers from a flagged table still come from SQL as usual: the screen
// guards what models read, not what code computes.

import { screen } from "@agentic-analytics/schema";
import { ident, sql, tableName, type Workspace } from "@agentic-analytics/store";
import { quarantine } from "./extractor.ts";

export interface ScreenSummary {
  readonly screened: number;
  readonly quarantined: string[];
}

/** Documents and emails (INDEX_DOCS). */
export async function screenDocuments(ws: Workspace): Promise<ScreenSummary> {
  const flagged: string[] = [];
  let screened = 0;
  for (const r of await ws.all<{ id: string; text: string }>(
    sql`SELECT id, text FROM sources WHERE kind IN ('document', 'email') AND text IS NOT NULL ORDER BY id`,
  )) {
    screened++;
    if (screen(r.text)) {
      flagged.push(r.id);
      await quarantine(ws, r.id, "text addressed to a model", "screen");
    }
  }
  return { screened, quarantined: flagged };
}

/** Column labels and distinct text cells of every table (right after PROFILE, before any model sees samples). */
export async function screenTables(ws: Workspace): Promise<ScreenSummary> {
  const flagged: string[] = [];
  let screened = 0;
  const cols = await ws.all<{ table_id: string; name: string; label: string; type: string }>(
    sql`SELECT table_id, name, label, type FROM table_columns ORDER BY table_id, position`,
  );
  for (const c of cols) {
    if (flagged.includes(c.table_id)) continue;
    screened++;
    if (screen(c.label)) {
      flagged.push(c.table_id);
      await quarantine(ws, c.table_id, `the label of column ${c.name} addresses a model`, "screen");
      continue;
    }
    if (!["text", "category", "id"].includes(c.type)) continue;
    const values = await ws.all<{ v: string }>(
      sql`SELECT DISTINCT CAST(${ident(c.name)} AS VARCHAR) AS v FROM ${ident(tableName(c.table_id))} WHERE ${ident(c.name)} IS NOT NULL`,
    );
    screened += values.length;
    if (values.some((x) => screen(x.v))) {
      flagged.push(c.table_id);
      await quarantine(ws, c.table_id, `a cell in column ${c.name} addresses a model`, "screen");
    }
  }
  return { screened, quarantined: flagged };
}

export async function screenWorkspace(ws: Workspace): Promise<ScreenSummary> {
  const t = await screenTables(ws);
  const d = await screenDocuments(ws);
  return { screened: t.screened + d.screened, quarantined: [...t.quarantined, ...d.quarantined] };
}
