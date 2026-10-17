// The terminal review's line input: piped answers are read in order, and the end of input stops the review
// (ReviewEndedError) instead of hanging or asking again forever.
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { lineReader, ReviewEndedError } from "../src/prompt.ts";

const sink = () => {
  const out = new PassThrough();
  let text = "";
  out.on("data", (c: Buffer) => {
    text += c.toString();
  });
  return { out, text: () => text };
};

describe("lineReader", () => {
  it("reads answers piped in before the questions, in order, and writes each prompt", async () => {
    const input = new PassThrough();
    const o = sink();
    const r = lineReader(input, o.out);
    input.end("a\nd\n");
    await new Promise((resolve) => setImmediate(resolve));
    expect(await r.question("first? ")).toBe("a");
    expect(await r.question("second? ")).toBe("d");
    expect(o.text()).toBe("first? second? ");
    await expect(r.question("third? ")).rejects.toBeInstanceOf(ReviewEndedError);
  });

  it("answers a question asked before the line arrives", async () => {
    const input = new PassThrough();
    const r = lineReader(input, sink().out);
    const pending = r.question("q? ");
    input.write("e\n");
    expect(await pending).toBe("e");
    r.close();
  });

  it("fails a pending question when the input ends", async () => {
    const input = new PassThrough();
    const r = lineReader(input, sink().out);
    const pending = r.question("q? ");
    input.end();
    await expect(pending).rejects.toMatchObject({ code: "REVIEW_ENDED" });
  });
});
