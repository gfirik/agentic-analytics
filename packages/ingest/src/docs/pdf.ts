// PDFs with a text layer via unpdf (pdf.js): one text per page. A PDF without one goes to Docling when it
// is configured, else it becomes a `needs_ocr` issue (spec §4).
import { extractText, getDocumentProxy } from "unpdf";
import { IngestError } from "../errors.ts";

export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  try {
    // pdf.js may detach the buffer it is given, so it gets a copy.
    const pdf = await getDocumentProxy(bytes.slice());
    const { text } = await extractText(pdf, { mergePages: false });
    await pdf.cleanup();
    return text.map((t) => t.replace(/[ \t]+\n/g, "\n").trimEnd());
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") throw new IngestError("PASSWORD", "the PDF is password-protected", { cause: err });
    throw new IngestError("UNREADABLE", `the PDF could not be read: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

export function hasTextLayer(pages: readonly string[]): boolean {
  return pages.some((p) => p.replace(/\s+/g, "").length >= 20);
}
