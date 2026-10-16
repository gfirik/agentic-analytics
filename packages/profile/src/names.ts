// Column names → snake_case SQL identifiers, and Cyrillic → Latin transliteration (ingestion spec §6–7).

const CYRILLIC: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  // Uzbek Cyrillic
  ў: "o'",
  қ: "q",
  ғ: "g'",
  ҳ: "h",
};

export function transliterate(s: string): string {
  let out = "";
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const t = CYRILLIC[lower];
    if (t === undefined) out += ch;
    else out += ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1);
  }
  return out;
}

/** "Sales / Revenue" → "sales_revenue", "Количество" → "kolichestvo"; empty → "column". */
export function snakeCase(label: string): string {
  const s = transliterate(label)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = s === "" ? "column" : /^[0-9]/.test(s) ? `c_${s}` : s;
  return safe.slice(0, 60);
}

/** snake_case names made unique within a table, never colliding with the reserved `_row`/`_is_total`/`_period`. */
export function columnNames(labels: readonly string[]): string[] {
  const taken = new Set<string>();
  return labels.map((l) => {
    const base = snakeCase(l);
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
    taken.add(name);
    return name;
  });
}
