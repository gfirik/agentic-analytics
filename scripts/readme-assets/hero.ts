// The README hero (docs/DOCS-SITE.md §3.1): files → three lanes (tables, documents, web) → analyst → verifier →
// report, as pure SVG. The finished diagram is the static default; motion (flowing connectors, stages lighting up
// in order) lives only inside `@media (prefers-reduced-motion: no-preference)`. No script, no external fonts, no
// external references: GitHub renders README SVGs as images.

export interface Palette {
  readonly bg: string;
  readonly ink: string;
  readonly muted: string;
  readonly line: string;
  readonly card: string;
  readonly accent: string;
  readonly table: string;
  readonly doc: string;
  readonly web: string;
  readonly verify: string;
}

export const LIGHT: Palette = {
  bg: "#fbfaf7",
  ink: "#1d1d1b",
  muted: "#6b6a66",
  line: "#d9d5cc",
  card: "#ffffff",
  accent: "#2d6a4f",
  table: "#1d4e89",
  doc: "#8a4f0f",
  web: "#6c3fa0",
  verify: "#b42318",
};

export const DARK: Palette = {
  bg: "#161614",
  ink: "#ecebe6",
  muted: "#a3a29c",
  line: "#3a3934",
  card: "#201f1c",
  accent: "#74c69d",
  table: "#7cb4f0",
  doc: "#f0b46c",
  web: "#c4a3f0",
  verify: "#f08a7c",
};

const W = 1200;
const H = 420;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Box {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly title: string;
  readonly sub: string;
  readonly color: keyof Palette;
  /** Order in which the stage lights up (seconds into the loop). */
  readonly at: number;
}

const FILES = ["sales.xlsx", "export.csv", "price-list.pdf", "notes.docx", "email.eml"];
const BOXES: readonly Box[] = [
  { id: "tables", x: 250, y: 60, w: 210, h: 74, title: "Tables lane", sub: "DuckDB SQL · metrics", color: "table", at: 0.6 },
  { id: "docs", x: 250, y: 173, w: 210, h: 74, title: "Documents lane", sub: "BM25 + vectors · quotes", color: "doc", at: 0.9 },
  { id: "web", x: 250, y: 286, w: 210, h: 74, title: "Web lane", sub: "sanitized · external", color: "web", at: 1.2 },
  {
    id: "analyst",
    x: 540,
    y: 150,
    w: 200,
    h: 120,
    title: "Analyst",
    sub: "detect · decompose\nexplain · decide",
    color: "accent",
    at: 1.8,
  },
  {
    id: "verifier",
    x: 800,
    y: 150,
    w: 170,
    h: 120,
    title: "Verifier",
    sub: "recompute · re-derive\ncheck every citation",
    color: "verify",
    at: 2.4,
  },
  {
    id: "report",
    x: 1020,
    y: 150,
    w: 150,
    h: 120,
    title: "Report",
    sub: "what changed, why,\nwhat to do · cited",
    color: "accent",
    at: 3.0,
  },
];

function box(b: Box, p: Palette): string {
  const lines = b.sub.split("\n");
  const cx = b.x + b.w / 2;
  const top = b.y + b.h / 2 - (lines.length * 18) / 2 - 4;
  return `<g class="stage s-${b.id}">
  <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" fill="${p.card}" stroke="${p[b.color]}" stroke-width="2"/>
  <text x="${cx}" y="${top}" text-anchor="middle" class="t" fill="${p[b.color]}">${esc(b.title)}</text>
  ${lines.map((l, i) => `<text x="${cx}" y="${top + 22 + i * 18}" text-anchor="middle" class="s" fill="${p.muted}">${esc(l)}</text>`).join("\n  ")}
</g>`;
}

function link(id: string, d: string, color: string): string {
  return `<path id="${id}" class="flow" d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
}

export function heroSvg(p: Palette, theme: "light" | "dark"): string {
  const files = FILES.map(
    (f, i) => `<g class="file f${i}">
  <rect x="24" y="${70 + i * 58}" width="168" height="40" rx="8" fill="${p.card}" stroke="${p.line}" stroke-width="1.5"/>
  <text x="108" y="${95 + i * 58}" text-anchor="middle" class="s" fill="${p.ink}">${esc(f)}</text>
</g>`,
  ).join("\n");
  const links = [
    // files → lanes
    link("l1", "M192 110 C220 110 222 97 250 97", p.table),
    link("l2", "M192 168 C220 168 222 97 250 97", p.table),
    link("l3", "M192 226 C220 226 222 210 250 210", p.doc),
    link("l4", "M192 284 C220 284 222 210 250 210", p.doc),
    link("l5", "M192 342 C220 342 222 323 250 323", p.web),
    // lanes → analyst
    link("l6", "M460 97 C500 97 500 190 540 190", p.table),
    link("l7", "M460 210 L540 210", p.doc),
    link("l8", "M460 323 C500 323 500 230 540 230", p.web),
    // analyst → verifier → report
    link("l9", "M740 210 L800 210", p.accent),
    link("l10", "M970 210 L1020 210", p.verify),
  ].join("\n");
  const delays = BOXES.map((b) => `.s-${b.id}{animation-delay:${b.at}s}`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="title desc">
<title id="title">agentic-analytics: files in, a verified report out</title>
<desc id="desc">Business files flow into three lanes (tables via DuckDB SQL, documents via hybrid retrieval, and a sanitized web lane), then to an analyst that detects, decomposes, explains and decides, then to a verifier that recomputes every number and checks every citation, and finally to a cited report. ${theme} theme.</desc>
<style>
.t{font:600 17px system-ui,-apple-system,"Segoe UI",sans-serif}
.s{font:13px system-ui,-apple-system,"Segoe UI",sans-serif}
.cap{font:12px system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.06em}
.flow{stroke-dasharray:none}
@media (prefers-reduced-motion: no-preference){
.flow{stroke-dasharray:6 8;animation:flow 1.2s linear infinite}
.stage{animation:glow 4.8s ease-in-out infinite}
${delays}
.file{animation:glow 4.8s ease-in-out infinite}
@keyframes flow{to{stroke-dashoffset:-28}}
@keyframes glow{0%,100%{opacity:.55}15%,60%{opacity:1}}
}
</style>
<rect width="${W}" height="${H}" rx="18" fill="${p.bg}"/>
<text x="24" y="40" class="cap" fill="${p.muted}">YOUR FILES</text>
<text x="250" y="40" class="cap" fill="${p.muted}">THREE LANES</text>
<text x="540" y="128" class="cap" fill="${p.muted}">COMPUTED FACTS ONLY</text>
<text x="800" y="128" class="cap" fill="${p.muted}">NOTHING UNVERIFIED SHIPS</text>
${links}
${files}
${BOXES.map((b) => box(b, p)).join("\n")}
<text x="1095" y="300" text-anchor="middle" class="s" fill="${p.muted}">report.json + report.html</text>
</svg>
`;
}
