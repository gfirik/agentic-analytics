// Reciprocal Rank Fusion (retrieval spec §3): score(d) = Σ over rankings of 1 / (k + rank(d)), ranks from 1.
// k = 60 (Cormack et al. 2009) keeps one list's top hit from dominating. Ties keep the first list's order.

export interface Fused {
  readonly id: string;
  readonly score: number;
  /** 1-based rank in each input list, undefined where the id is absent. */
  readonly ranks: readonly (number | undefined)[];
}

export function rrf(rankings: readonly (readonly string[])[], k = 60): Fused[] {
  const byId = new Map<string, { score: number; ranks: (number | undefined)[]; first: number }>();
  let seen = 0;
  rankings.forEach((list, li) => {
    list.forEach((id, i) => {
      let e = byId.get(id);
      if (!e) {
        e = { score: 0, ranks: rankings.map(() => undefined), first: seen++ };
        byId.set(id, e);
      }
      if (e.ranks[li] !== undefined) return; // a duplicate within one list counts once, at its best rank
      e.ranks[li] = i + 1;
      e.score += 1 / (k + i + 1);
    });
  });
  return [...byId.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[1].first - b[1].first)
    .map(([id, e]) => ({ id, score: e.score, ranks: e.ranks }));
}
