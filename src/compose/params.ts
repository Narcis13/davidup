// Param substitution engine — shared by templates (§7), scenes (§8) and
// user-defined behaviors (§6.6). Spec reference: COMPOSITION_PRIMITIVES.md
// §7.4, REPEAT_EXPRESSIONS_DESIGN.md §3, and the §17 risks-table note that
// pinned v0.3 substitution to whole-string placeholders.
//
// Two forms, both inside the familiar `${…}` syntax:
//
//   * Whole-string: the string is exactly one `${…}`. A bare reference
//     (`${params.color}`, `${$.start}`) returns the referenced value
//     unchanged, any JSON type — the v0.3 fast path, bit-identical. Any other
//     expression (`${params.stagger * 2}`) returns its number or string.
//   * Embedded: `"Hello ${params.name}!"` — each `${…}` segment evaluates and
//     is spliced in as text. `$${` escapes a literal `${`.
//
// Only segments that reference `params.` or `$.` are treated as expressions.
// Everything else (`"costs ${price}"`, JS-looking content) passes through
// byte-identical, so content strings authored before v1.1 don't change.
//
// The expression language is tiny and total: number and string literals,
// `params.X` / `$.X` refs, `+ - * / %`, unary minus, parentheses, and the
// functions `min`, `max`, `round`. Inside a `$repeat` body the loop variable
// (`${i}`, or whatever `as` names) is a bare identifier, and `params[expr]`
// looks a param up by a computed name (`params['y' + (i + 1)]` — inside the
// brackets `+` may join numbers onto strings to build the name). No other
// calls, no property access beyond one level, no `eval`. `+` adds numbers or concatenates two strings; mixing
// is an error, as is any non-finite result. Failures throw E_TEMPLATE_EXPR
// with the offending position.

import { MCPToolError } from "../engine/errors.js";

export interface SubstitutionContext {
  /** Resolved params keyed by descriptor name. Looked up via `${params.X}`. */
  params: Record<string, unknown>;
  /**
   * Reserved namespace for context-dependent values addressable as `${$.X}`.
   * Templates expose `start` (the instance's global start time).
   */
  meta?: Record<string, unknown>;
  /**
   * Declared param types (descriptor name → `number` / `string` / `color` /
   * `boolean`). Expressions are checked against these, so
   * `${params.title * 2}` fails naming the declared type.
   */
  paramTypes?: Record<string, string>;
  /**
   * `$repeat` loop variables in scope (`as` name → iteration index),
   * addressable as bare identifiers: `${i}`, `"dot${i + 1}"`.
   */
  locals?: Record<string, number>;
}

/** Matches a whole-string placeholder of the form `${params.X}` or `${$.X}`. */
const PLACEHOLDER_RE = /^\$\{(params|\$)\.([A-Za-z_$][A-Za-z0-9_$]*)\}$/;

/** A `${…}` interior is an expression only if it references params or meta. */
const REFERENCES_RE = /(?:^|[^A-Za-z0-9_$])(?:params|\$)\s*\./;

export const EXPR_MAX_LENGTH = 256;
export const EXPR_MAX_TOKENS = 64;
export const EXPR_MAX_DEPTH = 16;

/**
 * Recursively walk `value` and replace placeholders. Pure: returns a new tree
 * (with new objects/arrays only where a substitution actually occurred is not
 * promised — callers should not rely on identity).
 *
 * Throws `MCPToolError` E_TEMPLATE_PARAM_MISSING if a placeholder names a key
 * not present in the context, E_TEMPLATE_EXPR if an expression is malformed or
 * mistyped.
 */
export function substitute(
  value: unknown,
  ctx: SubstitutionContext,
  path = "",
): unknown {
  if (typeof value === "string") {
    if (!value.includes("${")) return value;
    const m = PLACEHOLDER_RE.exec(value);
    if (m !== null) {
      return lookup(m[1] === "params" ? "params" : "$", m[2] as string, ctx, path);
    }
    return substituteString(value, ctx, path);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => substitute(v, ctx, `${path}[${i}]`));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      out[k] = substitute(value[k], ctx, path === "" ? k : `${path}.${k}`);
    }
    return out;
  }
  return value;
}

