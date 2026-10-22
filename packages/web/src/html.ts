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

/**
 * `text` is what a reader sees. `hidden` is text a reader doesn't see but a model might: hidden elements, the page
 * chrome left out of `text` (nav, header, footer, aside, form, button, select) and HTML comments (never scripts or
 * styles, whose URLs and code aren't prose). Callers screen both for injections.
 */
export function htmlToText(html: string): { title: string; text: string; hidden: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const comments = [...html.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1] ?? "");
  const src = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    // Declarations and processing instructions (<!doctype html>, <?xml …?>) are markup, not text.
    .replace(/<![^>]*>|<\?[^>]*>/g, " ");
  const out: string[] = [];
  const hidden: string[] = [...comments];
  // Open elements whose content is dropped: tag name per level, so nested same-name tags close correctly; `prose`
  // marks levels that hold prose (hidden elements, page chrome) rather than code (scripts, styles, svg).
  const skipping: { name: string; prose: boolean }[] = [];
  const CODE = new Set(["script", "style", "noscript", "svg", "template", "iframe", "object", "canvas", "head", "title"]);
  // Quote-aware attributes: a ">" inside a quoted value doesn't end the tag (and can't smuggle hidden text out).
  const tag = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let pos = 0;
  for (let m = tag.exec(src); m; m = tag.exec(src)) {
    const chunk = src.slice(pos, m.index);
    if (!skipping.length) out.push(chunk);
    else if (skipping.every((x) => x.prose)) hidden.push(chunk);
    pos = m.index + m[0].length;
    const name = (m[1] ?? "").toLowerCase();
    const closing = m[0][1] === "/";
    const attrs = m[2] ?? "";
    const selfClosing = VOID.has(name) || attrs.trimEnd().endsWith("/");
    if (closing) {
      let i = -1;
      for (let k = skipping.length - 1; k >= 0; k--)
        if (skipping[k]?.name === name) {
          i = k;
          break;
        }
      if (i >= 0) skipping.length = i;
      if (!skipping.length && BLOCK.has(name)) out.push("\n");
      if (skipping.length && BLOCK.has(name)) hidden.push("\n");
      continue;
    }
    if (skipping.length) {
      if (!selfClosing) skipping.push({ name, prose: !CODE.has(name) });
      continue;
    }
    if ((SKIP.has(name) || HIDDEN.test(attrs)) && !selfClosing) {
      // Everything skipped but code is prose for the screen: hidden elements, and the page chrome that the readable
      // text leaves out.
      skipping.push({ name, prose: !CODE.has(name) });
      continue;
    }
    if (BLOCK.has(name)) out.push("\n");
  }
  if (!skipping.length) out.push(src.slice(pos));
  const tidy = (parts: string[]) =>
    decodeEntities(parts.join(""))
      .split("\n")
      .map((l) => l.replace(/[ \t\r\f\v\u00a0]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  return { title, text: tidy(out), hidden: tidy(hidden.map((h) => `${h}\n`)) };
}
