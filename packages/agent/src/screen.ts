// The deterministic injection screen (security spec §3): text that addresses a model, asks to change the
// analysis, or asks to send data somewhere. It runs on every document, email, table text cell, column label and
// web page (readable and hidden text) before anything reaches a model, so an extractor that is fooled can't
// un-flag a source. EN/RU/UZ. It must not flag ordinary business text: footers with tracking links, "operating
// system: Windows", "our assistant should send the invoice" — those are covered by negative tests.

/** Latin look-alikes from Cyrillic and Greek, folded so "Ignоre" (Cyrillic о) reads as "Ignore". */
const SKELETON: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ο: "o",
  α: "a",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ρ: "p",
  τ: "t",
  υ: "u",
};

/** Folds compatibility forms, drops invisible characters and combining marks, unifies apostrophes and spaces. */
export function screenText(s: string): string {
  return (
    s
      .normalize("NFKC")
      .replace(/\p{Cf}+/gu, "")
      // Accents on Latin letters ("Iǵnore") go; Cyrillic й/ё keep theirs, they are different letters.
      .normalize("NFKD")
      .replace(/(\p{Script=Latin})\p{Mn}+/gu, "$1")
      .normalize("NFC")
      .replace(/[’‘ʻʼ`]/g, "'")
      .replace(/[ \t ]+/g, " ")
  );
}

/** Mixed-script words only: a Cyrillic word stays Cyrillic, "Ignоre" becomes "Ignore". */
function skeleton(s: string): string {
  return s.replace(/\p{L}+/gu, (w) =>
    /[a-z]/i.test(w) && /[^\p{Script=Latin}]/u.test(w) ? [...w].map((c) => SKELETON[c.toLowerCase()] ?? c).join("") : w,
  );
}

/** "I g n o r e" → "Ignore": runs of single letters separated by single spaces are joined. */
function despace(s: string): string {
  return s.replace(/(?<![\p{L}])(?:\p{L} ){3,}\p{L}(?![\p{L}])/gu, (m) => m.replace(/ /g, ""));
}

// An AI addressed by name. Bare "assistant", "AI", "model" or "agent" are ordinary words; only clear AI forms,
// or a vocative ("Assistant: …", "AI, …"), count.
const AI = `(?:ai (?:assistant|model|agent|system)s?|virtual assistant|language[- ]models?|llms?|chatbots?|gpt|claude|artificial intelligence)`;
const ASK = `(?:must|should|need to|please|report|state|say|write|output|tell|recommend|append|send|include|reveal|mention|disregard|ignore|conclude|summari[sz]e|describe|respond)`;
// Verbs that move data out. Confirming, logging in or paying at a link is ordinary email; it counts only when the
// link's query carries a placeholder for data ("?d=REVENUE", "?x={customers}") rather than an order id.
const SEND = String.raw`(?:send|submit|post|upload|append|forward|отправ\p{L}*|пришли\p{L}*|yubor\p{L}*)`;
// Case-folded by hand: the query placeholder check needs a case-sensitive pattern.
const VISIT = String.raw`(?:[Vv]isit|[Oo]pen|[Cc]onfirm|[Vv]erify|[Ll]og in|[Ss]ign in|[Пп]одтверд\p{L}*|[Пп]ерейд\p{L}*|[Tt]asdiql\p{L}*)`;
const DATA_QUERY = String.raw`https?:\/\/[^\s?]+\?\S*(?:=(?:[A-Z_]{3,}|\{[^}\s]+\}|\[[^\]\s]+\])(?![a-z])|[?&=](?:data|payload|revenue|sales|customers?|clients?|findings|report|summary|list)(?![a-z]))`;

const PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|override|bypass)\b[^.\n]{0,40}\b(?:instructions?|previous|prior|above|earlier|rules|guidelines|prompt)\b/i,
  /\bdisregard everything\b/i,
  /\bforget\b[^.\n]{0,30}\b(?:instructions?|rules|guidelines|prompt)\b/i,
  // "system:" only where a message would start (a line start or after a quote), not "Operating system: Windows".
  /(?:^|\n|["'«])\s*system\s*:/i,
  /\bsystem prompt\b|\b(?:admin|developer|jailbreak) mode\b|\bnew instructions\b|\byou are now\b|\bfrom now on\b[^.\n]{0,40}\b(?:respond|reply|answer|say|state|report)\b/i,
  new RegExp(String.raw`\b${AI}\b[^.\n]{0,60}\b${ASK}\b`, "iu"),
  new RegExp(
    String.raw`\b(?:note|message|attention|important|instruction)s?\b[^.\n]{0,20}\b(?:to|for)\b[^.\n]{0,10}(?:the )?(?:${AI}|ai|assistant)\b`,
    "iu",
  ),
  new RegExp(String.raw`\b${AI}\s+readers?\b|(?:^|\n|[.!?]\s)\s*(?:ai|assistant|bot)\s*[,:][^.\n]{0,40}\b${ASK}\b`, "iu"),
  /\bact as\b[^.\n]{0,40}\b(?:assistant|ai|model|agent|admin)\b/i,
  /\bdo not (?:mention|report|include|disclose)\b[^.\n]{0,60}\b(?:your|the) (?:report|summary|answer|analysis|findings)\b/i,
  // Data exfiltration: sending or confirming something at a URL, or a spreadsheet formula that calls one.
  new RegExp(
    String.raw`(?<![\p{L}])${SEND}(?![\p{L}])[^\n]{0,80}https?:\/\/|https?:\/\/[^\s?]+\?[^\s]*=[^\n]{0,60}(?<![\p{L}])${SEND}(?![\p{L}])|https?:\/\/\S+[^\n]{0,30}(?<![\p{L}])${SEND}(?![\p{L}])`,
    "iu",
  ),
  new RegExp(
    String.raw`(?<![\p{L}])${VISIT}(?![\p{L}])[^\n]{0,80}${DATA_QUERY}|${DATA_QUERY}[^\n]{0,60}(?<![\p{L}])${VISIT}(?![\p{L}])`,
    "u",
  ),
  /=\s*(?:hyperlink|image|webservice|importxml|importdata|importhtml)\s*\(\s*"https?:\/\//i,
  // Russian.
  /игнорир\p{L}*[^.\n]{0,30}(?:инструкц|правил|указани)|забуд\p{L}*[^.\n]{0,30}(?:инструкц|правил|указани)|не обращай\p{L}* внимани\p{L}*[^.\n]{0,30}(?:инструкц|правил)/iu,
  /(?<![\p{L}])(?:ии|нейросет\p{L}*|искусственн\p{L}* интеллект\p{L}*)(?![\p{L}])[^.\n]{0,50}(?:долж\p{L}*|напиши|сообщи|отправь|укажи|скажи)/iu,
  /(?:^|\n|[.!?]\s)\s*(?:ассистент|бот)\s*[,:]/iu,
  // Uzbek (Latin and Cyrillic).
  /ko'rsatmalar\p{L}*[^.\n]{0,40}(?:e'tiborsiz|unut)|e'tiborsiz qoldir|кўрсатмалар\p{L}*[^.\n]{0,40}(?:эътиборсиз|унут)/iu,
];

/** True when the text looks like it carries instructions for a model (after normalising it). */
export function screen(text: string): boolean {
  const t = screenText(text);
  const s = skeleton(t);
  return [t, s, despace(s)].some((v) => PATTERNS.some((re) => re.test(v)));
}
