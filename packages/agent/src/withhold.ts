// Text from the user's tables that reaches a planner prompt (security.md §3, AGENTS.md rule 5). Table cells are
// screened after PROFILE and a flagged table is quarantined, but its numbers still go through analysis, so a cell's
// text can travel on inside fact labels (`revenue[customer=<cell>]_2026-04`), member values, decomposition keys
// (`change:<cell>`) and the code-written claims that quote a member. Every such string passes through here on its way
// to the planner: the screen's verdict decides, and flagged text is replaced, never shown. Numbers and ids stay, so
// the planner can still cite the fact; the report the reader sees keeps the real names.
import { screen } from "./screen.ts";

/** What the planner sees in place of text the screen flagged. */
export const WITHHELD = "(text withheld: it addresses a model)";

/** The text, or WITHHELD when the injection screen flags it. */
export function withheld(text: string): string {
  return screen(text) ? WITHHELD : text;
}

/** A member value (null stays null). */
export function withheldMember<T extends { readonly dimension: string; readonly value: string | null }>(m: T): T {
  return m.value === null ? m : { ...m, value: withheld(m.value) };
}

/**
 * Keys like `change:<member>` and `share:<member>`: a flagged member becomes `<kind>:withheld-<n>`, numbered by member
 * so a member's change and share still pair up and the keys stay distinct.
 */
export function withheldKeys<V>(rec: Readonly<Record<string, V>>): Record<string, V> {
  const index = new Map<string, number>();
  return Object.fromEntries(
    Object.entries(rec).map(([key, v]) => {
      const at = key.indexOf(":");
      const member = at < 0 ? key : key.slice(at + 1);
      if (!screen(member)) return [key, v];
      if (!index.has(member)) index.set(member, index.size + 1);
      return [`${at < 0 ? "" : `${key.slice(0, at)}:`}withheld-${index.get(member)}`, v];
    }),
  );
}
