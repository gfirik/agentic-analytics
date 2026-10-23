// The ablation's measures (accuracy.md §8.4), each on a hand-computed case.
import type { AnswerKey } from "@agentic-analytics/eval-generator";
import type { GoldenItem } from "@agentic-analytics/eval-runner";
import { describe, expect, it } from "vitest";
import {
  armMetric,
  type ChangesAnswer,
  changesMeasures,
  citationValid,
  goldenMeasures,
  type QuestionAnswer,
  type Support,
  scoreArmChanges,
  scoreArmItem,
  unsupportedNumbers,
} from "../src/index.ts";

const numeric = (id: string, question: string, expected: number, abs = 0.5): GoldenItem => ({
  id,
  question,
  capability: "kpi",
  kind: "numeric",
  expected,
  tolerance: { abs, rel: 0 },
  source: { kind: "ask" },
  columns: ["amount"],
  split: "dev",
});
const categorical: GoldenItem = {
  id: "G3",
  question: "Which channel drove the April drop?",
  capability: "driver",
  kind: "categorical",
  expected: "wholesale",
  source: { kind: "ask" },
  columns: [],
  split: "dev",
};
const trap: GoldenItem = {
  id: "G5",
  question: "What will revenue be next year?",
  capability: "other",
  kind: "trap",
  reason: "no forecasts",
  source: { kind: "ask" },
  columns: [],
  split: "dev",
};
const say = (answer: string, extra: Partial<QuestionAnswer> = {}): QuestionAnswer => ({ answer, refused: false, ...extra });

describe("scoreArmItem", () => {
  const g1 = numeric("G1", "What was revenue in April 2026?", 36200);
  const g4 = numeric("G4", "By how much did revenue fall from March to April 2026?", -7900);

  it("numeric: a claimed number within tolerance passes; dates and echoes never do", () => {
    expect(scoreArmItem(g1, say("Revenue in April 2026 was $36,200.")).pass).toBe(true);
    expect(scoreArmItem(g1, say("About $36,000.")).pass).toBe(false); // |36000 − 36200| = 200 > 0.5
    expect(scoreArmItem(g1, say("It was 36,200.4.")).pass).toBe(true); // 0.4 ≤ 0.5
    // "fell by 7,900" (unsigned) stands for −7,900; an explicit +7,900 does not.
    expect(scoreArmItem(g4, say("Revenue fell by 7,900.")).pass).toBe(true);
    expect(scoreArmItem(g4, say("Revenue changed by +7,900.")).pass).toBe(false);
  });

  it("categorical reads the member field only; a refusal of an answerable item is a miss", () => {
    expect(scoreArmItem(categorical, say("Wholesale did.", { member: "Wholesale" })).pass).toBe(true);
    expect(scoreArmItem(categorical, say("Wholesale did.")).got).toBe("no member"); // free text is never judged
    expect(scoreArmItem(g1, say("can't", { refused: true })).pass).toBe(false);
    expect(scoreArmItem(g1, undefined)).toMatchObject({ pass: false, got: "no answer" });
  });

  it("a trap passes only on refused: true; an answer with a caveat is not a refusal", () => {
    expect(scoreArmItem(trap, say("No forecast is possible.", { refused: true, caveat: "no forecasts" })).pass).toBe(true);
    expect(scoreArmItem(trap, say("About 480,000.", { caveat: "a rough guess" })).pass).toBe(false);
  });

  it("goldenMeasures counts per kind", () => {
    const s = [
      { id: "G1", kind: "numeric" as const, pass: true, got: "" },
      { id: "G2", kind: "numeric" as const, pass: false, got: "" },
      { id: "G3", kind: "categorical" as const, pass: true, got: "" },
      { id: "G5", kind: "trap" as const, pass: false, got: "" },
    ];
    expect(goldenMeasures(s)).toEqual({ numeric: { n: 1, of: 2 }, categorical: { n: 1, of: 1 }, traps: { n: 0, of: 1 } });
  });
});

describe("unsupportedNumbers", () => {
  const item = numeric("G1", "What was revenue in April 2026?", 36200);
  const support: Support = { golden: [36200, 44100], facts: [-7900], cells: new Map([["G1", [125, 980]]]) };

  it("supported by a golden answer, a fact of arm C or a source cell of the item's columns (0.5% at least)", () => {
    // 36,200 golden; 44,300 within 0.5% of 44,100 (|200| ≤ 220.5); 7,900 = −(−7,900) a fact; 980 a cell;
    // 51,000 nothing. With cells: 1 of 5 unsupported; without cells 980 is unsupported too: 2 of 5.
    const a = say("April was 36,200, March 44,300, a fall of 7,900; the largest order was 980 and the total 51,000.");
    expect(unsupportedNumbers(item, a, support)).toEqual({ numbers: 5, unsupported: 1, unsupportedWithoutCells: 2 });
  });

  it("excludes the question's own numbers, dates and rank sizes, and a refusal claims nothing", () => {
    expect(unsupportedNumbers(item, say("In April 2026 the top 3 made 777."), support)).toEqual({
      numbers: 1,
      unsupported: 1,
      unsupportedWithoutCells: 1,
    });
    expect(unsupportedNumbers(item, say("51,000", { refused: true }), support)).toEqual({
      numbers: 0,
      unsupported: 0,
      unsupportedWithoutCells: 0,
    });
  });
});

