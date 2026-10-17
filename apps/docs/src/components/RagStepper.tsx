// <RagStepper />: one query through the documents lane — BM25, vectors, reciprocal-rank fusion, rerank, extract —
// with the real ranks from a run on examples/coffee-roaster (offline hash embedder; rerank skipped and reported).
import { useState } from "react";
import rag from "../data/rag.json";
import "./islands.css";

type Hit = { chunk: string; file: string; heading: string; text: string; bm25: number | null; vector: number | null; score: number };
const STEPS = [
  { id: "bm25", title: "1 · BM25 (keywords)", note: "DuckDB full-text search, stemmed. Chunks without the words don't rank." },
  { id: "vector", title: "2 · Vectors (meaning)", note: "Exact cosine search over in-process embeddings." },
  { id: "rrf", title: "3 · Fuse (RRF)", note: "Each list votes 1/(60 + rank): a chunk high in both lists wins." },
  {
    id: "rerank",
    title: "4 · Rerank",
    note: "A cross-encoder reorders the top chunks. Skipped here (offline run), and the report says so.",
  },
  {
    id: "extract",
    title: "5 · Extract",
    note: "Only the quarantined extractor reads the text; it returns typed events with exact quotes.",
  },
] as const;

export default function RagStepper() {
  const hits = rag.hits as Hit[];
  const [step, setStep] = useState(0);
  const id = STEPS[step]?.id ?? "bm25";
  const ordered =
    id === "bm25"
      ? hits.filter((h) => h.bm25 !== null).sort((a, b) => (a.bm25 ?? 0) - (b.bm25 ?? 0))
      : id === "vector"
        ? [...hits].filter((h) => h.vector !== null).sort((a, b) => (a.vector ?? 0) - (b.vector ?? 0))
        : [...hits].sort((a, b) => b.score - a.score);
  const shown = id === "extract" ? ordered.slice(0, 1) : ordered;
  return (
    <section className="aa-island" aria-label="Retrieval step-through">
      <p className="aa-island-label">Query: “{rag.query}”</p>
      <div className="aa-row">
        {STEPS.map((s, i) => (
          <button key={s.id} type="button" className="aa-btn" aria-pressed={i === step} onClick={() => setStep(i)}>
            {s.title}
          </button>
        ))}
      </div>
      <p className="aa-small">{STEPS[step]?.note}</p>
      <ol className="aa-hits">
        {shown.map((h, i) => (
          <li key={h.chunk}>
            <strong>{i + 1}</strong>
            <span>
              <code>{h.file}</code> {h.heading ? `› ${h.heading}` : ""}
              <br />
              <span>{h.text.replace(/\s+/g, " ").slice(0, 120)}…</span>
            </span>
            <span style={{ textAlign: "right" }}>
              {id === "bm25" ? `BM25 #${h.bm25}` : id === "vector" ? `vector #${h.vector}` : `RRF ${h.score.toFixed(4)}`}
            </span>
          </li>
        ))}
      </ol>
      {id === "extract" ? (
        <pre className="aa-ev">{JSON.stringify(rag.extract ?? "(no extract stored for this chunk)", null, 2)}</pre>
      ) : null}
    </section>
  );
}
