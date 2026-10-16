// The metric expression and filter language (docs/specs/metric-layer.md §1–2). Model-proposed text is parsed
// into a typed AST and compiled with checked identifiers and parameters, so nothing a model writes ever reaches
// SQL as text (AGENTS.md §2.6, §4).

export class MetricLangError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricLangError";
  }
}

type Token =
  | { readonly t: "ident"; readonly v: string }
  | { readonly t: "number"; readonly v: number }
  | { readonly t: "string"; readonly v: string }
  | { readonly t: "op"; readonly v: string }
  | { readonly t: "kw"; readonly v: "AND" | "OR" | "NOT" | "IN" | "IS" | "NULL" | "TRUE" | "FALSE" };

const KEYWORDS = new Set(["AND", "OR", "NOT", "IN", "IS", "NULL", "TRUE", "FALSE"]);

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? "";
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j] ?? "")) j++;
      const word = src.slice(i, j);
      const upper = word.toUpperCase();
      if (KEYWORDS.has(upper)) out.push({ t: "kw", v: upper as Extract<Token, { t: "kw" }>["v"] });
      else if (/^[a-z_][a-z0-9_]*$/.test(word)) out.push({ t: "ident", v: word });
      else throw new MetricLangError(`identifier "${word}" must be lower snake_case`);
      i = j;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new MetricLangError(`bad number at "${src.slice(i, i + 10)}"`);
      out.push({ t: "number", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let s = "";
      for (;;) {
        if (j >= src.length) throw new MetricLangError("unterminated string literal");
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'";
            j += 2;
            continue;
          }
          break;
        }
        s += src[j];
        j++;
      }
      out.push({ t: "string", v: s });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<>", "!=", "<=", ">="].includes(two)) {
      out.push({ t: "op", v: two === "!=" ? "<>" : two });
      i += 2;
      continue;
    }
    if ("=<>+-*/(),".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw new MetricLangError(`unexpected character "${ch}"`);
  }
  return out;
}

export type Literal = string | number | boolean;

export type Expr =
  | { readonly k: "col"; readonly name: string }
  | { readonly k: "num"; readonly value: number }
  | { readonly k: "neg"; readonly arg: Expr }
  | { readonly k: "bin"; readonly op: "+" | "-" | "*" | "/"; readonly left: Expr; readonly right: Expr }
  | { readonly k: "call"; readonly fn: "abs" | "coalesce"; readonly args: readonly Expr[] };

export type Operand = { readonly k: "col"; readonly name: string } | { readonly k: "lit"; readonly value: Literal };