describe("scoreArmChanges: the eval's subject matchers on the arms' structured findings", () => {
  const key = {
    planted: [
      {
        id: "P1",
        type: "regression",
        metric: "revenue",
        period: "2026-04",
        driver: { dimension: "customer", member: "Seaview Hotels" },
        driver_alternatives: [{ dimension: "channel", member: "wholesale" }],
        persists: true,
        good_actions: [],
        description: "",
      },
      { id: "P2", type: "regression", metric: "orders", period: "2026-02", persists: true, good_actions: [], description: "" },
    ],
    distractors: [{ id: "D1", description: "", metric: "revenue", period: "2025-12", must_not_appear_as_finding: true }],
  } as unknown as AnswerKey;
  const f = (x: Partial<ChangesAnswer["findings"][number]>): ChangesAnswer["findings"][number] => ({
    metric: "revenue",
    member: null,
    before: "2026-03",
    period: "2026-04",
    direction: "down",
    drivers: [],
    summary: "",
    ...x,
  });

  it("finds P1 with the alternative driver, P2 without one, and reports D1 (hand-computed)", () => {
    const answer: ChangesAnswer = {
      findings: [
        f({ metric: "Total Sales", drivers: ["Wholesale"] }), // revenue 2026-03→04 down: P1, driver ok (alternative)
        f({ metric: "orders", before: "2026-01", period: "2026-02" }), // P2 (no expected driver)
        f({ before: "2025-11", period: "2025-12" }), // D1 reported
      ],
      refused: false,
    };
    const s = scoreArmChanges(answer, key);
    expect(s.planted).toEqual([
      { id: "P1", detected: true, rank: 1, driver: true },
      { id: "P2", detected: true, rank: 2 },
    ]);
    expect(s.distractorsReported).toEqual(["D1"]);
    expect(changesMeasures([s])).toEqual({ recall5: { n: 2, of: 2 }, driver: { n: 1, of: 1 }, distractorFp: { n: 1, of: 1 } });
  });

  it("a wrong driver, a rise for a regression, and a refusal don't count", () => {
    const wrong = scoreArmChanges(
      {
        findings: [f({ drivers: ["retail"] }), f({ metric: "orders", period: "2026-02", before: "2026-01", direction: "up" })],
        refused: false,
      },
      key,
    );
    expect(wrong.planted).toEqual([
      { id: "P1", detected: true, rank: 1, driver: false },
      { id: "P2", detected: false },
    ]);
    // P1 found but with the wrong driver: not recalled (EVALS §2); 0 of 1 drivers right.
    expect(changesMeasures([wrong])).toMatchObject({ recall5: { n: 0, of: 2 }, driver: { n: 0, of: 1 } });
    expect(scoreArmChanges({ findings: [f({ drivers: ["wholesale"] })], refused: true }, key).planted[0]).toEqual({
      id: "P1",
      detected: false,
    });
  });

  it("armMetric maps the plain sales words to the key's names", () => {
    expect(["Revenue", "total_sales", "Monthly Revenue", "order_count", "Refund rate", "avg_basket"].map(armMetric)).toEqual([
      "revenue",
      "revenue",
      "revenue",
      "orders",
      "refund_rate",
      "avg_basket",
    ]);
  });
});

describe("citationValid (arm B)", () => {
  const item = numeric("G1", "What was revenue in April 2026?", 36200);
  const sql = "SELECT sum(amount) FROM t_t1";
  const ran = [{ sql, rows: [[36200]] }];

  it("valid when the cited statement ran, re-runs to the same rows, and holds every claimed number", () => {
    expect(citationValid(item, say("It was 36,200.", { sql: [sql] }), ran, new Map([[sql, [[36200]]]]))).toBe(true);
  });
  it("invalid on a statement it never ran, a different re-run, or a number the rows don't hold", () => {
    expect(citationValid(item, say("It was 36,200.", { sql: ["SELECT 36200"] }), ran, new Map([["SELECT 36200", [[36200]]]]))).toBe(false);
    expect(citationValid(item, say("It was 36,200.", { sql: [sql] }), ran, new Map([[sql, [[36100]]]]))).toBe(false);
    expect(citationValid(item, say("It was 36,200, up 5%.", { sql: [sql] }), ran, new Map([[sql, [[36200]]]]))).toBe(false);
  });
  it("not counted for a refusal or an answer with no number", () => {
    expect(citationValid(item, say("no", { refused: true }), ran, new Map())).toBeUndefined();
    expect(citationValid(item, say("Wholesale."), ran, new Map())).toBeUndefined();
  });
});
