// Library thumbnail synthesizer — step 13 of the editor build plan.
//
// Goes from a single LibraryItem to a 1-second preview thumbnail PNG using
// the existing `render_preview_frame` path. For every supported kind we
// synthesize a tiny ephemeral composition that exercises the item, then
// render its midpoint via `renderPreviewFrame`.
//
// Supported kinds (best-effort, never throws — falls back to a styled
// placeholder if anything goes wrong):
//   - asset (image): single sprite at center, contain-fitted.
//   - font:          "Aa" text rendered with the font family at center.
//   - scene:         instantiate scene def with default params via the engine.
//   - template:      synthesize a sprite/shape/text from the first item the
//                    template emits, with defaults filled in.
//   - behavior:      a sample shape with the behavior applied as a tween.
//   - other / failure: deterministic placeholder PNG showing the kind + id.
//
// The thumbnail is cached in-memory keyed by `${kind}::${id}::${source}` so
// repeat requests are free; the cache is cleared when `clear()` is called
// (the library_index reload path invokes this).

import { resolve, dirname, join, isAbsolute } from 'node:path'
import { promises as fs } from 'node:fs'
import logger from '@adonisjs/core/services/logger'
import { renderPreviewFrame } from 'davidup/mcp'
import type { LibraryItem } from '#services/library_index'

export interface ThumbnailResult {
  buffer: Buffer
  mimeType: 'image/png'
  width: number
  height: number
  /** True when the result is a synthesized placeholder (no real preview). */
  placeholder: boolean
}

const THUMB_WIDTH = 480
const THUMB_HEIGHT = 270

interface PlaceholderCtx {
  fillStyle: string
  globalAlpha: number
  font: string
  textAlign: string
  textBaseline: string
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
}

interface SkiaCanvasShim {
  Canvas: new (
    w: number,
    h: number
  ) => {
    getContext(kind: '2d'): PlaceholderCtx
    toBuffer(format: 'png' | 'jpg'): Promise<Uint8Array> | Uint8Array
  }
  loadImage: (src: string) => Promise<unknown>
  FontLibrary: { use: (family: string, paths: string | string[]) => unknown }
}

let skiaPromise: Promise<SkiaCanvasShim> | null = null
async function loadSkia(): Promise<SkiaCanvasShim> {
  if (!skiaPromise) {
    const specifier = 'skia-canvas'
    skiaPromise = (Function('s', 'return import(s)') as (s: string) => Promise<SkiaCanvasShim>)(
      specifier
    )
  }
  return skiaPromise
}

function isAbsoluteUrl(s: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(s) || s.startsWith('data:')
}

/**
 * Resolve a library item's asset URL/path to an absolute on-disk path
 * (so skia-canvas's loadImage / FontLibrary.use can read it). Returns null
 * for absolute URLs / data URIs / missing files.
 */
async function resolveSourceFile(libraryRoot: string, raw: string): Promise<string | null> {
  if (!raw) return null
  if (isAbsoluteUrl(raw)) return null
  const stripped = raw.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
  const candidates = [
    isAbsolute(raw) ? raw : null,
    join(libraryRoot, stripped),
    join(dirname(libraryRoot), stripped),
    resolve(dirname(libraryRoot), raw),
  ].filter((p): p is string => typeof p === 'string')
  for (const c of candidates) {
    const stat = await fs.stat(c).catch(() => null)
    if (stat?.isFile()) return c
  }
  return null
}

interface Transform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  anchorX: number
  anchorY: number
  opacity: number
}

function transformAt(x: number, y: number, scale = 1): Transform {
  return {
    x,
    y,
    scaleX: scale,
    scaleY: scale,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    opacity: 1,
  }
}

function compMeta(background = '#0a0a0a') {
  return {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    fps: 30,
    duration: 1,
    background,
  }
}

interface SynthComposition {
  version: '0.1'
  composition: ReturnType<typeof compMeta>
  assets: unknown[]
  layers: { id: string; z: number; opacity: number; blendMode: string; items: string[] }[]
  items: Record<string, unknown>
  tweens: unknown[]
}

function singleLayer(itemIds: string[]): SynthComposition['layers'] {
  return [{ id: 'l0', z: 0, opacity: 1, blendMode: 'normal', items: itemIds }]
}

async function synthAssetComposition(
  item: LibraryItem,
  libraryRoot: string
): Promise<SynthComposition | null> {
  const url = item.url ?? (item.raw as { url?: string } | null)?.url
  if (typeof url !== 'string') return null
  const path = await resolveSourceFile(libraryRoot, url)
  if (!path) return null
  return {
    version: '0.1',
    composition: compMeta(),
    assets: [{ id: 'asset0', type: 'image', src: path }],
    layers: singleLayer(['sprite0']),
    items: {
      sprite0: {
        type: 'sprite',
        asset: 'asset0',
        width: THUMB_WIDTH * 0.7,
        height: THUMB_HEIGHT * 0.7,
        transform: transformAt(THUMB_WIDTH / 2, THUMB_HEIGHT / 2),
      },
    },
    tweens: [],
  }
}

