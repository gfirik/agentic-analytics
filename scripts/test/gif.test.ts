// The demo GIF limit (docs/DOCS-SITE.md §3) is checked from the frame delays: a hand-built two-frame GIF whose delays
// are 150 and 250 hundredths lasts 4.0 s, even though its pixel data contains the delay marker's bytes.
import { describe, expect, it } from "vitest";
import { gifSeconds } from "../readme-assets/assets.ts";

const frame = (delay: number, data: number[]) => [
  0x21,
  0xf9,
  0x04,
  0x00,
  delay & 0xff,
  delay >> 8,
  0x00,
  0x00, // graphic control extension
  0x2c,
  0,
  0,
  0,
  0,
  1,
  0,
  1,
  0,
  0x00, // image descriptor, no local color table
  0x02,
  data.length,
  ...data,
  0x00, // LZW min code size, one sub-block, terminator
];

describe("gifSeconds", () => {
  it("sums the frame delays by walking the blocks", () => {
    const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
    // The image data of the first frame contains 21 F9 04 … — a byte scan would count a bogus 650 s delay.
    const gif = new Uint8Array([...header, ...frame(150, [0x21, 0xf9, 0x04, 0x00, 0xe8, 0xfd]), ...frame(250, [0x44, 0x01]), 0x3b]);
    expect(gifSeconds(gif)).toBe(4);
  });
});