export type Filter =
  | { readonly k: "cmp"; readonly op: "=" | "<>" | "<" | "<=" | ">" | ">="; readonly left: Operand; readonly right: Operand }
  | { readonly k: "in"; readonly col: string; readonly values: readonly Literal[]; readonly negated: boolean }
  | { readonly k: "null"; readonly col: string; readonly negated: boolean }
  | { readonly k: "and" | "or"; readonly left: Filter; readonly right: Filter }
  | { readonly k: "not"; readonly arg: Filter };

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  done(): boolean {
    return this.i >= this.tokens.length;
  }
  private peek(): Token | undefined {
    return this.tokens[this.i];
  }
  private next(): Token {
    const t = this.tokens[this.i++];
    if (!t) throw new MetricLangError("unexpected end of input");
    return t;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.t === "op" && t.v === v;
  }
  private isKw(v: string): boolean {
    const t = this.peek();
    return t?.t === "kw" && t.v === v;
  }
  private expectOp(v: string): void {
    const t = this.next();
    if (t.t !== "op" || t.v !== v) throw new MetricLangError(`expected "${v}"`);
  }

  expr(): Expr {
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.next() as { v: "+" | "-" }).v;
      left = { k: "bin", op, left, right: this.term() };
    }
    return left;
  }
  private term(): Expr {
    let left = this.factor();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.next() as { v: "*" | "/" }).v;
      left = { k: "bin", op, left, right: this.factor() };
    }
    return left;
  }
  private factor(): Expr {
    const t = this.next();
    if (t.t === "number") return { k: "num", value: t.v };
    if (t.t === "op" && t.v === "-") return { k: "neg", arg: this.factor() };
    if (t.t === "op" && t.v === "(") {
      const e = this.expr();
      this.expectOp(")");
      return e;
    }
    if (t.t === "ident") {
      if (this.isOp("(")) {
        if (t.v !== "abs" && t.v !== "coalesce") throw new MetricLangError(`function "${t.v}" is not allowed (only abs, coalesce)`);
        this.next();
        const args = [this.expr()];
        while (this.isOp(",")) {
          this.next();
          args.push(this.expr());
        }
        this.expectOp(")");
        if (t.v === "abs" && args.length !== 1) throw new MetricLangError("abs takes one argument");
        return { k: "call", fn: t.v, args };
      }
      return { k: "col", name: t.v };
    }
    throw new MetricLangError(`unexpected "${String(t.v)}" in expression`);
  }

  filter(): Filter {
    let left = this.and();
    while (this.isKw("OR")) {
      this.next();
      left = { k: "or", left, right: this.and() };
    }
    return left;
  }
  private and(): Filter {
    let left = this.not();
    while (this.isKw("AND")) {
      this.next();
      left = { k: "and", left, right: this.not() };
    }
    return left;
  }
  private not(): Filter {
    if (this.isKw("NOT")) {
      this.next();
      return { k: "not", arg: this.not() };
    }
    if (this.isOp("(")) {
      this.next();
      const f = this.filter();
      this.expectOp(")");
      return f;
    }
    return this.predicate();
  }
  private literal(): Literal {
    const t = this.next();
    if (t.t === "string" || t.t === "number") return t.v;
    if (t.t === "kw" && (t.v === "TRUE" || t.v === "FALSE")) return t.v === "TRUE";
    if (t.t === "op" && t.v === "-") {
      const n = this.next();
      if (n.t === "number") return -n.v;
    }
    throw new MetricLangError("expected a literal (quoted text, number, true or false)");
  }
  private operand(): Operand {
    const t = this.peek();
    if (t?.t === "ident") {
      this.next();
      return { k: "col", name: t.v };
    }
    return { k: "lit", value: this.literal() };
  }
  private predicate(): Filter {
    const left = this.operand();
    if (this.isKw("IS")) {
      this.next();
      const negated = this.isKw("NOT");
      if (negated) this.next();
      if (!this.isKw("NULL")) throw new MetricLangError("expected NULL after IS");
      this.next();
      if (left.k !== "col") throw new MetricLangError("IS NULL needs a column");
      return { k: "null", col: left.name, negated };
    }
    const negatedIn = this.isKw("NOT");
    if (negatedIn) this.next();
    if (this.isKw("IN")) {
      this.next();
      if (left.k !== "col") throw new MetricLangError("IN needs a column on the left");
      this.expectOp("(");
      const values = [this.literal()];
      while (this.isOp(",")) {
        this.next();
        values.push(this.literal());
      }
      this.expectOp(")");
      return { k: "in", col: left.name, values, negated: negatedIn };
    }
    if (negatedIn) throw new MetricLangError("expected IN after NOT");
    const t = this.next();
    if (t.t !== "op" || !["=", "<>", "<", "<=", ">", ">="].includes(t.v))
      throw new MetricLangError("expected a comparison (=, <>, <, <=, >, >=, IN, IS NULL)");
    const right = this.operand();
    if (left.k !== "col" && right.k !== "col") throw new MetricLangError("a comparison needs a column");
    return { k: "cmp", op: t.v as "=" | "<>" | "<" | "<=" | ">" | ">=", left, right };
  }
}

export function parseExpression(src: string): Expr {
  const p = new Parser(tokenize(src));
  const e = p.expr();
  if (!p.done()) throw new MetricLangError(`unexpected text after the expression in "${src}"`);
  return e;
}

export function parseFilter(src: string): Filter {
  const p = new Parser(tokenize(src));
  const f = p.filter();
  if (!p.done()) throw new MetricLangError(`unexpected text after the filter in "${src}"`);
  return f;
}

