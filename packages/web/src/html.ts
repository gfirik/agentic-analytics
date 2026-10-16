// Readable text from a fetched page. A small tolerant tag scanner, no dependency: it keeps the text a reader sees
// and drops what a reader doesn't (scripts, styles, navigation, forms, and elements hidden with `hidden`,
// `aria-hidden`, `display:none`, `visibility:hidden` or a zero font size, where injected instructions like to
// hide). The result is still untrusted: it goes to the quarantined extractor only.

const SKIP = new Set([
  "title",
  "script",
  "style",
  "noscript",
  "svg",
  "template",
  "iframe",
  "object",
  "canvas",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "button",
  "select",
  "head",
]);
const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "li",
  "ul",
  "ol",
  "table",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "br",
  "hr",
  "blockquote",
  "pre",
  "figcaption",
  "dd",
  "dt",
]);
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);
const HIDDEN =
  /\bhidden\b|aria-hidden\s*=\s*["']?true|display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d]*[1-9])|opacity\s*:\s*0(?![.\d]*[1-9])/i;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const src = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ");
  const out: string[] = [];
  // Open elements whose content is dropped: tag name per level, so nested same-name tags close correctly.
  const skipping: string[] = [];
  const tag = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  let pos = 0;
  for (let m = tag.exec(src); m; m = tag.exec(src)) {
    if (!skipping.length) out.push(src.slice(pos, m.index));
    pos = m.index + m[0].length;
    const name = (m[1] ?? "").toLowerCase();
    const closing = m[0][1] === "/";
    const attrs = m[2] ?? "";
    const selfClosing = VOID.has(name) || attrs.trimEnd().endsWith("/");
    if (closing) {
      const i = skipping.lastIndexOf(name);
      if (i >= 0) skipping.length = i;
      if (!skipping.length && BLOCK.has(name)) out.push("\n");
      continue;
    }
    if (skipping.length) {
      if (!selfClosing) skipping.push(name);
      continue;
    }
    if ((SKIP.has(name) || HIDDEN.test(attrs)) && !selfClosing) {
      skipping.push(name);
      continue;
    }
    if (BLOCK.has(name)) out.push("\n");
  }
  if (!skipping.length) out.push(src.slice(pos));
  const text = decodeEntities(out.join(""))
    .split("\n")
    .map((l) => l.replace(/[ \t\r\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text };
}
