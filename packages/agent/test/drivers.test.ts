// Which split names the driver (claims.ts contributionDrivers, M13a): the one whose top member carries the most of
// the movement, |Δ top| / Σ|Δ|. Hand-computed.
import type { StoredDecomposition } from "@agentic-analytics/analysis";
import type { Fact } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { contributionDrivers } from "../src/index.ts";

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
