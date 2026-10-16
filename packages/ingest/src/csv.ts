// CSV/TSV → grid (RFC 4180 quoting). Plain decimal numbers become numbers; anything locale-formatted
// ("1 234,56", "(12)") stays text for M3 normalization (spec §6), so nothing is guessed here.
import type { Grid } from "./regions.ts";
import { delimiterOf } from "./sniff.ts";
import type { Cell } from "./types.ts";

export function parseDelimited(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? delimiterOf(text) ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function delimitedToGrid(text: string, delimiter?: string): Grid {
  const cells = parseDelimited(text, delimiter).map((r) => r.map(toCell));
  return { hidden: false, r0: 0, c0: 0, cells, merges: [] };
}

function toCell(raw: string): Cell | undefined {
  const s = raw.trim();
  if (s === "") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s) && !/^-?0\d/.test(s)) return { v: Number(s), t: "n" };
  return { v: s, t: "s" };
}
