// Strict object schemas with an extension escape hatch (v1.1 S23, R-23).
//
// Every object in the composition schema rejects keys it doesn't know, so a
// typo like `opacty` or `cornerradius` is reported (E_SCHEMA, with a "did you
// mean") instead of being silently stripped. Forward compatibility and
// authoring metadata go through two reserved prefixes that are always
// allowed, at any depth:
//   `$…`  — compile-time directives and notes: `$ref`, `$behavior`,
//           `$repeat`, `$template`, `$comment`, …
//   `x-…` — user / tool extensions (`x-author`, `x-editor-hint`, …)
// Extension keys are accepted and dropped from the parsed output, exactly as
// every unknown key was before S23; the input object is left untouched.
//
// Zod has no key-pattern allowlist, so the objects are plain `.strict()` and
// `safeParseWithExtensions` removes extension keys at the paths Zod reports
// as unrecognized, then parses again. Record keys (item ids) are never
// touched: Zod only reports unrecognized keys of objects.

import { z } from "zod";

/** True for keys the strict schema always allows: `$`-directives and `x-` extensions. */
export function isExtensionKey(key: string): boolean {
  return key.startsWith("$") || key.startsWith("x-");
}

/** Plain Levenshtein edit distance. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j]!;
      prev[j] = Math.min(
        above + 1,
        prev[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = above;
    }
  }
  return prev[b.length]!;
}

/**
 * Closest of `candidates` to `key`, case-insensitively, when it is close
 * enough to be a plausible typo (distance ≤ max(2, ⌊len/3⌋)); else undefined.
 */
export function suggestKey(
  key: string,
  candidates: ReadonlyArray<string>,
): string | undefined {
  const lower = key.toLowerCase();
  const limit = Math.max(2, Math.floor(key.length / 3));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = editDistance(lower, candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= limit ? best : undefined;
}

/** `Unknown key "opacty" (did you mean "opacity"?).` — one or several keys. */
export function unknownKeysMessage(
  keys: ReadonlyArray<string>,
  known: ReadonlyArray<string>,
): string {
  const parts = keys.map((key) => {
    const hint = suggestKey(key, known);
    return hint === undefined ? `"${key}"` : `"${key}" (did you mean "${hint}"?)`;
  });
  return `Unknown ${keys.length === 1 ? "key" : "keys"} ${parts.join(", ")}.`;
}

const EXTENSION_HINT = ' Prefix a key with "x-" (or "$") to keep custom data in the JSON.';

/**
 * `z.object(shape).strict()` whose unknown-key issue carries a "did you mean"
 * drawn from the object's own keys. `extensions` (default true) marks a
 * document schema parsed through `safeParseWithExtensions`, and adds the
 * `x-` hint to the message; tool-argument objects pass false.
 */
export function strictObject<T extends z.ZodRawShape>(
  shape: T,
  { extensions = true }: { extensions?: boolean } = {},
) {
  const known = Object.keys(shape);
  return z
    .object(shape, {
      errorMap: (issue, ctx) => {
        if (issue.code !== z.ZodIssueCode.unrecognized_keys) {
          return { message: ctx.defaultError };
        }
        const message = unknownKeysMessage(issue.keys, known);
        return { message: extensions ? message + EXTENSION_HINT : message };
      },
    })
    .strict();
}

/** The non-extension keys of an `unrecognized_keys` issue (empty ⇒ ignorable). */
export function realUnknownKeys(issue: z.ZodIssue): string[] {
  if (issue.code !== z.ZodIssueCode.unrecognized_keys) return [];
  return issue.keys.filter((k) => !isExtensionKey(k));
}

/**
 * `schema.safeParse(input)` where `$…` / `x-…` keys never fail the parse.
 * Other unknown keys still do, with the strictObject "did you mean" message.
 */
export function safeParseWithExtensions<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.SafeParseReturnType<z.input<S>, z.output<S>> {
  const first = schema.safeParse(input);
  if (first.success) return first;
  const extensionIssues = first.error.issues.filter(
    (issue) =>
      issue.code === z.ZodIssueCode.unrecognized_keys &&
      issue.keys.some(isExtensionKey),
  );
  if (extensionIssues.length === 0) return first;

  const copy: unknown = structuredClone(input);
  for (const issue of extensionIssues) {
    if (issue.code !== z.ZodIssueCode.unrecognized_keys) continue;
    let node: unknown = copy;
    for (const segment of issue.path) {
      node = (node as Record<string | number, unknown> | undefined)?.[segment];
    }
    if (typeof node !== "object" || node === null) continue;
    for (const key of issue.keys) {
      if (isExtensionKey(key)) delete (node as Record<string, unknown>)[key];
    }
  }
  return schema.safeParse(copy);
}
