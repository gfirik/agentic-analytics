// V6's lexicon (agent-and-verifier §7): causal wording in EN/RU/UZ and the correlational rewrites that replace it.

const CAUSAL: readonly [RegExp, string][] = [
  [/\bwas caused by\b/gi, "coincided with"],
  [/\bwere caused by\b/gi, "coincided with"],
  [/\bcaused by\b/gi, "coinciding with"],
  [/\bcaused\b/gi, "coincided with"],
  [/\bcauses\b/gi, "coincides with"],
  [/\bas a result of\b/gi, "alongside"],
  [/\bresulted in\b/gi, "was followed by"],
  [/\bdue to\b/gi, "alongside"],
  [/\bbecause of\b/gi, "around the time of"],
  [/\bled to\b/gi, "was followed by"],
  [/\bleads to\b/gi, "is followed by"],
  [/\bstemmed from\b/gi, "followed"],
  [/\bstems from\b/gi, "follows"],
  [/\b(?:was|were|is|are) driven by\b/gi, "moved with"],
  [/\bdriven by\b/gi, "alongside"],
  [/\bdrove\b/gi, "coincided with"],
  [/\bdrives\b/gi, "coincides with"],
  [/\btriggered\b/gi, "preceded"],
  [/\btriggers\b/gi, "precedes"],
  [/\bbecause\b/gi, "around the time"],
  [/из-за/gi, "одновременно с"],
  [/благодаря/gi, "одновременно с"],
  [/стал[оаи]? причиной/gi, "совпало с"],
  [/повлекл[оаи]?/gi, "совпало с"],
  [/привел[оаи]? к/gi, "совпало с"],
  [/вызван[оаы]?/gi, "совпало с"],
  [/по причине/gi, "одновременно с"],
  [/в результате/gi, "одновременно с"],
  [/\bsababli\b/gi, "bilan bir vaqtda"],
  [/\btufayli\b/gi, "bilan bir vaqtda"],
  [/\bolib keldi\b/gi, "bilan bir vaqtga to'g'ri keldi"],
  [/\bsabab bo'ldi\b/gi, "bilan bir vaqtda bo'ldi"],
  [/\bnatijasida\b/gi, "bilan bir vaqtda"],
];

export function isCausal(text: string): boolean {
  return CAUSAL.some(([re]) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

export function rewriteCorrelational(text: string): string {
  let t = text;
  for (const [re, to] of CAUSAL) t = t.replace(re, to);
  return t;
}
