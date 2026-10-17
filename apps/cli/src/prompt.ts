// Line input for the terminal review (aa analyze / aa metrics without --yes). Lines are queued as they arrive, so
// answers piped in ahead of the questions (`printf 'a\na\n' | aa analyze …`) are read in order instead of being
// lost; when the input ends, every pending and later question fails with ReviewEndedError instead of hanging or
// looping.
import { createInterface } from "node:readline";

export class ReviewEndedError extends Error {
  readonly code = "REVIEW_ENDED";
  constructor() {
    super("the input ended before the review was finished");
    this.name = "ReviewEndedError";
  }
}

/** What `aa analyze` and `aa metrics` print when the input ends mid-review (they then exit 1). */
export const reviewEndedLines = (waiting: string): readonly string[] => [
  `The review ended before every metric was answered; ${waiting}.`,
  "Run again and answer each one, or add --yes to keep the drafts as assumptions.",
];

export interface LineReader {
  /** Writes the prompt and resolves with the next line of input. */
  question(prompt: string): Promise<string>;
  close(): void;
}

export function lineReader(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): LineReader {
  const rl = createInterface({ input, terminal: false });
  const queued: string[] = [];
  const waiting: { resolve: (l: string) => void; reject: (e: Error) => void }[] = [];
  let ended = false;
  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next) next.resolve(line);
    else queued.push(line);
  });
  rl.on("close", () => {
    ended = true;
    for (const w of waiting.splice(0)) w.reject(new ReviewEndedError());
  });
  return {
    question(prompt) {
      output.write(prompt);
      const line = queued.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (ended) return Promise.reject(new ReviewEndedError());
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    close: () => rl.close(),
  };
}
