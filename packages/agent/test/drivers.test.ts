// Which split names the driver (claims.ts contributionDrivers, M13a): the one whose top member carries the most of
// the movement, |Δ top| / Σ|Δ|. Hand-computed.
import type { StoredDecomposition } from "@agentic-analytics/analysis";
import type { Fact } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import {
  CHANGE_EVENT_WORDS,
  contributionDrivers,
  decompositionClaims,
  RATE_EVENT_WORDS,
  smallModeQuery,
  topDrivers,
} from "../src/index.ts";

/** A contribution decomposition over `dimension` with members' Δ and share-of-change, plus the facts they cite. */
function split(id: string, dimension: string, members: Record<string, [change: number, share: number]>) {
  const facts = new Map<string, Fact>();
  const refs: Record<string, string> = {};
  for (const [m, [change, share]] of Object.entries(members)) {
    facts.set(`${id}c${m}`, { value: change } as unknown as Fact);
    facts.set(`${id}s${m}`, { value: share } as unknown as Fact);
    refs[`change:${m}`] = `${id}c${m}`;
    refs[`share:${m}`] = `${id}s${m}`;
  }
  const d: StoredDecomposition = { id, method: "contribution.v1", insight: "I1", dimension, facts: refs, details: {} };
  return { d, facts };
}

describe("contributionDrivers", () => {
  // Total change −7,900. Channel: wholesale −8,500, retail +600 → Σ|Δ| = 9,100, top 8,500 / 9,100 = 0.934.
  const channel = split("X1", "channel", { wholesale: [-8500, 107.6], retail: [600, -7.6] });

  it("picks the split whose top member carries most of the movement", () => {
    // Customer: Key Co −6,000, Bean Bar −1,400, (other) −500 → Σ|Δ| = 7,900, top 6,000 / 7,900 = 0.759 < 0.934.
    const customer = split("X2", "customer", { "Key Co": [-6000, 75.9], "Bean Bar": [-1400, 17.7], "(other)": [-500, 6.3] });
    const facts = new Map([...channel.facts, ...customer.facts]);
    const r = contributionDrivers([customer.d, channel.d], facts);
    expect(r?.decomposition.dimension).toBe("channel");
    // Members sorted by |share|: 107.6 before 7.6.
    expect(r?.drivers.map((x) => x.label)).toEqual(["wholesale", "retail"]);
  });

  it("a finer split wins when one member explains more of it", () => {
    // Customer: Key Co −7,800, (other) −100 → Σ|Δ| = 7,900, top 7,800 / 7,900 = 0.987 > 0.934.
    const customer = split("X2", "customer", { "Key Co": [-7800, 98.7], "(other)": [-100, 1.3] });
    const facts = new Map([...channel.facts, ...customer.facts]);
    const r = contributionDrivers([channel.d, customer.d], facts);
    expect(r?.decomposition.dimension).toBe("customer");
    expect(r?.drivers[0]?.label).toBe("Key Co");
  });

  it("ignores non-contribution decompositions and returns undefined without any", () => {
    const pvm = { ...channel.d, id: "X3", method: "pvm.v1" as const };
    expect(contributionDrivers([pvm], channel.facts)).toBeUndefined();
  });
});

