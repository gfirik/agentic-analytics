// <Mermaid />: renders a shared diagram (docs/assets/diagrams/*.mmd, the same files the README embeds) in the
// current Starlight theme. The source stays readable if scripts are off.
import { useEffect, useRef, useState } from "react";

export default function Mermaid({ code, title }: { code: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      const mermaid = (await import("mermaid")).default;
      const dark = document.documentElement.dataset.theme === "dark";
      mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict" });
      const { svg } = await mermaid.render(`m${Math.random().toString(36).slice(2)}`, code);
      if (!cancelled) setSvg(svg);
    };
    void draw();
    const obs = new MutationObserver(() => void draw());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [code]);
  return (
    <figure ref={ref} aria-label={title} style={{ margin: "1.5rem 0" }}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid renders our own committed diagram source with securityLevel strict */}
      {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <pre>{code}</pre>}
      <figcaption style={{ fontSize: "0.8rem" }}>{title}</figcaption>
    </figure>
  );
}
