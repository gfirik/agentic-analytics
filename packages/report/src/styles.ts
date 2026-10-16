// Self-contained CSS: system fonts only (no web-font requests), light and dark themes, print styles.
// Palette follows docs/assets/blueprint.html; contrast pairs meet WCAG AA.
export const STYLES = `
:root{--bg:#f2f4f3;--paper:#fbfcfb;--ink:#14201c;--muted:#4e5c57;--line:#d3dbd8;--grid:#e3e9e6;--accent:#0b5f58;--accent-soft:#d6ebe8;
--hl:#f2c14e;--hl-soft:#fbecc2;--bad:#a53c28;--good:#276b3e;--ext:#6b3fa0;
--display:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;--body:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e1413;--paper:#141c1a;--ink:#e3ebe8;--muted:#a3b2ad;--line:#2a3634;--grid:#1a2422;
--accent:#5ccabd;--accent-soft:#163633;--hl:#e0b04a;--hl-soft:#3a3018;--bad:#ee8b74;--good:#7fd39b;--ext:#c4a3f0;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0e1413;--paper:#141c1a;--ink:#e3ebe8;--muted:#a3b2ad;--line:#2a3634;--grid:#1a2422;--accent:#5ccabd;--accent-soft:#163633;
--hl:#e0b04a;--hl-soft:#3a3018;--bad:#ee8b74;--good:#7fd39b;--ext:#c4a3f0;color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.6;
background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:28px 28px}
.wrap{max-width:1240px;margin:0 auto;padding:32px 16px 80px;display:grid;grid-template-columns:minmax(0,1fr);gap:28px}
@media (min-width:1000px){.wrap{grid-template-columns:minmax(0,1fr) 400px;align-items:start}.evidence{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto}}
main{display:grid;gap:36px;min-width:0}
h1,h2,h3{font-family:var(--display);margin:0;letter-spacing:-.01em;text-wrap:balance}
h1{font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.1}
h2{font-size:1.35rem;line-height:1.2;border-top:2px solid var(--ink);padding-top:10px}
h3{font-size:1.05rem}
p{margin:0;max-width:72ch}
ul,ol{margin:0;padding-left:1.2em}
section{display:grid;gap:14px}
.eyebrow{font-family:var(--mono);font-size:.74rem;text-transform:uppercase;letter-spacing:.12em;color:var(--accent)}
.muted{color:var(--muted)}
.mono,code,pre{font-family:var(--mono);font-size:.86em}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:16px}
.head{display:grid;gap:12px}
.meta{display:flex;flex-wrap:wrap;gap:8px}
.tag{font-family:var(--mono);font-size:.78rem;border:1px solid var(--line);background:var(--paper);padding:2px 10px;border-radius:99px;color:var(--muted)}
.tag.ok{color:var(--good);border-color:var(--good)}
.tag.warn{color:var(--bad);border-color:var(--bad)}
.headline{font-size:1.2rem;font-weight:600}
.bullets{display:grid;gap:10px}
.claim{display:grid;gap:6px}
.claim p{max-width:none}
.grade{font-family:var(--mono);font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border:1px dashed var(--line);border-radius:4px;padding:0 6px;margin-left:6px;white-space:nowrap}
.banner{border:2px solid var(--bad);background:var(--paper);border-radius:6px;padding:14px 16px;display:grid;gap:6px}
.banner b{color:var(--bad)}
.finding,.rec{display:grid;gap:12px;border-left:4px solid var(--accent)}
.finding.sev-high{border-left-color:var(--bad)}
.finding.improvement{border-left-color:var(--good)}
.kind{font-family:var(--mono);font-size:.74rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.drivers{width:100%;border-collapse:collapse;font-size:.92rem}
.drivers th,.drivers td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0}
.kv dt{color:var(--muted);font-size:.9rem}
.kv dd{margin:0}
.reasons{color:var(--muted);font-size:.92rem}
.range{position:relative;height:14px;background:var(--grid);border-radius:7px;margin:6px 0}
.range .band{position:absolute;top:0;bottom:0;background:var(--accent);border-radius:7px;opacity:.85}
.num{font:inherit;font-weight:700;color:inherit;background:linear-gradient(transparent 60%,var(--hl-soft) 60%);border:0;border-bottom:1px dotted var(--accent);padding:0 1px;cursor:pointer}
.num:hover,.num:focus-visible{background:var(--hl-soft)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.cite{font-family:var(--mono);font-size:.76rem;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:99px;padding:2px 10px;cursor:pointer}
.cite:hover{border-color:var(--accent)}
.cite[aria-pressed="true"]{background:var(--hl);border-color:var(--hl);color:#14201c}
.ext{font-family:var(--mono);font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ext);border:1px solid var(--ext);border-radius:4px;padding:0 4px;margin-left:4px}
button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.evidence{display:grid;gap:12px}
.ev{display:grid;gap:8px}
.ev table{width:100%;border-collapse:collapse;font-size:.85rem;font-variant-numeric:tabular-nums}
.ev th,.ev td{border-bottom:1px solid var(--line);padding:3px 6px;text-align:right}
.ev th:first-child,.ev td:first-child{text-align:left}
.ev tr.hl td{background:var(--hl-soft)}
.ev td.hl{background:var(--hl);color:#14201c;font-weight:700}
.rowid{font-family:var(--mono);font-size:.72rem;color:var(--muted);margin-right:6px}
.doc{white-space:pre-wrap;font-size:.9rem;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:10px;margin:0}
mark{background:transparent;color:inherit}
mark.hl{background:var(--hl);color:#14201c}
.fact-panel{position:fixed;inset:auto 16px 16px auto;width:min(520px,calc(100vw - 32px));max-height:80vh;overflow:auto;z-index:10;box-shadow:0 10px 40px rgba(0,0,0,.25)}
.fact-panel .fp-value{font-family:var(--display);font-size:1.8rem;font-weight:700}
.fact-panel .sql{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:10px}
.close{float:right;font:inherit;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:4px;cursor:pointer;padding:2px 10px}
.list{display:grid;gap:8px}
.verify-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.stat{border:1px solid var(--line);border-radius:6px;padding:10px;background:var(--paper)}
.stat b{display:block;font-size:1.3rem;font-family:var(--display)}
.hint{color:var(--muted);font-size:.86rem}
@media print{
  body{background:#fff;color:#000}
  .wrap{display:block;padding:0}
  .evidence,.fact-panel,.hint-click{display:none!important}
  .panel{border-color:#999;break-inside:avoid}
  .num{background:none;border:0;font-weight:700}
  .cite{border-color:#999;background:#fff}
  h2{break-after:avoid}
}
`;