export function exprColumns(e: Expr): string[] {
  switch (e.k) {
    case "col":
      return [e.name];
    case "num":
      return [];
    case "neg":
      return exprColumns(e.arg);
    case "bin":
      return [...exprColumns(e.left), ...exprColumns(e.right)];
    case "call":
      return e.args.flatMap(exprColumns);
  }
}

export function filterColumns(f: Filter): string[] {
  switch (f.k) {
    case "cmp":
      return [f.left, f.right].flatMap((o) => (o.k === "col" ? [o.name] : []));
    case "in":
    case "null":
      return [f.col];
    case "and":
    case "or":
      return [...filterColumns(f.left), ...filterColumns(f.right)];
    case "not":
      return filterColumns(f.arg);
  }
}

/** Compiles to SQL text with `$n` parameters. `col` maps a column name to its quoted identifier. */
export interface SqlBuilder {
  readonly params: (string | number | boolean)[];
  param(v: string | number | boolean): string;
}

export function builder(start: readonly (string | number | boolean)[] = []): SqlBuilder {
  const params = [...start];
  return {
    params,
    param(v) {
      params.push(v);
      return `$${params.length}`;
    },
  };
}

export function compileExpr(e: Expr, b: SqlBuilder, col: (name: string) => string): string {
  switch (e.k) {
    case "col":
      return col(e.name);
    case "num":
      return b.param(e.value);
    case "neg":
      return `(-${compileExpr(e.arg, b, col)})`;
    case "bin":
      // Division in a metric expression is guarded like ratio denominators: x / 0 is NULL, never an error.
      return e.op === "/"
        ? `(${compileExpr(e.left, b, col)} / NULLIF(${compileExpr(e.right, b, col)}, 0))`
        : `(${compileExpr(e.left, b, col)} ${e.op} ${compileExpr(e.right, b, col)})`;
    case "call":
      return `${e.fn}(${e.args.map((a) => compileExpr(a, b, col)).join(", ")})`;
  }
}

export function compileFilter(f: Filter, b: SqlBuilder, col: (name: string) => string): string {
  const operand = (o: Operand) => (o.k === "col" ? col(o.name) : b.param(o.value));
  switch (f.k) {
    case "cmp":
      return `(${operand(f.left)} ${f.op} ${operand(f.right)})`;
    case "in":
      return `(${col(f.col)} ${f.negated ? "NOT IN" : "IN"} (${f.values.map((v) => b.param(v)).join(", ")}))`;
    case "null":
      return `(${col(f.col)} IS ${f.negated ? "NOT NULL" : "NULL"})`;
    case "and":
    case "or":
      return `(${compileFilter(f.left, b, col)} ${f.k.toUpperCase()} ${compileFilter(f.right, b, col)})`;
    case "not":
      return `(NOT ${compileFilter(f.arg, b, col)})`;
  }
}

const OP_WORDS: Record<string, string> = {
  "=": "is",
  "<>": "is not",
  "<": "is below",
  "<=": "is at most",
  ">": "is above",
  ">=": "is at least",
};

/** Plain-language rendering for the confirmation step (spec §3): "status is not refunded". */
export function describeFilter(f: Filter): string {
  const operand = (o: Operand) => (o.k === "col" ? o.name : String(o.value));
  switch (f.k) {
    case "cmp":
      return `${operand(f.left)} ${OP_WORDS[f.op] ?? f.op} ${operand(f.right)}`;
    case "in":
      return `${f.col} is ${f.negated ? "not " : ""}one of ${f.values.join(", ")}`;
    case "null":
      return `${f.col} is ${f.negated ? "filled in" : "empty"}`;
    case "and":
    case "or":
      return `${describeFilter(f.left)} ${f.k} ${describeFilter(f.right)}`;
    case "not":
      return `not (${describeFilter(f.arg)})`;
  }
}

export function describeExpr(e: Expr): string {
  switch (e.k) {
    case "col":
      return e.name;
    case "num":
      return String(e.value);
    case "neg":
      return `−${describeExpr(e.arg)}`;
    case "bin":
      return `${describeExpr(e.left)} ${e.op === "*" ? "×" : e.op === "/" ? "÷" : e.op} ${describeExpr(e.right)}`;
    case "call":
      return `${e.fn}(${e.args.map(describeExpr).join(", ")})`;
  }
}
