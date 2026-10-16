// <VerifierDiff />: the draft report against the verified one, from a real run. The scripted planner makes the
// mistakes a model makes (an unknown fact id, causal wording with no document, an action tied to no finding); the
// verifier drops or rewrites them, and lists each one with its reason.
import coffee from "../data/coffee.json";
import "./islands.css";

type Report = {
  findings: { id: string; claims: { text: string }[] }[];
  verification: {
    claims_dropped: { claim: string; reason: string }[];
    claims_downgraded: { claim: string; from: string; to: string; reason: string }[];
  };
};

export default function VerifierDiff() {
  const draft = coffee.draft as unknown as Report;
  const report = coffee.report as unknown as Report;
  const dropped = [...draft.verification.claims_dropped, ...report.verification.claims_dropped].filter(
    (d, i, a) => a.findIndex((x) => x.claim === d.claim && x.reason === d.reason) === i,
  );
  const changed = report.verification.claims_downgraded;
  return (
    <section className="aa-island aa-diff" aria-label="Draft versus verified report">
      <h4>Draft → verified · what the verifier changed</h4>
      <ul>
        {dropped.map((d) => (
          <li key={d.claim + d.reason}>
            <span className="dropped">{d.claim}</span>
            <span className="reason">dropped · {d.reason}</span>
          </li>
        ))}
        {changed.map((d) => (
          <li key={d.claim + d.reason}>
            <span className="kept">
              <ins>{d.claim}</ins>
            </span>
            <span className="reason">
              {d.from} → {d.to} · {d.reason}
            </span>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: "0.8rem" }}>
        {report.findings.reduce((a, f) => a + f.claims.length, 0)} claims shipped; {dropped.length} dropped and {changed.length} reworded or
        downgraded on the way, each listed in the report's verification section.
      </p>
    </section>
  );
}
