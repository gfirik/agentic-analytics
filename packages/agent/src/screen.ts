// The deterministic injection screen (security spec §3): text that addresses a model, asks to change the
// analysis, or asks to send data somewhere. It runs on every document, email, table text cell and raw web page
// before anything reaches a model, so an extractor that is fooled can't un-flag a source. EN/RU/UZ.
// It errs towards flagging: a flagged source is only excluded from evidence, never from the numbers.

/** Folds compatibility forms, drops invisible characters, unifies apostrophes and spaces. */
export function screenText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\p{Cf}+/gu, "")
    .replace(/[’‘ʻʼ`]/g, "'")
    .replace(/\s+/g, " ");
}

// Bare "model" or "agent" are ordinary business words ("the pricing model should…"); only their AI forms count.
const MODEL = String.raw`(?:ai|a\.i\.|assistant|ai (?:model|agent)|language model|llm|chatbot|gpt|claude|ии|ассистент|нейросет\w*|sun'iy intellekt|assistent)`;
const ASK = String.raw`(?:must|should|need to|please|report|state|say|write|output|tell|recommend|append|send|include|reveal|mention|disregard|ignore|conclude|summari[sz]e)`;

const PATTERNS: readonly RegExp[] = [
  // "ignore / disregard / forget … previous instructions"
  /\b(?:ignore|disregard|override|bypass)\b[^.\n]{0,40}\b(?:instructions?|previous|prior|above|rules|guidelines|prompt)\b/i,
  // "forget" only with instructions/rules: "don't forget to update the POS system" is ordinary text.
  /\bforget\b[^.\n]{0,30}\b(?:instructions?|rules|guidelines|prompt)\b/i,
  /\bsystem prompt\b|\bsystem\s*:\s|\b(?:admin|developer|jailbreak) mode\b|\bnew instructions\b|\byou are now\b/i,
  // Text addressed to a model and asking it to do something.
  new RegExp(String.raw`(?:^|[\s"'(«])${MODEL}s?\b[^.\n]{0,60}\b${ASK}\b`, "iu"),
  new RegExp(String.raw`\b(?:note|message|attention|important|instruction)s?\b[^.\n]{0,20}\b(?:to|for)\b[^.\n]{0,10}${MODEL}\b`, "iu"),
  /\bact as\b[^.\n]{0,40}\b(?:assistant|ai|model|agent|admin)\b/i,
  /\bdo not (?:mention|report|include|disclose)\b[^.\n]{0,60}\b(?:your|the) (?:report|summary|answer|analysis|findings)\b/i,
  // Data exfiltration: a URL carrying a query string, or a request to send something to a URL.
  /https?:\/\/[^\s?]+\?[^\s]*=/i,
  // Unicode-aware boundaries: JavaScript's \b only knows ASCII letters, so it never matches before "отправь".
  /(?<![\p{L}])(?:send|post|submit|append|upload|forward|отправ\p{L}*|пришли\p{L}*|yubor\p{L}*)(?![\p{L}])[^.\n]{0,80}https?:\/\//iu,
  // Russian.
  /игнорир\w*|забудь\w*[^.\n]{0,30}(?:инструкц|правил)|не обращай\w* внимани\w*[^.\n]{0,30}(?:инструкц|правил)/iu,
  /(?:^|[\s"'(«])(?:ии|ассистент\w*|нейросет\w*)(?![\p{L}])[^.\n]{0,50}(?:долж\w*|напиши|сообщи|отправь|укажи|скажи)/iu,
  // Uzbek (Latin and Cyrillic).
  /ko'rsatmalar\w*[^.\n]{0,40}(?:e'tiborsiz|unut)|e'tiborsiz qoldir|кўрсатмалар\w*[^.\n]{0,40}(?:эътиборсиз|унут)/iu,
];

/** True when the text looks like it carries instructions for a model (after normalising it). */
export function screen(text: string): boolean {
  const t = screenText(text);
  return PATTERNS.some((re) => re.test(t));
}
