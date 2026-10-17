// The Kaggle notebook (evals/kaggle/full-suite-vllm.ipynb, evals/README.md) can't run in CI: it needs two GPUs. This
// checks what can be checked without them: it is a clean nbformat 4 notebook, every `bun run …` it runs exists with
// those flags (the site's command checker), its model config resolves to the local vLLM endpoint for every role, and
// its label gives the results file name the notebook looks for.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveModelConfig } from "@agentic-analytics/models";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkBunRun, ROOT, words } from "../../../scripts/test/cli-commands.ts";
import { evalSlug } from "../src/index.ts";

interface Cell {
  readonly cell_type: string;
  readonly id?: string;
  readonly source: string[];
  readonly outputs?: unknown[];
  readonly execution_count?: number | null;
}
const file = join(ROOT, "evals", "kaggle", "full-suite-vllm.ipynb");
const nb = JSON.parse(readFileSync(file, "utf8")) as { nbformat: number; nbformat_minor: number; cells: Cell[] };
const code = nb.cells.filter((c) => c.cell_type === "code").map((c) => c.source.join(""));
const all = code.join("\n");
/** A setting from the notebook's first cell, e.g. `LABEL = "…"`. */
const setting = (name: string) => new RegExp(`^${name} = "([^"]*)"`, "m").exec(all)?.[1];

describe("evals/kaggle/full-suite-vllm.ipynb", () => {
  it("is nbformat 4 with clean cells: no outputs, no execution counts, unique ids", () => {
    expect(nb.nbformat).toBe(4);
    expect(nb.cells.length).toBeGreaterThan(8);
    for (const c of nb.cells) {
      expect(["markdown", "code"]).toContain(c.cell_type);
      if (c.cell_type === "code") expect([c.outputs, c.execution_count]).toEqual([[], null]);
    }
    const ids = nb.cells.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs only `bun run` commands that exist, with flags the CLI has", () => {
    // f-string placeholders ({ds}, {CHUNKS}/…) are values; the literal words around them are what is checked.
    const commands = [...all.matchAll(/bun run ([^"`\n]*)/g)].map((m) => (m[1] ?? "").replace(/\{[^}]*\}/g, "X"));
    expect(commands.length).toBeGreaterThanOrEqual(3);
    const problems = commands.map((c) => [c, checkBunRun(words(c))]).filter(([, why]) => why);
    expect(problems).toEqual([]);
    const run = commands.find((c) => c.startsWith("eval -- --suite full --model configured --only"));
    expect(run).toBeDefined();
    expect(checkBunRun(words(`${run} --small-model`))).toBeUndefined();
    // eval:merge is a tsx script, not the CLI: its flags are checked against its own parseArgs options.
    const merge = readFileSync(join(ROOT, "evals", "runner", "scripts", "merge.ts"), "utf8");
    for (const flag of ["label", "note", "small-model"]) expect(merge).toMatch(new RegExp(`"?${flag}"?: \\{ type:`));
  });

  it("points every role at the notebook's vLLM endpoint, with structured outputs and no key", () => {
    const served = setting("SERVED_NAME");
    const yaml = /f\.write\(f"""[^\n]*\n([\s\S]*?)"""\)/.exec(all)?.[1];
    expect(served && yaml).toBeTruthy();
    const config = parse((yaml as string).replace(/\{\{/g, "{").replace(/\}\}/g, "}").replace("{PORT}", "8000")) as unknown;
    const route = `openai-compatible:vllm:${served}`;
    expect(all).toContain('ROUTE = f"openai-compatible:vllm:{SERVED_NAME}"');
    const c = resolveModelConfig({ PLANNER_MODEL: route, EXTRACTOR_MODEL: route, JUDGE_MODEL: route }, config);
    for (const role of ["planner", "extractor", "judge"] as const)
      expect(c.models[role]).toMatchObject({ provider: "openai-compatible", endpoint: "vllm", model: served });
    expect(c.providers["openai-compatible"]?.vllm).toEqual({ base_url: "http://127.0.0.1:8000/v1", structured_outputs: true });
  });

  it("labels the run so it gets its own results file and row", () => {
    const label = setting("LABEL");
    expect(label).toBe("vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ");
    expect(evalSlug("2026-10-20", { model: "configured", label: label as string, suite: "full" })).toBe(
      "2026-10-20-vllm-kaggle-2-t4-qwen3.8-27b-awq-full",
    );
    // The notebook finds the merged file with the same rule as evalSlug.
    expect(all).toContain('re.sub(r"[^a-z0-9.]+", "-", LABEL.lower()).strip("-")');
  });

  it("retries a business only for a lost connection or an HTTP 5xx, never for a model result with a number in it", () => {
    // The Python pattern is adjacent r"…" pieces; it uses no syntax that differs between Python's re and JS.
    const body = /INFRA = re\.compile\(([\s\S]*?)\n\)/.exec(all)?.[1] ?? "";
    const infra = new RegExp([...body.matchAll(/r"([^"]*)"/g)].map((m) => m[1]).join(""));
    expect(infra.source.length).toBeGreaterThan(20);
    for (const retry of [
      "PROVIDER: fetch failed",
      "PROVIDER: connect ECONNREFUSED 127.0.0.1:8000",
      "PROVIDER: HTTP 503",
      "PROVIDER: Internal Server Error",
    ])
      expect(infra.test(retry), retry).toBe(true);
    for (const keep of [
      "PROVIDER: This model's maximum context length is 32768 tokens. However, you requested 33280 tokens (32768 in the messages, 512 in the completion)",
      "TIMEOUT: the request took longer than 900000 ms",
      "RECOMPUTE_MISMATCH: fact N500 differs",
    ])
      expect(infra.test(keep), keep).toBe(false);
  });
});
