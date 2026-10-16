// printing-shop-v1: a document corpus for the retrieval eval (docs/specs/retrieval.md §5). A small print studio's
// PDFs, Word files, emails and notes in English and Russian, with planted answers, near-miss distractors and
// sections long enough to be split. Deterministic: the same bytes on every build.
import { textPdf } from "./pdf.ts";
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

export function eml(h: { from: string; to: string; subject: string; date: string; id: string }, body: string): Uint8Array {
  return new TextEncoder().encode(
    [
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
    ].join("\r\n"),
  );
}

// ── PDFs (ASCII only: the fixture PDF writer uses a standard font) ──────────────────────────────────────────

const PRICE_LIST: readonly (readonly string[])[] = [
  [
    "Inkwell Print Studio",
    "Price list 2026",
    "Business cards, 100 pcs ... 18.00",
    "Business cards, 500 pcs ... 49.00",
    "Flyers A5, 500 pcs ... 65.00",
    "Flyers A4, 500 pcs ... 98.00",
    "Posters A2 ... 12.00 each",
  ],
  [
    "Rush and delivery",
    "Rush orders finished within 24 hours carry a 30% surcharge on the list price.",
    "Standard turnaround is three working days after proof approval.",
    "Same-day pickup is possible for digital prints ordered before 10:00.",
  ],
  [
    "Paper stock",
    "From 1 May 2026 business cards are printed on 350gsm silk card instead of 300gsm matt.",
    "Flyers use 170gsm gloss unless the customer asks for recycled paper.",
    "Recycled paper adds 8% to the flyer price.",
  ],
];

const SUPPLIER_CONTRACT: readonly (readonly string[])[] = [
  [
    "Supply agreement: PaperWorks Ltd and Inkwell Print Studio",
    "1. Scope",
    "PaperWorks supplies coated and uncoated paper, card stock and envelopes.",
    "2. Prices",
    "PaperWorks raises the price of A3 coated stock by 9% effective 1 June 2026.",
    "Prices for uncoated A4 office paper stay unchanged until December 2026.",
  ],
  [
    "3. Payment",
    "Invoices are payable net 30 days from the delivery date.",
    "Late payment interest is 1% per month.",
    "4. Orders",
    "The minimum order is 20 reams per delivery.",
    "Deliveries arrive on Tuesdays and Fridays.",
  ],
];

const MAINTENANCE_LOG: readonly (readonly string[])[] = [
  [
    "Equipment maintenance log 2026",
    "12 Feb: Konica C3070 drum unit replaced during scheduled service.",
    "3 Mar: guillotine blade sharpened.",
    "14 May: Konica C3070 press down for three days for a fuser unit replacement.",
    "17 May: Konica C3070 back in production after the fuser replacement and calibration.",
  ],
  [
    "2 Jun: wide-format plotter print head cleaned; banding on banners resolved.",
    "9 Jun: laminator rollers replaced.",
    "Next scheduled service for the Konica press: September 2026.",
  ],
];

// ── Word documents ─────────────────────────────────────────────────────────────────────────────────────────

const SAFETY_POLICY: readonly DocxSection[] = [
  {
    heading: "Workshop safety policy",
    paragraphs: [
      "This policy applies to everyone who works in the production area, including temporary staff and visitors who enter the press room. It describes the minimum rules; supervisors may set stricter rules for specific jobs.",
      "Hearing protection is required near the guillotine and the folding machine whenever they are running. Ear defenders hang next to each machine and must be returned after use. Anyone who notices damaged ear defenders reports it to the shift supervisor the same day.",
      "Solvent-based inks and cleaning fluids are stored in the metal cabinet by the back door. The cabinet stays locked outside working hours and the key is kept by the shift supervisor. Rags soaked with solvent go into the red lidded bin, never into general waste.",
      "The guillotine may only be operated by staff who completed the cutting-machine training. The two-hand control must never be bypassed or taped down. The blade is changed only by the service technician or by a trained operator wearing cut-resistant gloves.",
      "Fire extinguishers are checked monthly. The evacuation point is the car park in front of the building. During a fire alarm nobody returns for personal belongings or unfinished jobs.",
      "Spills of ink or toner are cleaned at once with the spill kit under the sink. Toner dust is collected with the special vacuum cleaner, not with compressed air, because fine toner powder can irritate the lungs.",
      "Every accident or near miss is written in the incident book on the same day, even when nobody was hurt. The book is reviewed at the monthly operations meeting.",
      "New staff receive a safety induction on their first day. The induction covers the machines they will use, the location of first aid kits and the evacuation route. Refresher training takes place every twelve months.",
    ],
  },
];

