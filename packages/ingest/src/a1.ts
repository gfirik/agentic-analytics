// A1 address helpers (0-based row/col in, Excel letters out).
export function colLetter(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function addr(r: number, c: number): string {
  return `${colLetter(c)}${r + 1}`;
}

export function rangeA1(r0: number, c0: number, r1: number, c1: number): string {
  return `${addr(r0, c0)}:${addr(r1, c1)}`;
}
