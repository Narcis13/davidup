// The record drawer's pure half (docs/asset-library-plan.md E4): what the
// drawer reads off the open composition, and how a typed field becomes a
// `tag_asset` edit. No Vue, so the unit tests import it directly.

/** assetlib's closed licence list (`LICENCES`); a unit test holds them equal. */
export const RECORD_LICENCES = ['CC0', 'CC-BY', 'CC-BY-SA', 'OFL', 'PD', 'own', 'unknown'] as const
export type RecordLicence = (typeof RECORD_LICENCES)[number]

/** The text fields the drawer edits in place. */
export type RecordTextField = 'name' | 'desc' | 'credit' | 'source'

export interface CompositionUsageLike {
  assets?: ReadonlyArray<{
    id?: unknown
    src?: unknown
    credit?: unknown
    licence?: unknown
  }>
  items?: Record<string, { type?: unknown; asset?: unknown; font?: unknown } | null | undefined>
  audio?: ReadonlyArray<{ id?: unknown; asset?: unknown } | null | undefined>
}

/** One composition asset registered from the record. */
export interface RecordUse {
  /** The composition asset id. */
  assetId: string
  src: string
  /** The pin (`@<sha12>`), or null for an unpinned `asset:<id>`. */
  pin: string | null
  /** False when the pin names other bytes than the record's (E_ASSET_STALE at render). */
  current: boolean
  /** Items drawing it: sprites and videos by `asset`, texts by `font`. */
  items: string[]
  /** Audio tracks playing it (their id, else `#<index>`). */
  audio: string[]
  /** The credit and licence the composition copied when it registered the record. */
  credit: string
  licence: string
}

const ASSET_SRC = /^asset:([^@]+)(?:@([0-9a-f]+))?$/

/**
 * The open composition's assets registered from library record `id` (an
 * `asset:<id>` or `asset:<id>@<pin>` src), with the items and audio tracks
 * using each. `sha` is the record's, to tell a current pin from a stale one.
 */
export function recordUses(
  comp: CompositionUsageLike | null | undefined,
  id: string,
  sha: string | undefined
): RecordUse[] {
  if (!comp) return []
  const out: RecordUse[] = []
  for (const a of comp.assets ?? []) {
    const src = typeof a?.src === 'string' ? a.src : ''
    const m = ASSET_SRC.exec(src)
    if (!m || m[1] !== id || typeof a.id !== 'string') continue
    const pin = m[2] ?? null
    out.push({
      assetId: a.id,
      src,
      pin,
      current: pin === null || !sha || sha.startsWith(pin),
      items: [],
      audio: [],
      credit: typeof a.credit === 'string' ? a.credit : '',
      licence: typeof a.licence === 'string' ? a.licence : '',
    })
  }
  if (out.length === 0) return out
  const byAsset = new Map(out.map((u) => [u.assetId, u]))
  for (const [itemId, item] of Object.entries(comp.items ?? {})) {
    if (!item || typeof item !== 'object') continue
    const ref =
      item.type === 'text'
        ? item.font
        : item.type === 'sprite' || item.type === 'video'
          ? item.asset
          : undefined
    if (typeof ref === 'string') byAsset.get(ref)?.items.push(itemId)
  }
  ;(comp.audio ?? []).forEach((t, i) => {
    if (t && typeof t.asset === 'string') {
      byAsset.get(t.asset)?.audio.push(typeof t.id === 'string' ? t.id : `#${i}`)
    }
  })
  return out
}

/**
 * Tags typed into the drawer's tag box: split on commas and whitespace,
 * lower-cased, without the ones the record has (or repeats).
 */
export function newTags(input: string, have: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of input.split(/[,\s]+/)) {
    const t = raw.trim().toLowerCase()
    if (t && !have.includes(t) && !out.includes(t)) out.push(t)
  }
  return out
}

/**
 * The `tag_asset` fields for a text field typed as `value`, or null when there
 * is nothing to send: the value is unchanged, or a name was cleared (a record
 * keeps its name). A cleared desc is `""`, which removes it.
 */
export function textEdit(
  field: RecordTextField,
  before: string | undefined | null,
  value: string
): Record<string, string> | null {
  const next = value.trim()
  if (next === (before ?? '').trim()) return null
  if (field === 'name' && next === '') return null
  return { [field]: next }
}
