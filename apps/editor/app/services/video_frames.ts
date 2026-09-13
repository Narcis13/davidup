// Stage video frames — v1.1 S5.
//
// The editor stage draws video items from the SAME on-disk frame cache the
// renderer uses: we run the node driver's `preExtractVideoFrames` against the
// loaded project's canonical composition (video srcs resolved against the
// project root, exactly like the render worker does), so the cache hash — and
// therefore the pixels — match what `renderToFile` will composite.
//
// Two consumers:
//   - GET /api/video-clips                         → per-item clip metadata
//   - GET /project-video-frames/:itemId/:frame.png → one PNG from the cache
//
// Extraction can take seconds on a cache miss, so the in-flight promise is
// shared: the metadata request and every frame request for the same clip set
// await one extraction. Keyed by cache root + every spec (hash → item ids);
// the spec hash pins source path/mtime/size, trim, fps and resolution, so an
// edit that changes the pixels lands on a fresh key.

import { isAbsolute, join, resolve } from 'node:path'
import {
  collectVideoExtractSpecs,
  compositionHasVideo,
  defaultFrameCacheRoot,
  preExtractVideoFrames,
} from 'davidup/node'
import type { Composition } from 'davidup/schema'

export interface StageVideoClip {
  /** Extraction cache hash — changes whenever the clip's pixels would. */
  hash: string
  frameCount: number
  width: number
  height: number
}

export interface StageVideoClips {
  clips: Record<string, StageVideoClip>
  /** True when ffmpeg had to run for at least one clip. */
  extracted: boolean
  warnings: string[]
}

interface ClipSet {
  byItem: Map<string, { dir: string; clip: StageVideoClip }>
  extracted: boolean
}

const CACHE_MAX = 4

/**
 * Clone `composition` with every relative video asset src resolved against
 * `root`. `global:` srcs are left for the extractor to resolve; URLs and
 * absolute paths are left alone.
 */
export function resolveVideoSources(composition: Composition, root: string): Composition {
  const clone = JSON.parse(JSON.stringify(composition)) as Composition
  for (const asset of clone.assets) {
    if (asset.type !== 'video' || typeof asset.src !== 'string' || asset.src.length === 0) continue
    const src = asset.src
    if (src.startsWith('global:') || isAbsolute(src) || /^[a-z]+:/i.test(src)) continue
    ;(asset as { src: string }).src = resolve(root, src.replace(/^(?:\.\/)+/, ''))
  }
  return clone
}

export class VideoFrames {
  #cache = new Map<string, Promise<ClipSet>>()

  /** Clip metadata for every video item in `composition`, extracting on a miss. */
  async clipsFor(composition: Composition, root: string): Promise<StageVideoClips> {
    const warnings: string[] = []
    const found = await this.#clipSet(composition, root, warnings)
    const clips: Record<string, StageVideoClip> = {}
    if (found) for (const [id, entry] of found.set.byItem) clips[id] = entry.clip
    // Only the request that started the extraction reports it; later callers
    // sharing the (in-flight or settled) result were served from cache.
    return { clips, extracted: found !== null && found.started && found.set.extracted, warnings }
  }

  /**
   * Absolute path of the PNG for `itemId`'s 1-based `frameIndex`, or null when
   * the item has no clip or the index is out of range.
   */
  async framePath(
    composition: Composition,
    root: string,
    itemId: string,
    frameIndex: number
  ): Promise<{ path: string; hash: string } | null> {
    const found = await this.#clipSet(composition, root, [])
    const entry = found?.set.byItem.get(itemId)
    if (!entry) return null
    if (!Number.isInteger(frameIndex) || frameIndex < 1 || frameIndex > entry.clip.frameCount) {
      return null
    }
    return {
      path: join(entry.dir, `${String(frameIndex).padStart(5, '0')}.png`),
      hash: entry.clip.hash,
    }
  }

  clear(): void {
    this.#cache.clear()
  }

  async #clipSet(
    composition: Composition,
    root: string,
    warnings: string[]
  ): Promise<{ set: ClipSet; started: boolean } | null> {
    if (!compositionHasVideo(composition)) return null
    const resolved = resolveVideoSources(composition, root)
    const cacheRoot = defaultFrameCacheRoot()

    let key: string
    try {
      const specs = collectVideoExtractSpecs(resolved)
      key = JSON.stringify([cacheRoot, specs.map((s) => [s.hash, s.itemIds])])
    } catch (err) {
      warnings.push(`Video frames unavailable: ${errorMessage(err)}`)
      return null
    }

    let pending = this.#cache.get(key)
    const started = pending === undefined
    if (pending) {
      this.#cache.delete(key)
      this.#cache.set(key, pending)
    } else {
      const ffmpegPath = process.env.DAVIDUP_FFMPEG_PATH
      pending = preExtractVideoFrames(resolved, {
        cacheRoot,
        ...(ffmpegPath ? { ffmpegPath } : {}),
      }).then((result) => {
        const byItem: ClipSet['byItem'] = new Map()
        let extracted = false
        for (const entry of result.entries.values()) {
          if (!entry.cached) extracted = true
          const clip: StageVideoClip = {
            hash: entry.hash,
            frameCount: entry.frameCount,
            width: entry.width,
            height: entry.height,
          }
          for (const id of entry.itemIds) byItem.set(id, { dir: entry.dir, clip })
        }
        return { byItem, extracted }
      })
      this.#cache.set(key, pending)
      while (this.#cache.size > CACHE_MAX) {
        const oldest = this.#cache.keys().next().value
        if (oldest === undefined) break
        this.#cache.delete(oldest)
      }
    }

    try {
      return { set: await pending, started }
    } catch (err) {
      // Never cache a failure — the next request retries (asset fixed, etc).
      if (this.#cache.get(key) === pending) this.#cache.delete(key)
      warnings.push(`Video frames unavailable: ${errorMessage(err)}`)
      return null
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default new VideoFrames()
