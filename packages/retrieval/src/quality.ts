// Retrieval quality (spec §5): recall@k, MRR and the answer-bearing-chunk-in-context rate over labelled questions.
// A relevant passage is (file, text the chunk must contain); a hit matches it when it comes from that file and
// its text contains the passage (labels survive re-chunking, chunk ids don't).
import type { SearchHit } from "./types.ts";

export interface Passage {
  readonly file: string;
  readonly contains: string;
}

export interface Judged {
  readonly q: string;
  readonly relevant: readonly Passage[];
  readonly hits: readonly Pick<SearchHit, "file" | "text">[];
}

export interface Quality {
  readonly questions: number;
  /** Mean over questions of (relevant passages found in the top k) / (relevant passages). */
  readonly recall: number;
  /** Mean reciprocal rank of the first relevant hit (0 when none). */
  readonly mrr: number;
  /** Share of questions with at least one relevant passage in the top k. */
  readonly answerInContext: number;
  readonly misses: readonly { q: string; missing: readonly Passage[] }[];
}

const matches = (h: Pick<SearchHit, "file" | "text">, p: Passage) => h.file === p.file && h.text.includes(p.contains);

export function quality(judged: readonly Judged[], k = 8): Quality {
  let recall = 0;
  let mrr = 0;
  let inContext = 0;
  const misses: { q: string; missing: Passage[] }[] = [];
  for (const j of judged) {
    const top = j.hits.slice(0, k);
    const found = j.relevant.filter((p) => top.some((h) => matches(h, p)));
    recall += j.relevant.length ? found.length / j.relevant.length : 1;
    const first = top.findIndex((h) => j.relevant.some((p) => matches(h, p)));
    if (first >= 0) {
      mrr += 1 / (first + 1);
      inContext++;
    }
    const missing = j.relevant.filter((p) => !found.includes(p));
    if (missing.length) misses.push({ q: j.q, missing });
  }
  const n = judged.length || 1;
  return { questions: judged.length, recall: recall / n, mrr: mrr / n, answerInContext: inContext / n, misses };
}