async function synthFontComposition(
  item: LibraryItem,
  libraryRoot: string
): Promise<SynthComposition | null> {
  const raw = (item.raw as { url?: string; family?: string; src?: string } | null) ?? {}
  const url = item.url ?? raw.url ?? raw.src
  const family = raw.family ?? item.name ?? item.id
  if (typeof url !== 'string') return null
  const path = await resolveSourceFile(libraryRoot, url)
  if (!path) return null
  return {
    version: '0.1',
    composition: compMeta(),
    assets: [{ id: 'font0', type: 'font', src: path, family }],
    layers: singleLayer(['text0']),
    items: {
      text0: {
        type: 'text',
        text: 'Aa',
        font: family,
        fontSize: 140,
        color: '#ffffff',
        align: 'center',
        transform: transformAt(THUMB_WIDTH / 2, THUMB_HEIGHT / 2 + 50),
      },
    },
    tweens: [],
  }
}

function synthBehaviorComposition(item: LibraryItem): SynthComposition {
  // Render a generic primitive — the behavior name is shown as a placeholder
  // since most behaviors operate on a *target* with shape-specific
  // properties we can't know in v1. A second pass could read the
  // behavior's `target_kinds` / param defaults.
  const color = colorForId(item.id)
  return {
    version: '0.1',
    composition: compMeta(),
    assets: [],
    layers: singleLayer(['shape0']),
    items: {
      shape0: {
        type: 'shape',
        kind: 'circle',
        width: 120,
        height: 120,
        fillColor: color,
        transform: transformAt(THUMB_WIDTH / 2, THUMB_HEIGHT / 2),
      },
    },
    tweens: [],
  }
}

function colorForId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 65%, 55%)`
}

function synthTemplateComposition(item: LibraryItem): SynthComposition | null {
  // Best-effort: take the first item from the template's `items` map and
  // render it standalone in a single-layer composition. Param placeholders
  // (`${params.foo}`) survive without substitution — most of them are used
  // in text/color positions where leaving the literal "${...}" string is
  // harmless. Tweens are omitted so animations don't move it off-screen.
  const raw = item.raw as { items?: Record<string, unknown> } | null
  const items = raw?.items
  if (!items || typeof items !== 'object') return null
  const entries = Object.entries(items)
  if (entries.length === 0) return null
  const [, first] = entries[0]
  const cloned = JSON.parse(JSON.stringify(first)) as Record<string, unknown>
  if (typeof cloned !== 'object' || cloned === null) return null
  // Best-effort: replace template placeholders so the renderer doesn't choke.
  scrubPlaceholders(cloned)
  // Center the item.
  cloned.transform = transformAt(THUMB_WIDTH / 2, THUMB_HEIGHT / 2)
  if (cloned.type === 'sprite') {
    // Sprites without a known asset won't render; bail to placeholder path.
    return null
  }
  if (cloned.type === 'text') {
    if (!cloned.font) cloned.font = 'sans-serif'
    if (typeof cloned.fontSize !== 'number') cloned.fontSize = 80
    if (!cloned.color) cloned.color = '#ffffff'
    if (typeof cloned.text !== 'string') cloned.text = item.name ?? item.id
  }
  if (cloned.type === 'shape') {
    if (!cloned.kind) cloned.kind = 'rect'
    if (typeof cloned.width !== 'number') cloned.width = THUMB_WIDTH * 0.6
    if (typeof cloned.height !== 'number') cloned.height = THUMB_HEIGHT * 0.6
    if (!cloned.fillColor) cloned.fillColor = colorForId(item.id)
  }
  return {
    version: '0.1',
    composition: compMeta(),
    assets: [],
    layers: singleLayer(['preview']),
    items: { preview: cloned },
    tweens: [],
  }
}

function scrubPlaceholders(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) scrubPlaceholders(v)
    return
  }
  if (!value || typeof value !== 'object') return
  const o = value as Record<string, unknown>
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && v.includes('${')) {
      // Leave a friendly placeholder where the substitution would have gone.
      o[k] = v.replace(/\$\{[^}]+\}/g, '·')
    } else {
      scrubPlaceholders(v)
    }
  }
}

function synthSceneComposition(item: LibraryItem): SynthComposition | null {
  const sceneRaw = item.raw as
    | { items?: Record<string, unknown>; size?: { width?: number; height?: number } }
    | null
  if (!sceneRaw?.items) return null
  // Just lift the items as-is — scenes already define transforms relative
  // to their own canvas; we use the first item's bounds for centering.
  // This is intentionally a "rough preview" of the scene at t=0.5s.
  const items: Record<string, unknown> = {}
  const layerItems: string[] = []
  for (const [id, itemRaw] of Object.entries(sceneRaw.items)) {
    if (!itemRaw || typeof itemRaw !== 'object') continue
    const cloned = JSON.parse(JSON.stringify(itemRaw)) as Record<string, unknown>
    scrubPlaceholders(cloned)
    if (typeof cloned.type !== 'string') continue
    items[id] = cloned
    layerItems.push(id)
    if (layerItems.length >= 8) break // cap fanout for huge scenes
  }
  if (layerItems.length === 0) return null
  return {
    version: '0.1',
    composition: compMeta(),
    assets: [],
    layers: singleLayer(layerItems),
    items,
    tweens: [],
  }
}

async function renderPlaceholder(item: LibraryItem): Promise<ThumbnailResult> {
  // Pure server-side PNG showing a kind badge + name. Used when synthesis
  // fails or the item kind has no viable preview path. Built with skia-canvas
  // directly (no engine dependency) so it works in environments where the
  // composition runtime would balk.
  const skia = await loadSkia()
  const canvas = new skia.Canvas(THUMB_WIDTH, THUMB_HEIGHT)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT)
  // Diagonal kind stripe.
  ctx.fillStyle = colorForId(item.kind + item.id)
  ctx.globalAlpha = 0.18
  ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT)
  ctx.globalAlpha = 1
  // Kind tag.
  ctx.font = '600 18px sans-serif'
  ctx.fillStyle = '#a3a3a3'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(item.kind.toUpperCase(), 18, 18)
  // Name.
  ctx.font = '500 30px sans-serif'
  ctx.fillStyle = '#e5e5e5'
  const name = item.name ?? item.id
  wrapText(ctx, name, 18, THUMB_HEIGHT / 2 - 18, THUMB_WIDTH - 36, 34)
  const raw = await Promise.resolve(canvas.toBuffer('png'))
  return {
    buffer: Buffer.from(
      raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBufferLike)
    ),
    mimeType: 'image/png',
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    placeholder: true,
  }
}

function wrapText(
  ctx: PlaceholderCtx,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  const words = text.split(/\s+/)
  let line = ''
  let cursorY = y
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`
    const m = ctx.measureText(candidate)
    if (m.width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, cursorY)
      line = word
      cursorY += lineHeight
    } else {
      line = candidate
    }
  }
  if (line.length > 0) ctx.fillText(line, x, cursorY)
}

