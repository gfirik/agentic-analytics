// SQL as tagged templates (AGENTS.md §4): interpolated values become `$n` parameters, never text.
// Identifiers (table/column names) can't be parameters, so they go through `ident()`, which only accepts
// names produced by our own normalizers and rejects anything else.
import { StoreError } from "./errors.ts";

export interface Sql {
  readonly text: string;
  readonly params: readonly SqlValue[];
}

export type SqlValue = string | number | boolean | null | bigint;

class Ident {
  constructor(readonly quoted: string) {}
}

class Raw {
  constructor(readonly text: string) {}
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/** A checked SQL identifier: lower snake_case only, double-quoted. */
export function ident(name: string): Ident {
  if (!IDENT.test(name)) throw new StoreError("BAD_IDENTIFIER", `not a safe SQL identifier: ${JSON.stringify(name)}`);
  return new Ident(`"${name}"`);
}

/** A comma-separated list of checked identifiers. */
export function idents(names: readonly string[]): Raw {
  return new Raw(names.map((n) => ident(n).quoted).join(", "));
}

/** A SQL fragment that was itself built with `sql`, so it is safe to splice. */
export function fragment(q: Sql): { readonly sql: Sql } {
  return { sql: q };
}

type Part = SqlValue | Ident | Raw | { readonly sql: Sql };

export function sql(strings: TemplateStringsArray, ...values: Part[]): Sql {
  let text = strings[0] ?? "";
  const params: SqlValue[] = [];
  values.forEach((v, i) => {
    if (v instanceof Ident) text += v.quoted;
    else if (v instanceof Raw) text += v.text;
    else if (typeof v === "object" && v !== null && "sql" in v) {
      // Renumber the fragment's placeholders after ours.
      const offset = params.length;
      text += v.sql.text.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`);
      params.push(...v.sql.params);
    } else {
      params.push(v);
      text += `$${params.length}`;
    }
    text += strings[i + 1] ?? "";
  });
  return { text, params };
}