const OPS_MAY: readonly DocxSection[] = [
  { heading: "1. Staffing", paragraphs: ["The night shift is cancelled from 20 May because two press operators resigned."] },
  {
    heading: "2. Equipment",
    paragraphs: ["The Konica press outage in mid-May delayed eleven orders, including the BrightAds catalogue."],
  },
  {
    heading: "3. Customers",
    paragraphs: [
      "Agency BrightAds moved its monthly catalogue job to a competitor after the delay.",
      "Two new restaurant clients ordered menus.",
    ],
  },
  { heading: "4. Marketing", paragraphs: ["The spring flyer campaign brought 14 new walk-in customers."] },
];

const OPS_JUNE: readonly DocxSection[] = [
  { heading: "1. Staffing", paragraphs: ["One press operator was hired and starts on 1 July."] },
  { heading: "2. Suppliers", paragraphs: ["We will compare PaperWorks with a second paper supplier before signing for 2027."] },
  {
    heading: "3. Customers",
    paragraphs: ["Complaints about washed-out colours on flyers rose in June; reprints cost us about two days of press time."],
  },
  { heading: "4. Finance", paragraphs: ["Rent rises by 5% from July according to the landlord."] },
];

const PRICING_MEMO: readonly DocxSection[] = [
  {
    heading: "Pricing memo, June 2026",
    paragraphs: [
      "Banner prices increase by 15% from 1 July because the cost of PVC vinyl rose.",
      "Business card prices stay the same despite the switch to thicker card.",
      "A3 poster prices will be reviewed after the PaperWorks increase on coated stock.",
    ],
  },
];

// Russian: a warehouse report from the shift supervisor.
const WAREHOUSE_RU: readonly DocxSection[] = [
  {
    heading: "Отчёт по складу, июнь 2026",
    paragraphs: [
      "Запасы бумаги формата А4 закончились 3 июня, новая поставка ожидается 10 июня.",
      "Тонер для печатной машины Konica заказан у нового поставщика, потому что прежний поставщик повысил цены.",
      "Рулонный винил для баннеров: остаток на две недели работы.",
    ],
  },
];

// ── Emails ────────────────────────────────────────────────────────────────────────────────────────────────

const EMAILS: Record<string, Uint8Array> = {
  "email-brightads.eml": eml(
    {
      from: '"Lena Park, BrightAds" <lena@brightads.example>',
      to: "orders@inkwell.example",
      subject: "Catalogue print run",
      date: "Wed, 21 May 2026 16:02:00 +0500",
      id: "0521@brightads.example",
    },
    "Hello,\n\nWe are moving the monthly catalogue print run to another printer because of the delays in May.\nWe may come back for smaller jobs.\n\nLena\n",
  ),
  "email-paperworks.eml": eml(
    {
      from: '"PaperWorks Sales" <sales@paperworks.example>',
      to: "orders@inkwell.example",
      subject: "Price change for coated stock",
      date: "Mon, 05 May 2026 10:30:00 +0500",
      id: "0505@paperworks.example",
    },
    "Dear customer,\n\nDue to higher pulp costs, the price of A3 coated stock goes up by 9% from 1 June.\nUncoated office paper prices do not change.\n\nPaperWorks Sales\n",
  ),
  "email-complaint.eml": eml(
    {
      from: '"Cafe Lumen" <hello@cafelumen.example>',
      to: "orders@inkwell.example",
      subject: "Flyers order 2291",
      date: "Tue, 10 Jun 2026 11:45:00 +0500",
      id: "0610@cafelumen.example",
    },
    "Hi,\n\nThe colours on the 500 flyers we picked up yesterday look washed out compared to the proof. We would like a reprint before our event on Saturday.\n\nThanks,\nCafe Lumen\n",
  ),
  "email-landlord.eml": eml(
    {
      from: '"Property office" <office@landlord.example>',
      to: "owner@inkwell.example",
      subject: "Rent from July",
      date: "Fri, 30 May 2026 09:00:00 +0500",
      id: "0530@landlord.example",
    },
    "Dear tenant,\n\nAs agreed in the lease, the monthly rent for the workshop increases by 5% from 1 July 2026.\n\nProperty office\n",
  ),
  "email-ru-client.eml": eml(
    {
      from: '"Ирина, Studio Nova" <irina@studionova.example>',
      to: "orders@inkwell.example",
      subject: "Перенос печати каталога",
      date: "Thu, 12 Jun 2026 14:20:00 +0500",
      id: "0612@studionova.example",
    },
    "Здравствуйте!\n\nПросим перенести печать каталога на июль из-за задержки макета от дизайнера.\nТираж остаётся прежним: 300 экземпляров.\n\nИрина\n",
  ),
};

// ── Text and Markdown ──────────────────────────────────────────────────────────────────────────────────────

export const MARKETING_PLAN = `# Marketing plan 2026

## Online

Instagram ads budget is 400 USD per month from June.
We post finished jobs twice a week with the customer's permission.

## Discounts

Students get a 10% discount from September with a valid student card.
Repeat business customers get free delivery on orders over 150 USD.

## Events

We will run a stand at the city small-business fair in October.
`;

