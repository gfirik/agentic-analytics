// Minimal text-only PDF writer (Helvetica, one text line per entry, ASCII only) for hand-built fixtures.
// Deterministic: no creation dates or random ids.

function escapePdf(s: string): string {
  if (/[^\x20-\x7e]/.test(s)) throw new Error(`PDF fixture text must be printable ASCII: ${JSON.stringify(s)}`);
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

export function textPdf(pages: readonly (readonly string[])[]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body); // returns the 1-based object number
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const lines of pages) {
    const ops = ["BT", "/F1 11 Tf", "14 TL", "56 780 Td", ...lines.map((l) => `(${escapePdf(l)}) Tj T*`), "ET"].join("\n");
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