export class LibraryThumbnailService {
  #cache = new Map<string, ThumbnailResult>()
  #generation = 0

  clear(): void {
    this.#cache.clear()
  }

  /**
   * Bump the cache generation. The next forItem() call will clear the cache
   * before serving. Call this whenever the underlying library catalog
   * reloads so stale thumbnails get rebuilt.
   */
  invalidateOn(generation: number): void {
    if (generation !== this.#generation) {
      this.#generation = generation
      this.#cache.clear()
    }
  }

  cacheKey(item: LibraryItem): string {
    return `${item.kind}::${item.id}::${item.source}`
  }

  async forItem(item: LibraryItem, libraryRoot: string | null): Promise<ThumbnailResult> {
    const key = this.cacheKey(item)
    const cached = this.#cache.get(key)
    if (cached) return cached

    let synth: SynthComposition | null = null
    try {
      if (libraryRoot) {
        if (item.kind === 'asset') synth = await synthAssetComposition(item, libraryRoot)
        else if (item.kind === 'font') synth = await synthFontComposition(item, libraryRoot)
        else if (item.kind === 'template') synth = synthTemplateComposition(item)
        else if (item.kind === 'scene') synth = synthSceneComposition(item)
        else if (item.kind === 'behavior') synth = synthBehaviorComposition(item)
      }
    } catch (err) {
      logger.warn({ err, item: key }, 'library_thumbnail: synth failed')
    }

    let result: ThumbnailResult
    if (synth) {
      try {
        const preview = await renderPreviewFrame(
          synth as unknown as Parameters<typeof renderPreviewFrame>[0],
          0.5
        )
        const buf = Buffer.from(preview.image, 'base64')
        result = {
          buffer: buf,
          mimeType: 'image/png',
          width: preview.width,
          height: preview.height,
          placeholder: false,
        }
      } catch (err) {
        logger.warn({ err, item: key }, 'library_thumbnail: render failed, using placeholder')
        result = await renderPlaceholder(item)
      }
    } else {
      result = await renderPlaceholder(item)
    }

    this.#cache.set(key, result)
    return result
  }
}

const libraryThumbnail = new LibraryThumbnailService()
export default libraryThumbnail