/**
 * Evaluate one expression (the interior of a `${…}`, without the braces).
 * A bare reference returns the referenced value as-is; anything else returns
 * a finite number or a string.
 */
export function evaluateExpression(
  source: string,
  ctx: SubstitutionContext,
  path = "",
): unknown {
  return new Evaluator(source, ctx, path).run();
}

// ──────────────── String scanning ────────────────

interface Segment {
  /** Index of the `$` of `${` (or of the escaping `$` for `$${`). */
  start: number;
  /** Index just past the closing `}`. */
  end: number;
  interior: string;
  escaped: boolean;
}

function substituteString(
  value: string,
  ctx: SubstitutionContext,
  path: string,
): unknown {
  const segments = scanSegments(value, ctx);
  if (segments.length === 0) return value;

  const only = segments[0] as Segment;
  if (
    segments.length === 1 &&
    !only.escaped &&
    only.start === 0 &&
    only.end === value.length
  ) {
    return evaluateExpression(only.interior, ctx, path);
  }

  let out = "";
  let cursor = 0;
  for (const seg of segments) {
    out += value.slice(cursor, seg.start);
    if (seg.escaped) {
      out += "${" + seg.interior + "}";
    } else {
      const result = evaluateExpression(seg.interior, ctx, path);
      out += stringifyForInterpolation(result, seg.interior, path);
    }
    cursor = seg.end;
  }
  return out + value.slice(cursor);
}

/**
 * Find `${…}` segments whose interior references params, meta or an in-scope
 * `$repeat` variable. The closing brace is the first `}` outside a quoted
 * string literal; an unterminated `${` is left as literal text.
 */
function scanSegments(value: string, ctx: SubstitutionContext): Segment[] {
  const segments: Segment[] = [];
  const localsRe = localsPattern(ctx);
  let i = 0;
  while (i < value.length) {
    const open = value.indexOf("${", i);
    if (open === -1) break;
    const close = findClose(value, open + 2);
    if (close === -1) break;
    const interior = value.slice(open + 2, close);
    if (
      !REFERENCES_RE.test(interior) &&
      (localsRe === undefined || !localsRe.test(interior))
    ) {
      i = open + 2;
      continue;
    }
    const escaped = open > 0 && value[open - 1] === "$";
    segments.push({
      start: escaped ? open - 1 : open,
      end: close + 1,
      interior,
      escaped,
    });
    i = close + 1;
  }
  return segments;
}

function localsPattern(ctx: SubstitutionContext): RegExp | undefined {
  const names = ctx.locals === undefined ? [] : Object.keys(ctx.locals);
  if (names.length === 0) return undefined;
  const alt = names.map((n) => n.replace(/\$/g, "\\$")).join("|");
  return new RegExp(`(?:^|[^A-Za-z0-9_$.])(?:${alt})(?![A-Za-z0-9_$])`);
}

function findClose(value: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < value.length; i += 1) {
    const ch = value[i];
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "}") {
      return i;
    }
  }
  return -1;
}

function stringifyForInterpolation(v: unknown, interior: string, path: string): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw exprError(
    `cannot interpolate ${describeValue(v)} into a string`,
    interior,
    0,
    path,
  );
}

// ──────────────── Tokenizer ────────────────

type TokenKind = "num" | "str" | "ident" | "punct" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  pos: number;
  num?: number;
  str?: string;
}

const NUMBER_RE = /(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const PUNCT = new Set(["+", "-", "*", "/", "%", "(", ")", ",", ".", "[", "]"]);
const STRING_ESCAPES: Record<string, string> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  n: "\n",
  t: "\t",
};