describe("topDrivers and the small-model search (M14a)", () => {
  const channel = split("X1", "channel", { wholesale: [-8500, 107.6], retail: [600, -7.6] });
  const customer = split("X2", "customer", { "Key Co": [-6000, 75.9], "Bean Bar": [-1400, 17.7], "(other)": [-500, 6.3] });
  const facts = new Map([...channel.facts, ...customer.facts]);

  it("names the top member of every split, the best split's first", () => {
    // Channel explains more (0.934 > 0.759, as above), so wholesale comes first; Key Co still names the customer.
    expect(topDrivers([customer.d, channel.d], facts)).toEqual(["wholesale", "Key Co"]);
    expect(topDrivers([], facts)).toEqual([]);
    // The remainder bucket is never a driver to search for: the next member names the split.
    const rest = split("X3", "product", { "(other)": [-5000, 63.3], Espresso: [-2900, 36.7] });
    expect(topDrivers([rest.d], rest.facts)).toEqual(["Espresso"]);
  });

  it("adds the change type's event words: a quality rate's are a supplier's, any other change's are prices and orders", () => {
    // restaurant-v2, 2026-10-20 run: "Refund Rate <customer> 2026-06" made the extractor drop the supplier switch.
    expect(smallModeQuery({ id: "refund_rate", label: "Refund Rate", unit: "percent" }, ["Cafe One"], "2026-06")).toBe(
      `Refund Rate Cafe One 2026-06 ${RATE_EVENT_WORDS}`,
    );
    // A share is a percent but not a quality rate; revenue names both drivers so the customer's email can match.
    expect(smallModeQuery({ id: "channel_share_private", label: "Private Share", unit: "percent" }, [], "2026-04")).toBe(
      `Private Share 2026-04 ${CHANGE_EVENT_WORDS}`,
    );
    expect(smallModeQuery({ id: "revenue", label: "Total Revenue", unit: "currency" }, ["catering", "Key Co"], "2026-04")).toBe(
      `Total Revenue catering Key Co 2026-04 ${CHANGE_EVENT_WORDS}`,
    );
  });

  it("a quality rate is a whole word: returns and refunds, not returning customers; churn takes the change words", () => {
    const pct = (id: string, label: string) => smallModeQuery({ id, label, unit: "percent" }, [], "2026-05");
    expect(pct("return_rate", "Return Rate")).toBe(`Return Rate 2026-05 ${RATE_EVENT_WORDS}`);
    expect(pct("refunds_rate", "Refunds Rate")).toBe(`Refunds Rate 2026-05 ${RATE_EVENT_WORDS}`);
    expect(pct("returning_customer_rate", "Returning Customer Rate")).toBe(`Returning Customer Rate 2026-05 ${CHANGE_EVENT_WORDS}`);
    expect(pct("churn_rate", "Churn Rate")).toBe(`Churn Rate 2026-05 ${CHANGE_EVENT_WORDS}`);
  });

  it("fits search_documents' 200 characters by dropping drivers from the end", () => {
    const long = ["a".repeat(60), "b".repeat(60), "c".repeat(60)];
    const query = smallModeQuery({ id: "revenue", label: "Revenue", unit: "currency" }, long, "2026-04");
    expect(query.length).toBeLessThanOrEqual(200);
    // With all three: 7 + 3×60 + 7 + 48 + 5 spaces = 247 > 200; without the third: 7 + 120 + 7 + 48 + 4 = 186.
    expect(query).toBe(`Revenue ${"a".repeat(60)} ${"b".repeat(60)} 2026-04 ${CHANGE_EVENT_WORDS}`);
  });
});

describe("a member beyond the whole change is stated in magnitudes (M14a, analysis-library §4.1)", () => {
  /** A split with the "beyond" facts: total Δ, the top member's |Δ|, the offset's |Δ| and the comparison. */
  function beyond(total: number, top: [string, number, number], offset?: [string, number]) {
    const s = split("X9", "channel", {
      [top[0]]: [top[1], top[2]],
      ...(offset ? { [offset[0]]: [offset[1], (offset[1] / total) * 100] } : {}),
    });
    const add = (id: string, value: number) => s.facts.set(id, { value } as unknown as Fact);
    add("T", total);
    add("M1", Math.abs(top[1]));
    add("E1", 1);
    const refs: Record<string, string> = { ...s.d.facts, total: "T", [`magnitude:${top[0]}`]: "M1", [`exceeds:${top[0]}`]: "E1" };
    if (offset) {
      add("M2", Math.abs(offset[1]));
      refs[`magnitude:${offset[0]}`] = "M2";
    }
    return { d: { ...s.d, facts: refs }, facts: s.facts };
  }

  it("a drop: “wholesale” fell …, more than the whole drop; “retail” rose …", () => {
    // −8,500 and +600 → −7,900; wholesale 107.6%.
    const b = beyond(-7900, ["wholesale", -8500, 107.6], ["retail", 600]);
    expect(decompositionClaims([b.d], b.facts)[0]).toMatchObject({
      text: "By channel, “wholesale” fell {{M1}}, more than the whole drop; “retail” rose {{M2}}.",
      facts: ["M1", "M2", "E1"],
    });
  });

  it("a rise, with no offset named when none moved against it", () => {
    const b = beyond(5000, ["online", 6000, 120]);
    expect(decompositionClaims([b.d], b.facts)[0]?.text).toBe("By channel, “online” rose {{M1}}, more than the whole rise.");
  });

  it("without the comparison fact (or with it at 0), the share sentence stays", () => {
    const b = beyond(-7900, ["wholesale", -8500, 107.6], ["retail", 600]);
    b.facts.set("E1", { value: 0 } as unknown as Fact);
    expect(decompositionClaims([b.d], b.facts)[0]?.text).toMatch(
      /^By channel, “wholesale” accounted for \{\{X9swholesale\}\} of the change/,
    );
  });
});
