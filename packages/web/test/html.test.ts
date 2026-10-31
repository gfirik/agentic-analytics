// The readable-text scanner runs in linear time on hostile pages (docs/specs/security.md §4 "Readable text"):
// parsing is synchronous, so the fetch deadline can't stop it. Bounds are generous so CI stays steady; before the
// fix the first input alone took about 7 s at 320 KB, and unclosed `<title` tags about 20 s at 120 KB.
import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/index.ts";

const timed = <T>(f: () => T): { result: T; ms: number } => {
  const t = performance.now();
  const result = f();
  return { result, ms: performance.now() - t };
};
const xs = (n: number) => Array.from({ length: n }, () => "x").join("\n");

describe("readable text in linear time", () => {
  it.each([80_000, 750_000])("a hidden element holding %i unclosed tags (up to the 3 MB fetch cap)", (n) => {
    const { result, ms } = timed(() => htmlToText(`<div hidden>${"<b>x".repeat(n)}`));
    expect(ms).toBeLessThan(2000);
    // Text after the last tag of an unclosed hidden region is dropped, as before.
    expect(result).toEqual({ title: "", text: "", hidden: xs(n - 1) });
  });

  it.each([
    ["unclosed tags", "<a"],
    ["unclosed quotes", '<a "'],
    ["unclosed comments", "<!--"],
    ["unclosed CDATA", "<![CDATA["],
    ["unclosed declarations", "<!x"],
    ["unclosed processing instructions", "<?x"],
    ["title tags without '>'", "<title"],
  ])("3 MB of %s stays text", (_, unit) => {
    const html = unit.repeat(Math.ceil(3_000_000 / unit.length));
    const { result, ms } = timed(() => htmlToText(html));
    expect(ms).toBeLessThan(2000);
    expect(result).toEqual({ title: "", text: html.trim(), hidden: "" });
  });

  it("many titles and stray closing tags", () => {
    const n = 200_000;
    const { result, ms } = timed(() => htmlToText(`${"<title>".repeat(n)}<p>${"</i>".repeat(n)}ok</p>`));
    expect(ms).toBeLessThan(2000);
    // No closing </title>: no title, and the open <title> hides the rest of the page.
    expect(result).toEqual({ title: "", text: "", hidden: "" });
    const closers = htmlToText(`<div hidden>${"</i>".repeat(n)}secret</div>after`);
    expect(closers).toEqual({ title: "", text: "after", hidden: "secret" });
  });

  it("nesting past the depth cap inside a hidden region stays hidden and closes cleanly", () => {
    const html = `<div hidden>${"<i>".repeat(300)}deep${"</i>".repeat(300)}</div>after`;
    expect(htmlToText(html)).toEqual({ title: "", text: "after", hidden: "deep" });
  });
});