function tokenize(source: string, path: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (tokens.length >= EXPR_MAX_TOKENS) {
      throw exprError(
        `expression has more than ${EXPR_MAX_TOKENS} tokens`,
        source,
        i,
        path,
      );
    }
    if (ch >= "0" && ch <= "9") {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(source);
      const text = (m as RegExpExecArray)[0];
      tokens.push({ kind: "num", text, pos: i, num: Number(text) });
      i += text.length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let str = "";
      for (;;) {
        if (j >= source.length) {
          throw exprError("unterminated string literal", source, i, path);
        }
        const c = source[j] as string;
        if (c === ch) break;
        if (c === "\\") {
          const esc = STRING_ESCAPES[source[j + 1] ?? ""];
          if (esc === undefined) {
            throw exprError("unknown escape in string literal", source, j, path);
          }
          str += esc;
          j += 2;
          continue;
        }
        str += c;
        j += 1;
      }
      tokens.push({ kind: "str", text: source.slice(i, j + 1), pos: i, str });
      i = j + 1;
      continue;
    }
    IDENT_RE.lastIndex = i;
    const id = IDENT_RE.exec(source);
    if (id !== null) {
      tokens.push({ kind: "ident", text: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    if (PUNCT.has(ch)) {
      tokens.push({ kind: "punct", text: ch, pos: i });
      i += 1;
      continue;
    }
    throw exprError(`unexpected character "${ch}"`, source, i, path);
  }
  tokens.push({ kind: "eof", text: "", pos: source.length });
  return tokens;
}

// ──────────────── Parser + evaluator ────────────────
//
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%') unary)*
//   unary   := '-' unary | primary
//   primary := NUMBER | STRING | ref | LOCAL | FUNC '(' expr (',' expr)* ')' | '(' expr ')'
//   ref     := ('params' | '$') '.' IDENT | 'params' '[' expr ']'
//   LOCAL   := a `$repeat` loop variable in scope
//   FUNC    := 'min' | 'max' | 'round'
//
// Parsing and evaluation happen in one recursive-descent walk: expressions
// are short (≤ 256 chars) and evaluated once per expansion.

/** A computed value plus a label for error messages (`params.title (string)`). */
interface Value {
  v: unknown;
  label: string;
  pos: number;
}

const FUNCTIONS = new Set(["min", "max", "round"]);

class Evaluator {
  private readonly tokens: Token[];
  private index = 0;
  private depth = 0;
  /** > 0 while evaluating a `params[…]` name, where `+` may join a number onto a string. */
  private nameDepth = 0;

  constructor(
    private readonly source: string,
    private readonly ctx: SubstitutionContext,
    private readonly path: string,
  ) {
    if (source.length > EXPR_MAX_LENGTH) {
      throw exprError(
        `expression is longer than ${EXPR_MAX_LENGTH} characters`,
        source,
        EXPR_MAX_LENGTH,
        path,
      );
    }
    this.tokens = tokenize(source, path);
  }

  run(): unknown {
    if (this.peek().kind === "eof") {
      throw this.error("empty expression", 0);
    }
    const first = this.peek();
    const result = this.expr();
    const next = this.peek();
    if (next.kind !== "eof") {
      throw this.error(`unexpected "${next.text}"`, next.pos);
    }
    // Bare reference: any JSON type passes through untouched.
    if (this.tokens.length === 4 && first.kind === "ident") return result.v;
    if (typeof result.v === "number") {
      return this.finite(result.v, result.pos);
    }
    if (typeof result.v === "string") return result.v;
    // A parenthesised bare ref (`(params.flag)`) of a non-number/string type.
    return result.v;
  }

  private expr(): Value {
    let left = this.term();
    for (;;) {
      const t = this.peek();
      if (t.kind !== "punct" || (t.text !== "+" && t.text !== "-")) return left;
      this.index += 1;
      const right = this.term();
      if (
        t.text === "+" &&
        (typeof left.v === "string" || typeof right.v === "string") &&
        (this.nameDepth > 0
          ? isNameFragment(left.v) && isNameFragment(right.v)
          : typeof left.v === "string" && typeof right.v === "string")
      ) {
        left = { v: String(left.v) + String(right.v), label: "string", pos: left.pos };
        continue;
      }
      const a = this.number(left, t.text);
      const b = this.number(right, t.text);
      const v = t.text === "+" ? a + b : a - b;
      left = { v: this.finite(v, t.pos), label: "number", pos: left.pos };
    }
  }

  private term(): Value {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== "punct" || (t.text !== "*" && t.text !== "/" && t.text !== "%")) {
        return left;
      }
      this.index += 1;
      const right = this.unary();
      const a = this.number(left, t.text);
      const b = this.number(right, t.text);
      if ((t.text === "/" || t.text === "%") && b === 0) {
        throw this.error(`${t.text === "/" ? "division" : "modulo"} by zero`, right.pos);
      }
      const v = t.text === "*" ? a * b : t.text === "/" ? a / b : a % b;
      left = { v: this.finite(v, t.pos), label: "number", pos: left.pos };
    }
  }

  private unary(): Value {
    const t = this.peek();
    if (t.kind === "punct" && t.text === "-") {
      this.index += 1;
      this.enter(t.pos);
      const operand = this.unary();
      this.depth -= 1;
      return { v: -this.number(operand, "unary -"), label: "number", pos: t.pos };
    }
    return this.primary();
  }

  private primary(): Value {
    const t = this.next();
    switch (t.kind) {
      case "num":
        return { v: t.num as number, label: "number", pos: t.pos };
      case "str":
        return { v: t.str as string, label: "string", pos: t.pos };
      case "punct":
        if (t.text === "(") {
          this.enter(t.pos);
          const inner = this.expr();
          this.expect(")");
          this.depth -= 1;
          return inner;
        }
        throw this.error(`unexpected "${t.text}"`, t.pos);
      case "ident":
        if (t.text === "params" || t.text === "$") return this.ref(t);
        if (FUNCTIONS.has(t.text)) return this.call(t);
        if (this.ctx.locals !== undefined && hasOwn(this.ctx.locals, t.text)) {
          return { v: this.ctx.locals[t.text], label: `${t.text} (number)`, pos: t.pos };
        }
        throw this.error(
          `unknown name "${t.text}" (use params.X, $.X, min, max, round` +
            (this.ctx.locals !== undefined && Object.keys(this.ctx.locals).length > 0
              ? ` or a $repeat variable: ${Object.keys(this.ctx.locals).join(", ")}`
              : "") +
            ")",
          t.pos,
        );
      case "eof":
      default:
        throw this.error("unexpected end of expression", t.pos);
    }
  }

  private ref(ns: Token): Value {
    let keyName: string;
    const open = this.peek();
    if (ns.text === "params" && open.kind === "punct" && open.text === "[") {
      // Computed lookup: params['bullet' + (i + 1)].
      this.index += 1;
      this.enter(open.pos);
      this.nameDepth += 1;
      const key = this.expr();
      this.nameDepth -= 1;
      this.expect("]");
      this.depth -= 1;
      if (typeof key.v !== "string") {
        throw this.error(`params[…] needs a string name, got ${key.label}`, key.pos);
      }
      keyName = key.v;
    } else {
      this.expect(".");
      const key = this.next();
      if (key.kind !== "ident") {
        throw this.error("expected a name after the dot", key.pos);
      }
      keyName = key.text;
    }
    const after = this.peek();
    if (after.kind === "punct" && (after.text === "." || after.text === "[")) {
      throw this.error("nested property access is not supported", after.pos);
    }
    const nsName = ns.text === "params" ? "params" : "$";
    const v = lookup(nsName, keyName, this.ctx, this.path);
    const declared = nsName === "params" ? this.ctx.paramTypes?.[keyName] : undefined;
    const label = `${ns.text}.${keyName} (${declared ?? describeValue(v)})`;
    return { v, label, pos: ns.pos };
  }

  private call(fn: Token): Value {
    this.expect("(");
    this.enter(fn.pos);
    const args: number[] = [this.number(this.expr(), `${fn.text}()`)];
    while (this.peek().kind === "punct" && this.peek().text === ",") {
      this.index += 1;
      args.push(this.number(this.expr(), `${fn.text}()`));
    }
    this.expect(")");
    this.depth -= 1;
    let v: number;
    if (fn.text === "round") {
      if (args.length !== 1) {
        throw this.error("round() takes exactly one argument", fn.pos);
      }
      v = Math.round(args[0] as number);
    } else {
      v = fn.text === "min" ? Math.min(...args) : Math.max(...args);
    }
    return { v, label: "number", pos: fn.pos };
  }

  private number(value: Value, op: string): number {
    if (typeof value.v === "number") return value.v;
    throw this.error(
      `"${op}" needs numbers, got ${value.label}` +
        (op === "+" && typeof value.v === "string"
          ? " — \"+\" joins two strings but not a string and a number; use \"text ${…}\" interpolation instead"
          : ""),
      value.pos,
    );
  }

  private finite(v: number, pos: number): number {
    if (!Number.isFinite(v)) throw this.error("result is not a finite number", pos);
    return v;
  }

  private enter(pos: number): void {
    this.depth += 1;
    if (this.depth > EXPR_MAX_DEPTH) {
      throw this.error(`expression nests deeper than ${EXPR_MAX_DEPTH} levels`, pos);
    }
  }

  private expect(text: string): void {
    const t = this.next();
    if (t.kind !== "punct" || t.text !== text) {
      throw this.error(
        t.kind === "eof" ? `expected "${text}" before the end` : `expected "${text}", got "${t.text}"`,
        t.pos,
      );
    }
  }

  private peek(): Token {
    return this.tokens[this.index] as Token;
  }

  private next(): Token {
    const t = this.tokens[this.index] as Token;
    if (t.kind !== "eof") this.index += 1;
    return t;
  }

  private error(reason: string, pos: number): MCPToolError {
    return exprError(reason, this.source, pos, this.path);
  }
}