export const DELIVERY_TERMS = `# Delivery terms

Delivery fees by zone:

| Zone | Area | Fee |
| --- | --- | --- |
| A | City centre | 5 USD |
| B | Suburbs | 9 USD |
| C | Region | 18 USD |

Orders over 150 USD are delivered free in zone A.
Deliveries leave the studio at 14:00 every working day.
`;

export const HR_NOTES = `HR notes, May 2026

Two press operators resigned in May; both cited the night shift as the reason.
The vacancy for a press operator was posted on 22 May.
Summer holidays must be booked before 15 June.
`;

// ── Distractors: routine orders and a job log, sharing the vocabulary of the planted passages ───────────────

const CLIENTS = ["Cafe Lumen", "Studio Nova", "BrightAds", "Green Fork", "City Gym", "Hotel Aster", "Dr. Kim Dental", "Book Nook"];
const PRODUCTS = [
  "500 flyers A5 on 170gsm gloss",
  "250 business cards on silk card",
  "a 2 m vinyl banner",
  "40 posters A2",
  "a 24-page catalogue, 300 copies",
  "120 menus, laminated",
  "1000 leaflets A6",
  "60 invitation cards with envelopes",
];
const NOTES = [
  "Proof approved by phone.",
  "Customer will pick up after 16:00.",
  "Deliver to zone A with the next van.",
  "Colours checked against the previous run.",
  "Paid in advance by bank transfer.",
  "Reprint of last month's job with new dates.",
  "Cut with 3 mm bleed as requested.",
  "Rush not needed; standard turnaround.",
];

/** Order confirmations: deterministic (index arithmetic only), dated across April–June 2026. */
function orderEmails(): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  // 30 emails: with the 17 other files the job stays under ingest's 50-file limit.
  for (let i = 0; i < 30; i++) {
    const client = CLIENTS[i % CLIENTS.length] as string;
    const product = PRODUCTS[(i * 3) % PRODUCTS.length] as string;
    const note = NOTES[(i * 5) % NOTES.length] as string;
    const month = ["Apr", "May", "Jun"][i % 3] as string;
    const day = String(1 + ((i * 7) % 28)).padStart(2, "0");
    const n = 3100 + i;
    out[`order-${n}.eml`] = eml(
      {
        from: '"Inkwell orders" <orders@inkwell.example>',
        to: `${client.toLowerCase().replace(/[^a-z]+/g, ".")}@client.example`,
        subject: `Order ${n} confirmed`,
        date: `Mon, ${day} ${month} 2026 10:00:00 +0500`,
        id: `order-${n}@inkwell.example`,
      },
      `Hello ${client},\n\nYour order ${n} for ${product} is confirmed and goes to press this week.\n${note}\n\nInkwell Print Studio\n`,
    );
  }
  return out;
}

/** A job log with one section per job: press, paper and finishing notes that look like the planted facts. */
function jobLog(): Uint8Array {
  const presses = ["Konica C3070", "wide-format plotter", "offset press", "Konica C3070"];
  const sections: DocxSection[] = [];
  for (let i = 0; i < 60; i++) {
    const client = CLIENTS[(i * 3) % CLIENTS.length] as string;
    const product = PRODUCTS[(i * 5) % PRODUCTS.length] as string;
    sections.push({
      heading: `Job ${2200 + i}: ${client}`,
      paragraphs: [
        `Printed ${product} on the ${presses[i % presses.length]}.`,
        `${NOTES[(i * 3) % NOTES.length]} Paper taken from the main store; no waste above the usual 3%.`,
      ],
    });
  }
  return docx(sections);
}

/** Every file of printing-shop-v1, by file name. */
export function printingShopFiles(): Record<string, Uint8Array> {
  const enc = new TextEncoder();
  return {
    "price-list-2026.pdf": textPdf(PRICE_LIST),
    "supplier-contract.pdf": textPdf(SUPPLIER_CONTRACT),
    "maintenance-log.pdf": textPdf(MAINTENANCE_LOG),
    "safety-policy.docx": docx(SAFETY_POLICY),
    "ops-meeting-may.docx": docx(OPS_MAY),
    "ops-meeting-june.docx": docx(OPS_JUNE),
    "pricing-memo.docx": docx(PRICING_MEMO),
    "sklad-otchet.docx": docx(WAREHOUSE_RU),
    ...EMAILS,
    "marketing-plan.md": enc.encode(MARKETING_PLAN),
    "delivery-terms.md": enc.encode(DELIVERY_TERMS),
    "hr-notes.txt": enc.encode(HR_NOTES),
    "job-log-q2.docx": jobLog(),
    ...orderEmails(),
  };
}
