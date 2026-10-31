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
 *
 * Runs in linear time: a page is attacker-written and parsing is synchronous, so the fetch deadline can't stop a
 * slow parse (docs/specs/security.md §4 "Readable text"). Every search below either finds its match or proves no
 * later one exists, and the open-element stack is updated in amortised constant time per tag.
 */
export function htmlToText(html: string): { title: string; text: string; hidden: string } {
  const title = decodeEntities(titleOf(html)).replace(/\s+/g, " ").trim();
  const comments: string[] = [];
  const src = replaceSpans(
    replaceSpans(replaceSpans(html, "<!--", "-->", comments), "<![CDATA[", "]]>"),
    // Declarations and processing instructions (<!doctype html>, <?xml …?>) are markup, not text.
    /<[!?]/g,
    ">",
  );
  const out: string[] = [];
  const hidden: string[] = [...comments];
  const skipping = new SkipStack();
  const tags = new TagScanner(src);
  let pos = 0;
  for (let m = tags.next(pos); m; m = tags.next(pos)) {
    const chunk = src.slice(pos, m.index);
    if (!skipping.depth) out.push(chunk);
    else if (skipping.allProse) hidden.push(chunk);
    pos = m.end;
    const { name, closing, attrs } = m;
    const selfClosing = VOID.has(name) || attrs.trimEnd().endsWith("/");
    if (closing) {
      skipping.close(name);
      if (!skipping.depth && BLOCK.has(name)) out.push("\n");
      if (skipping.depth && BLOCK.has(name)) hidden.push("\n");
      continue;
    }
    if (skipping.depth) {
      if (!selfClosing) skipping.open(name);
      continue;
    }
    if ((SKIP.has(name) || HIDDEN.test(attrs)) && !selfClosing) {
      // Everything skipped but code is prose for the screen: hidden elements, and the page chrome that the readable
      // text leaves out.
      skipping.open(name);
      continue;
    }
    if (BLOCK.has(name)) out.push("\n");
  }
  if (!skipping.depth) out.push(src.slice(pos));
  const tidy = (parts: string[]) =>
    decodeEntities(parts.join(""))
      .split("\n")
      .map((l) => l.replace(/[ \t\r\f\v\u00a0]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  return { title, text: tidy(out), hidden: tidy(hidden.map((h) => `${h}\n`)) };
}

/** Skipped elements whose content is code (scripts, styles, svg), not prose; see SkipStack. */
const CODE = new Set(["script", "style", "noscript", "svg", "template", "iframe", "object", "canvas", "head", "title"]);
/** Nesting kept inside a skipped region. Deeper opening tags are not tracked; their text stays hidden. */
const MAX_SKIP_DEPTH = 256;

/**
 * Open elements whose content is dropped: a tag name per level, so nested same-name tags close correctly. A level
 * is prose (hidden elements, page chrome) or code. Counts per name and of code levels keep every operation
 * amortised O(1): a closing tag with no open match costs nothing, and one with a match scans only the levels it
 * removes.
 */
class SkipStack {
  private readonly names: string[] = [];
  private readonly counts = new Map<string, number>();
  private codeLevels = 0;

  get depth(): number {
    return this.names.length;
  }

  get allProse(): boolean {
    return this.codeLevels === 0;
  }

  open(name: string): void {
    if (this.names.length >= MAX_SKIP_DEPTH) return;
    this.names.push(name);
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    if (CODE.has(name)) this.codeLevels++;
  }

  /** Closes the innermost open `name` and everything inside it; a stray closing tag changes nothing. */
  close(name: string): void {
    if (!this.counts.get(name)) return;
    for (;;) {
      const top = this.names.pop() as string;
      this.counts.set(top, (this.counts.get(top) ?? 1) - 1);
      if (CODE.has(top)) this.codeLevels--;
      if (top === name) return;
    }
  }
}

interface Tag {
  readonly index: number;
  readonly end: number;
  readonly name: string;
  readonly closing: boolean;
  readonly attrs: string;
}

const NAME_START = /[a-zA-Z]/;
const NAME_CHAR = /[\w-]/;

/**
 * Finds tags as `/<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g` would, without the regex's quadratic
 * failures: on a page full of unclosed tags or quotes, every `<` would rescan to the end of the input. Quote-aware
 * attributes: a ">" inside a quoted value doesn't end the tag (and can't smuggle hidden text out).
 *
 * The attribute scan from any position is deterministic (plain characters step by one, a quote jumps past its
 * closing quote or fails if there is none, ">" ends the tag), so its outcome is computed once per position, right
 * to left, and every tag start looks it up.
 */
class TagScanner {
  /** For each position, the index of the ">" that ends an attribute scan started there, or -1 if it fails. */
  private readonly gt: Int32Array;

  constructor(private readonly src: string) {
    const n = src.length;
    this.gt = new Int32Array(n + 1);
    this.gt[n] = -1;
    let nextDouble = -1;
    let nextSingle = -1;
    for (let p = n - 1; p >= 0; p--) {
      const c = src.charCodeAt(p);
      if (c === 0x3e /* > */) this.gt[p] = p;
      else if (c === 0x22 /* " */) {
        this.gt[p] = nextDouble < 0 ? -1 : (this.gt[nextDouble + 1] as number);
        nextDouble = p;
      } else if (c === 0x27 /* ' */) {
        this.gt[p] = nextSingle < 0 ? -1 : (this.gt[nextSingle + 1] as number);
        nextSingle = p;
      } else this.gt[p] = this.gt[p + 1] as number;
    }
  }

  /** The first tag starting at or after `from`. */
  next(from: number): Tag | undefined {
    const { src } = this;
    for (let i = src.indexOf("<", from); i >= 0; i = src.indexOf("<", i + 1)) {
      const closing = src[i + 1] === "/";
      const nameStart = closing ? i + 2 : i + 1;
      if (!NAME_START.test(src[nameStart] ?? "")) continue;
      let nameEnd = nameStart + 1;
      while (nameEnd < src.length && NAME_CHAR.test(src[nameEnd] as string)) nameEnd++;
      const gt = this.gt[nameEnd] as number;
      if (gt < 0) continue;
      return { index: i, end: gt + 1, name: src.slice(nameStart, nameEnd).toLowerCase(), closing, attrs: src.slice(nameEnd, gt) };
    }
    return undefined;
  }
}

/** The first `<title…>…</title>`'s content, as `/<title[^>]*>([\s\S]*?)<\/title>/i` finds it, in linear time. */
function titleOf(html: string): string {
  const open = /<title/gi.exec(html);
  if (!open) return "";
  // If this tag or its closing tag is missing, no later <title> can have them either.
  const gt = html.indexOf(">", open.index + 6);
  if (gt < 0) return "";
  const close = /<\/title>/gi;
  close.lastIndex = gt + 1;
  const end = close.exec(html);
  return end ? html.slice(gt + 1, end.index) : "";
}

/**
 * Replaces each span from `open` to the first `close` after it with a space, as the lazy regex `open[\s\S]*?close`
 * with /g would, in linear time: once a `close` is missing, no later span can end either. `inner` collects the text
 * between the delimiters.
 */
function replaceSpans(s: string, open: string | RegExp, close: string, inner?: string[]): string {
  const parts: string[] = [];
  let pos = 0;
  for (;;) {
    let at: number;
    let openLen: number;
    if (typeof open === "string") {
      at = s.indexOf(open, pos);
      openLen = open.length;
    } else {
      open.lastIndex = pos;
      const m = open.exec(s);
      at = m ? m.index : -1;
      openLen = m ? m[0].length : 0;
    }
    if (at < 0) break;
    const end = s.indexOf(close, at + openLen);
    if (end < 0) break;
    parts.push(s.slice(pos, at), " ");
    inner?.push(s.slice(at + openLen, end));
    pos = end + close.length;
  }
  parts.push(s.slice(pos));
  return parts.join("");
}
