// The fixture file writers every dataset and the generator share: a minimal DOCX and a plain-text email.
// Deterministic: the same input gives the same bytes on every build.
import { zipStored } from "./zip.ts";

export interface DocxSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A minimal DOCX: one Heading1 paragraph per section heading, then its body paragraphs. */
export function docx(sections: readonly DocxSection[]): Uint8Array {
  const enc = new TextEncoder();
  const para = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  const body = sections.flatMap((s) => [para(s.heading, "Heading1"), ...s.paragraphs.map((p) => para(p))]).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zipStored([
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rels) },
    { name: "word/document.xml", data: enc.encode(document) },
  ]);
}

export interface EmlHeaders {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly date: string;
  /** The Message-ID without its angle brackets. */
  readonly id: string;
}

/** A plain-text email (CRLF line ends, UTF-8, 8bit) as text. */
export function emlText(h: EmlHeaders, body: string): string {
  return [
    `From: ${h.from}`,
    `To: ${h.to}`,
    `Subject: ${h.subject}`,
    `Date: ${h.date}`,
    `Message-ID: <${h.id}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

/** The same email as bytes. */
export function eml(h: EmlHeaders, body: string): Uint8Array {
  return new TextEncoder().encode(emlText(h, body));
}
