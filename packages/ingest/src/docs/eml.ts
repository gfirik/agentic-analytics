// EML via mailparser: headers + body text; attachments go back through intake (spec §4).
import { simpleParser } from "mailparser";
import { IngestError } from "../errors.ts";

export interface ParsedEmail {
  readonly from?: string;
  readonly to?: string;
  readonly date?: string;
  readonly subject?: string;
  readonly body: string;
  readonly attachments: { readonly name: string; readonly bytes: Uint8Array }[];
}

export async function parseEmail(bytes: Uint8Array): Promise<ParsedEmail> {
  try {
    const mail = await simpleParser(Buffer.from(bytes));
    const to = addresses(mail.to);
    const from = addresses(mail.from);
    const html = typeof mail.html === "string" ? mail.html.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ") : "";
    return {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(mail.date ? { date: mail.date.toISOString() } : {}),
      ...(mail.subject ? { subject: mail.subject } : {}),
      body: mail.text ?? html,
      attachments: mail.attachments.map((a, i) => ({ name: a.filename ?? `attachment-${i + 1}`, bytes: new Uint8Array(a.content) })),
    };
  } catch (err) {
    throw new IngestError("UNREADABLE", `the email could not be read: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

type AddressField = { value: { name?: string | undefined; address?: string | undefined }[] };

/** "Name <address>" without the quoting mailparser adds, comma-separated. */
function addresses(field: AddressField | AddressField[] | undefined): string | undefined {
  if (!field) return undefined;
  const list = (Array.isArray(field) ? field : [field]).flatMap((f) => f.value);
  const text = list
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : (a.address ?? "")))
    .filter(Boolean)
    .join(", ");
  return text || undefined;
}
