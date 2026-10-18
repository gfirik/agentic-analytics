// Per-page numbering for <Sidenote /> and <MarginNote /> (Astro.locals is one object per rendered page). Sidenote
// numbers and margin-note ids count separately, so a margin note never skips a sidenote number.
export function nextNote(locals: Record<string, unknown>, kind: "sidenote" | "margin" = "sidenote"): number {
  const key = kind === "sidenote" ? "aaSidenoteCount" : "aaMarginNoteCount";
  const n = (typeof locals[key] === "number" ? (locals[key] as number) : 0) + 1;
  locals[key] = n;
  return n;
}
