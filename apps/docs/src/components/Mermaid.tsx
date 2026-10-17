// <Mermaid />: renders a shared diagram (docs/assets/diagrams/*.mmd, the same files the README embeds) in the site's
// colours and type (src/styles/tokens.css): the tokens are read from the page, so light and dark both follow the
// theme. The source stays readable if scripts are off. Mermaid is bundled with the site: no request leaves it.
import { useEffect, useState } from "react";
import "./islands.css";

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function Mermaid({ code, title }: { code: string; title: string }) {
  const [svg, setSvg] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      const mermaid = (await import("mermaid")).default;
      const ink = token("--aa-ink");
      const rule = token("--aa-rule-strong");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: {
          fontFamily: token("--aa-font-sans"),
          fontSize: "14px",
          background: token("--aa-raised"),
          primaryColor: token("--aa-surface"),
          primaryTextColor: ink,
          primaryBorderColor: rule,
          secondaryColor: token("--aa-mark"),
          secondaryTextColor: ink,
          secondaryBorderColor: rule,
          tertiaryColor: token("--aa-raised"),
          tertiaryTextColor: ink,
          tertiaryBorderColor: rule,
          lineColor: token("--aa-ink-2"),
          textColor: ink,
          mainBkg: token("--aa-surface"),
          nodeBorder: rule,
          clusterBkg: token("--aa-page"),
          clusterBorder: token("--aa-rule"),
          titleColor: ink,
          edgeLabelBackground: token("--aa-raised"),
          labelBackground: token("--aa-raised"),
        },
      });
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
    <figure className="aa-diagram" aria-label={title}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid renders our own committed diagram source with securityLevel strict */}
      {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <pre>{code}</pre>}
      <figcaption>{title}</figcaption>
    </figure>
  );
}
