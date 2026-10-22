// The scripted ablation (`--model baseline`): canned FakeModel answers for arms A and B, built from each task's
// answer key or golden item, so the whole harness (prompts, cut, sandbox, retry budget, scoring, bootstrap) runs
// offline in CI. These are harness checks, not an engine-vs-model comparison, and every result says so.
import type { GoldenItem } from "@agentic-analytics/eval-runner";
import { plantedDirection } from "@agentic-analytics/eval-runner";
import type { Step } from "@agentic-analytics/models";
import { FakeModel, type FakeScriptEntry } from "@agentic-analytics/models/testing";
import type { AblationJob } from "./jobs.ts";
import type { ChangesAnswer, QuestionAnswer } from "./prompts.ts";

const CHANGES_MATCH = "Task: find the most important real changes";

/** The month before a YYYY-MM. */
export function previousMonth(p: string): string {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Arm A's canned answers. Golden: even-numbered items answered right, odd-numbered numeric items 10% off (a wrong,
 * unsupported number), categorical items with the expected member, traps answered with an invented figure (a
 * trap miss). Smoke: every planted event reported with no driver, plus the first distractor (a false positive).
 */
export function scriptedArmA(job: AblationJob): FakeModel {
  const entries: FakeScriptEntry[] = [];
  for (const [i, item] of (job.items ?? []).entries())
    entries.push({ match: `Question: ${item.question}`, object: armAAnswer(item, i), repeat: true });
  if (job.key) {
    const key = job.key;
    const answer: ChangesAnswer = {
      findings: [
        ...key.planted.map((p) => ({
          metric: p.metric,
          member: p.member ? { dimension: p.member.dimension, member: p.member.member } : null,
          before: previousMonth(p.period),
          period: p.period,
          direction: plantedDirection(p),
          drivers: [],
          summary: `${p.metric} moved in ${p.period}.`,
        })),
        ...key.distractors.slice(0, 1).map((d) => ({
          metric: d.metric,
          member: d.member ? { dimension: d.member.dimension, member: d.member.member } : null,
          before: previousMonth(d.period),
          period: d.period,
          direction: "down" as const,
          drivers: [],
          summary: `${d.metric} dipped in ${d.period}.`,
        })),
      ],
      refused: false,
      caveat: null,
    };
    entries.push({ match: CHANGES_MATCH, object: answer, repeat: true });
  }
  return new FakeModel(entries);
}

function armAAnswer(item: GoldenItem, i: number): QuestionAnswer {
  if (item.kind === "trap") return { answer: "It will be about 512,000.", member: null, refused: false, caveat: null };
  if (item.kind === "categorical") return { answer: `${item.expected}.`, member: item.expected, refused: false, caveat: null };
  const v = i % 2 === 0 ? item.expected : Math.round(item.expected * 1.1);
  return { answer: `It was ${fmt(v)}.`, member: null, refused: false, caveat: null };
}

/**
 * Arm B's canned tool use. Golden: an item with SQL runs it through run_sql and answers with the first cell of the
 * result, citing the statement (a statement the sandbox refuses, like a raw-file read, ends in a refusal); a trap
 * first tries to read a file (refused: one retry used), then refuses; an item with no SQL refuses. Smoke: one count
 * query, then the first planted event with its driver, and nothing else.
 */
export function scriptedArmB(job: AblationJob): FakeModel {
  const entries: FakeScriptEntry[] = [];
  for (const item of job.items ?? []) entries.push({ match: `Question: ${item.question}`, steps: armBSteps(item), repeat: true });
  if (job.key) {
    const p = job.key.planted[0];
    const sql = "SELECT count(*) AS n FROM t_t1";
    entries.push({
      match: CHANGES_MATCH,
      repeat: true,
      steps: [
        { toolCalls: [{ toolName: "run_sql", input: { sql } }] },
        {
          text: JSON.stringify({
            findings: p
              ? [
                  {
                    metric: p.metric,
                    member: p.member ? { dimension: p.member.dimension, member: p.member.member } : null,
                    before: previousMonth(p.period),
                    period: p.period,
                    direction: plantedDirection(p),
                    drivers: p.driver ? [p.driver.member] : [],
                    summary: `${p.metric} moved in ${p.period}.`,
                  },
                ]
              : [],
            refused: false,
            caveat: null,
          } satisfies ChangesAnswer),
        },
      ],
    });
  }
  return new FakeModel(entries);
}

type Output = { rows?: readonly (readonly unknown[])[]; error?: { code: string; message: string } };
const outputOf = (done: readonly Step[], step: number): Output => (done[step]?.toolCalls[0]?.output ?? {}) as Output;

function armBSteps(item: GoldenItem) {
  const refuse = (caveat: string) =>
    JSON.stringify({ answer: "The data can't answer this.", member: null, refused: true, caveat } satisfies QuestionAnswer);
  if (item.kind === "trap")
    return [
      { toolCalls: [{ toolName: "run_sql", input: { sql: "SELECT * FROM read_text('/etc/hostname')" } }] },
      (done: readonly Step[]) => ({ text: refuse(`no column answers it (${outputOf(done, 0).error?.code ?? "no error"})`) }),
    ];
  const sql = item.sql;
  if (!sql) return [{ text: refuse("no query was written for it") }];
  return [
    { toolCalls: [{ toolName: "run_sql", input: { sql } }] },
    (done: readonly Step[]) => {
      const out = outputOf(done, 0);
      const first = out.rows?.[0]?.[0];
      if (out.error || first === undefined || first === null) return { text: refuse(out.error ? `${out.error.code}` : "no rows") };
      const answer: QuestionAnswer =
        item.kind === "categorical"
          ? { answer: `${String(first)}.`, member: String(first), refused: false, caveat: null, sql: [sql] }
          : { answer: `It was ${fmt(Number(first))}.`, member: null, refused: false, caveat: null, sql: [sql] };
      return { text: JSON.stringify(answer) };
    },
  ];
}
