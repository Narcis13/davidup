// v1.1 S29 — parse the Source drawer's edited text before it becomes a
// `replace_composition` command. Only JSON syntax and the top-level shape are
// checked here; the engine tool runs the real validator and its issues come
// back through the command bus like any other rejected command.

export type SourceDraftResult =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; message: string; line: number | null }

export function parseSourceDraft(text: string): SourceDraftResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    const message = (err as Error).message
    return { ok: false, message, line: errorLine(text, message) }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: 'The document must be a JSON object.', line: 1 }
  }
  return { ok: true, json: parsed as Record<string, unknown> }
}

// Firefox/Safari name a line or position; current V8 often names neither
// ("Unexpected token ','"), so fall back to locating the error ourselves.
function errorLine(text: string, message: string): number | null {
  const lineMatch = /line (\d+)/.exec(message)
  if (lineMatch) return Number(lineMatch[1])
  const posMatch = /position (\d+)/.exec(message)
  const pos = posMatch ? Number(posMatch[1]) : firstSyntaxErrorOffset(text)
  if (pos === null) return null
  return text.slice(0, Math.min(pos, text.length)).split('\n').length
}

/**
 * Offset of the first JSON syntax error in `text` (null if none is found).
 * A minimal recursive-descent scanner — only run after JSON.parse has
 * already failed, to point the drawer at a line.
 */
export function firstSyntaxErrorOffset(text: string): number | null {
  let i = 0
  const ws = (): void => {
    while (i < text.length && /\s/.test(text[i]!)) i++
  }
  const fail = (): never => {
    throw i
  }
  const expect = (ch: string): void => {
    if (text[i] !== ch) fail()
    i++
  }
  const string = (): void => {
    expect('"')
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\n') fail()
      i += text[i] === '\\' ? 2 : 1
    }
    expect('"')
  }
  const value = (): void => {
    ws()
    const ch = text[i]
    if (ch === '{') {
      i++
      ws()
      if (text[i] === '}') {
        i++
        return
      }
      for (;;) {
        ws()
        string()
        ws()
        expect(':')
        value()
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        expect('}')
        return
      }
    }
    if (ch === '[') {
      i++
      ws()
      if (text[i] === ']') {
        i++
        return
      }
      for (;;) {
        value()
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        expect(']')
        return
      }
    }
    if (ch === '"') return string()
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i))
    if (!literal) fail()
    i += literal![0].length
  }
  try {
    value()
    ws()
    return i < text.length ? i : null
  } catch (at) {
    return typeof at === 'number' ? at : null
  }
}