// ──────────────── Shared helpers ────────────────

function lookup(
  ns: "params" | "$",
  key: string,
  ctx: SubstitutionContext,
  path: string,
): unknown {
  if (ns === "params") {
    if (!hasOwn(ctx.params, key)) {
      throw new MCPToolError(
        "E_TEMPLATE_PARAM_MISSING",
        `Unknown param "${key}" referenced at ${path || "<root>"}.`,
      );
    }
    return ctx.params[key];
  }
  const meta = ctx.meta ?? {};
  if (!hasOwn(meta, key)) {
    throw new MCPToolError(
      "E_TEMPLATE_PARAM_MISSING",
      `Unknown $.${key} reference at ${path || "<root>"}.`,
    );
  }
  return meta[key];
}

function exprError(
  reason: string,
  expression: string,
  position: number,
  path: string,
): MCPToolError {
  const at = path || "<root>";
  return new MCPToolError(
    "E_TEMPLATE_EXPR",
    `Bad expression at ${at}, position ${position}: ${reason}.\n` +
      `  \${${expression}}\n` +
      `  ${" ".repeat(position + 2)}^`,
    "Expressions support numbers, 'strings', params.X, params['X'], $.X, " +
      "$repeat variables, + - * / %, parentheses, min(), max() and round(). " +
      "+ joins two strings; all other operators need numbers.",
    { details: { path: at, expression, position } },
  );
}

function isNameFragment(v: unknown): boolean {
  return typeof v === "string" || typeof v === "number";
}

function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function hasOwn(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
