// Per-page note numbering for <Sidenote /> and <MarginNote /> (Astro.locals is one object per rendered page).
const KEY = "aaNoteCount";

export function nextNote(locals: Record<string, unknown>): number {
  const n = (typeof locals[KEY] === "number" ? (locals[KEY] as number) : 0) + 1;
  locals[KEY] = n;
  return n;
}
