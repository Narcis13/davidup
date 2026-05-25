// Resolves RFC-6901 JSON Pointers to 1-based line numbers inside a JSON text.
//
// The step-17 reveal-in-source drawer takes the `jsonPointer` carried on a
// SourceLocation and needs to highlight the line where the value at that
// pointer lives inside the authored composition.json text. Doing that
// correctly requires a real tokenizer — `composition.json` is user-formatted
// (variable indent, optional `$comment` blocks, newlines inside strings,
// arrays of objects on one line, etc.), so a regex-over-the-text shortcut
// would mis-locate keys whose names happen to appear inside string values.
//
// This module ships a tiny streaming JSON parser that records the start line
// of every value (the spot the drawer wants to highlight). It tolerates
// trailing whitespace / EOF, and silently bails out on malformed JSON by
// returning an empty map — the drawer then renders text but does no
// highlighting, which is strictly better than throwing.

export interface PointerLineIndex {
  /** Map of RFC-6901 pointer → 1-based line number. */
  lines: Map<string, number>
  /** Total number of lines in the parsed text (>= 1). */
  totalLines: number
}

/**
 * Walk `text` as JSON and record, for every pointer, the 1-based line on
 * which that pointer's value (or its `"key":` for object members) begins.
 *
 * The pointer for the document root is the empty string `""`. Object members
 * are keyed `${parent}/${encoded-token}` per RFC-6901; array elements use
 * decimal indices.
 *
 * `text` is consumed character-by-character — this keeps the implementation
 * dependency-free and easy to audit. Performance is fine for the typical
 * editor composition (a few KB to tens of KB).
 */
export function indexJsonPointerLines(text: string): PointerLineIndex {
  const lines = new Map<string, number>()
  let totalLines = 1
  let pos = 0
  let line = 1

  function peek(): string {
    return pos < text.length ? text[pos] : ''
  }

  function advance(): string {
    const c = text[pos]
    pos += 1
    if (c === '\n') {
      line += 1
      if (line > totalLines) totalLines = line
    }
    return c
  }

  function skipWhitespace(): void {
    while (pos < text.length) {
      const c = text[pos]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        advance()
      } else {
        break
      }
    }
  }

  function parseString(): string {
    // Caller has already validated peek() === '"'. Consume the JSON string,
    // unescaping just enough to recover the key text (we only ever care about
    // object keys, but accept any string value too — values are discarded).
    if (advance() !== '"') throw new Error('expected "')
    let out = ''
    while (pos < text.length) {
      const c = advance()
      if (c === '"') return out
      if (c === '\\') {
        const n = advance()
        switch (n) {
          case '"':
            out += '"'
            break
          case '\\':
            out += '\\'
            break
          case '/':
            out += '/'
            break
          case 'b':
            out += '\b'
            break
          case 'f':
            out += '\f'
            break
          case 'n':
            out += '\n'
            break
          case 'r':
            out += '\r'
            break
          case 't':
            out += '\t'
            break
          case 'u': {
            const hex = text.slice(pos, pos + 4)
            for (let i = 0; i < 4; i += 1) advance()
            out += String.fromCharCode(parseInt(hex, 16))
            break
          }
          default:
            out += n
            break
        }
      } else {
        out += c
      }
    }
    throw new Error('unterminated string')
  }

  function parseValue(pointer: string): void {
    skipWhitespace()
    // Record the line where this value's first non-whitespace token starts.
    // For object members, the caller has already recorded the line where the
    // `"key":` appeared, but we'll happily overwrite with the same value.
    if (!lines.has(pointer)) lines.set(pointer, line)
    else lines.set(pointer, line)
    const c = peek()
    if (c === '"') {
      parseString()
      return
    }
    if (c === '{') {
      parseObject(pointer)
      return
    }
    if (c === '[') {
      parseArray(pointer)
      return
    }
    parseLiteral()
  }

  function parseLiteral(): void {
    // true / false / null / number — read until a structural terminator.
    while (pos < text.length) {
      const c = text[pos]
      if (
        c === ',' ||
        c === '}' ||
        c === ']' ||
        c === ' ' ||
        c === '\t' ||
        c === '\r' ||
        c === '\n'
      ) {
        return
      }
      advance()
    }
  }

  function parseObject(pointer: string): void {
    advance() // consume '{'
    skipWhitespace()
    if (peek() === '}') {
      advance()
      return
    }
    while (pos < text.length) {
      skipWhitespace()
      const keyLine = line
      const key = parseString()
      const childPtr = `${pointer}/${encodePtrToken(key)}`
      lines.set(childPtr, keyLine)
      skipWhitespace()
      if (advance() !== ':') throw new Error('expected ":"')
      parseValue(childPtr)
      skipWhitespace()
      const next = peek()
      if (next === ',') {
        advance()
        continue
      }
      if (next === '}') {
        advance()
        return
      }
      throw new Error('expected "," or "}"')
    }
    throw new Error('unterminated object')
  }

  function parseArray(pointer: string): void {
    advance() // consume '['
    skipWhitespace()
    if (peek() === ']') {
      advance()
      return
    }
    let index = 0
    while (pos < text.length) {
      skipWhitespace()
      const childPtr = `${pointer}/${index}`
      // Record the line at the first non-whitespace token of the element.
      lines.set(childPtr, line)
      parseValue(childPtr)
      skipWhitespace()
      const next = peek()
      if (next === ',') {
        advance()
        index += 1
        continue
      }
      if (next === ']') {
        advance()
        return
      }
      throw new Error('expected "," or "]"')
    }
    throw new Error('unterminated array')
  }

  // Pre-scan total lines so callers can size the gutter even if parsing fails.
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') totalLines += 1
  }

  try {
    parseValue('')
  } catch {
    // Malformed JSON — return whatever we managed to record. The drawer can
    // still render the raw text; just nothing gets highlighted.
  }

  return { lines, totalLines: Math.max(totalLines, 1) }
}

/** RFC 6901 pointer token encoder (mirrors `encodePtrToken` in src/compose). */
export function encodePtrToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * Build the jsonPointer that should be highlighted for the current selection.
 * Prefers the source-map pointer captured during stage hit-testing (which can
 * point at e.g. `/scenes/intro` for items emitted by a scene instance); falls
 * back to `/items/<encoded-id>` so Inspector-driven selections still resolve.
 */
export function pointerForSelection(opts: {
  selectedItemId: string | null
  pickSourceFile?: string | null
  pickSourceJsonPointer?: string | null
  /** Path of the authored file currently displayed in the drawer. */
  displayedFile?: string | null
}): string | null {
  const { selectedItemId, pickSourceFile, pickSourceJsonPointer, displayedFile } = opts
  if (
    pickSourceJsonPointer &&
    (!displayedFile || !pickSourceFile || pickSourceFile === displayedFile)
  ) {
    return pickSourceJsonPointer
  }
  if (selectedItemId !== null) {
    return `/items/${encodePtrToken(selectedItemId)}`
  }
  return null
}
