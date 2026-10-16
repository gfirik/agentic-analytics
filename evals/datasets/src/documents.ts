// Text of the coffee-roaster documents. The quotes cited by the golden report are substrings of these,
// so a test can check every citation quote and char span against the source text.
import { zipStored } from "./zip.ts";

export const PRICE_LIST_PAGES: readonly (readonly string[])[] = [
  [
    "Northside Coffee Roasters",
    "Price list 2026",
    "Retail (per bag)",
    "Espresso blend 250g ... 9.50",
    "Filter blend 250g ... 9.00",
    "Drip bags x10 ... 7.50",
  ],
  [
    "Wholesale terms",
    "Wholesale prices increase 12% from 15 March 2026.",
    "Espresso blend 1kg ... 24.60",
    "Filter blend 1kg ... 23.50",
    "Minimum order: 10 kg. Delivery twice a week.",
  ],
  ["Payment terms", "Invoices are due within 14 days.", "Late payments may pause standing orders."],
  ["Contact", "orders@roaster.example", "Northside Coffee Roasters, Tashkent"],
];

/** Page text as a text extractor returns it: lines joined with newlines (no blank lines: extractors drop them). */
export function pageText(page: number): string {
  return (PRICE_LIST_PAGES[page - 1] ?? []).join("\n");
}

export const EMAIL_BODY =
  "Hello,\n\nAfter the new price list we are pausing our standing order while we compare suppliers.\nWe will let you know about May.\n\nPurchasing team\nHotel Group\n";

export const EMAIL_EML = [
  'From: "Purchasing, Hotel Group" <purchasing@hotelgroup.example>',
  "To: orders@roaster.example",
  "Subject: Standing order",
  "Date: Sun, 12 Apr 2026 09:14:00 +0500",
  "Message-ID: <0412@hotelgroup.example>",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: 8bit",
  "",
  EMAIL_BODY,
].join("\r\n");

/** ops-notes.docx: numbered sections; §3 carries the packaging-supplier switch (planted P2 cause). */
export const OPS_NOTES: readonly { heading: string; paragraphs: readonly string[] }[] = [
  { heading: "1. Roasting", paragraphs: ["Roast schedule moved to Monday and Thursday mornings."] },
  { heading: "2. Staff", paragraphs: ["One new barista started at the shop counter."] },
  {
    heading: "3. Packaging",
    paragraphs: ["Switched to the new packaging supplier on 28 April.", "The new valve bags are cheaper per unit."],
  },
  { heading: "4. Equipment", paragraphs: ["Grinder serviced; no downtime."] },
];

/** Plain text of the notes as a DOCX text extractor returns it: one paragraph per line. */
export function opsNotesText(): string {
  return OPS_NOTES.flatMap((s) => [s.heading, ...s.paragraphs]).join("\n");
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function opsNotesDocx(): Uint8Array {
  const enc = new TextEncoder();
  const para = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  const body = OPS_NOTES.flatMap((s) => [para(s.heading, "Heading1"), ...s.paragraphs.map((p) => para(p))]).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zipStored([
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rels) },
    { name: "word/document.xml", data: enc.encode(document) },
  ]);
}
