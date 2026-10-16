// Prompts live in packages/agent/prompts/*.md (agent-and-verifier §9): versioned, typed variables declared in the
// header comment, `[[name]]` slots (not `{{…}}`, which is the fact-placeholder syntax the model must write).
import { readFileSync } from "node:fs";

export type PromptName = "extract" | "explain" | "explain-write" | "decide" | "summary";

export class PromptError extends Error {
  constructor(
    readonly code: "MISSING_VARIABLE" | "UNKNOWN_VARIABLE" | "BAD_HEADER",
    message: string,
  ) {
    super(message);
    this.name = "PromptError";
  }
}

interface Template {
  readonly version: number;
  readonly variables: readonly string[];
  readonly body: string;
}

const HEADER = /^<!-- prompt: ([\w-]+) · version (\d+) · variables: ([\w, ]*) -->\n/;
const cache = new Map<PromptName, Template>();

/** Reads a prompt file shipped with the package (read once; a bundler can inline the folder). */
function load(name: PromptName): Template {
  const known = cache.get(name);
  if (known) return known;
  const raw = readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");
  const m = HEADER.exec(raw);
  if (!m || m[1] !== name) throw new PromptError("BAD_HEADER", `prompts/${name}.md must start with its prompt header`);
  const t: Template = {
    version: Number(m[2]),
    variables: (m[3] ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    body: raw.slice(m[0].length).trim(),
  };
  for (const slot of t.body.matchAll(/\[\[(\w+)\]\]/g))
    if (!t.variables.includes(slot[1] ?? ""))
      throw new PromptError("UNKNOWN_VARIABLE", `prompts/${name}.md uses undeclared [[${slot[1]}]]`);
  cache.set(name, t);
  return t;
}

export function promptVersion(name: PromptName): number {
  return load(name).version;
}

/** The prompt text with every declared variable filled; a missing or extra variable is an error. */
export function renderPrompt(name: PromptName, vars: Readonly<Record<string, string>>): string {
  const t = load(name);
  for (const v of t.variables) if (vars[v] === undefined) throw new PromptError("MISSING_VARIABLE", `prompt ${name} needs [[${v}]]`);
  for (const k of Object.keys(vars))
    if (!t.variables.includes(k)) throw new PromptError("UNKNOWN_VARIABLE", `prompt ${name} has no [[${k}]]`);
  // Single pass: a value that itself contains "[[x]]" (e.g. document text) is never expanded.
  return t.body.replace(/\[\[(\w+)\]\]/g, (_, v: string) => vars[v] ?? "");
}
