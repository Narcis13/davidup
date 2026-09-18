// Unit tests for the stage's client-side video frame provider (v1.1 S5).
//
// Fetching and decoding are injected, so the LRU / miss / prefetch / refresh
// contract is exercised without a browser. The end-to-end path (server
// extraction → stage pixels) is covered by tests/e2e/editorSmoke.

import { test } from '@japa/runner'
import {
  VideoFrameCache,
  frameUrl,
  videoSignature,
  type FrameImage,
  type StageClipsResponse,
} from '../../inertia/composables/videoFrameCache.js'

function comp(videoItems: Record<string, Record<string, unknown>> = { v: { trimIn: 0 } }) {
  const items: Record<string, unknown> = {
    s: { type: 'shape', kind: 'rect' },
  }
  for (const [id, extra] of Object.entries(videoItems)) {
    items[id] = { type: 'video', asset: 'clip', width: 320, height: 240, ...extra }
  }
  return {
    composition: { fps: 30 },
    assets: [{ id: 'clip', type: 'video', src: '/project-files/clip.mp4' }],
    items,
  }
}

const META = { hash: 'h1', frameCount: 10, width: 320, height: 240 }

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function harness(clips: StageClipsResponse = { clips: { v: META } }, opts = {}) {
  const loads = new Map<string, Deferred<FrameImage>>()
  let fetchCount = 0
  let ready = 0
  const cache = new VideoFrameCache({
    fetchClips: async () => {
      fetchCount++
      return clips
    },
    loadFrame: (url) => {
      const d = deferred<FrameImage>()
      loads.set(url, d)
      return d.promise
    },
    onFrameReady: () => {
      ready++
    },
    ...opts,
  })
  return {
    cache,
    loads,
    get fetchCount() {
      return fetchCount
    },
    get ready() {
      return ready
    },
  }
}

test.group('videoFrameCache · signature', () => {
  test('empty without video items, stable otherwise', ({ assert }) => {
    assert.equal(videoSignature({ items: { s: { type: 'shape' } } }), '')
    assert.equal(videoSignature(null), '')
    assert.equal(videoSignature(comp()), videoSignature(comp()))
    assert.notEqual(videoSignature(comp()), videoSignature(comp({ v: { trimIn: 0.5 } })))
  })

  test('frameUrl encodes item id and hash', ({ assert }) => {
    assert.equal(frameUrl('a b', 3, 'h/1'), '/project-video-frames/a%20b/3.png?h=h%2F1')
  })
})

test.group('videoFrameCache · provider', () => {
  test('no clip before refresh; metadata after', async ({ assert }) => {
    const h = harness()
    assert.isUndefined(h.cache.getClip('v'))
    await h.cache.refresh(comp())
    const clip = h.cache.getClip('v')
    assert.deepInclude(clip, { frameCount: 10, width: 320, height: 240 })
    assert.equal(h.ready, 1)
  })

  test('unchanged composition does not refetch; no-video composition skips fetch', async ({
    assert,
  }) => {
    const h = harness()
    await h.cache.refresh(comp())
    await h.cache.refresh(comp())
    assert.equal(h.fetchCount, 1)
    await h.cache.refresh({ items: {} })
    assert.equal(h.fetchCount, 1)
    assert.isUndefined(h.cache.getClip('v'))
  })

  test('miss returns undefined, fetches frame + prefetch, then hits', async ({ assert }) => {
    const h = harness(undefined, { prefetch: 2 })
    await h.cache.refresh(comp())
    const clip = h.cache.getClip('v')!
    assert.isUndefined(clip.getFrame(9))
    assert.sameMembers(
      [...h.loads.keys()],
      [frameUrl('v', 9, 'h1'), frameUrl('v', 10, 'h1')] // capped at frameCount
    )
    // Repeated misses don't duplicate in-flight requests.
    clip.getFrame(9)
    assert.equal(h.loads.size, 2)

    const bitmap = { id: 9, close: () => {} }
    h.loads.get(frameUrl('v', 9, 'h1'))!.resolve(bitmap)
    await flush()
    assert.strictEqual(clip.getFrame(9), bitmap)
    assert.equal(h.ready, 2) // metadata + one frame
  })

  test('LRU evicts and closes the oldest frame', async ({ assert }) => {
    const h = harness(undefined, { prefetch: 0, maxFrames: 2 })
    await h.cache.refresh(comp())
    const clip = h.cache.getClip('v')!
    const closed: number[] = []
    for (const i of [1, 2, 3]) {
      clip.getFrame(i)
      h.loads.get(frameUrl('v', i, 'h1'))!.resolve({ close: () => closed.push(i) })
      await flush()
    }
    assert.equal(h.cache.size, 2)
    assert.deepEqual(closed, [1])
  })

  test('a changed clip hash drops stale frames and ignores late arrivals', async ({ assert }) => {
    let clips: StageClipsResponse = { clips: { v: META } }
    const loads = new Map<string, Deferred<FrameImage>>()
    const cache = new VideoFrameCache({
      fetchClips: async () => clips,
      loadFrame: (url) => {
        const d = deferred<FrameImage>()
        loads.set(url, d)
        return d.promise
      },
      prefetch: 0,
    })
    await cache.refresh(comp())
    const clip = cache.getClip('v')!
    clip.getFrame(1)
    clip.getFrame(2)
    loads.get(frameUrl('v', 1, 'h1'))!.resolve({})
    await flush()
    assert.equal(cache.size, 1)

    clips = { clips: { v: { ...META, hash: 'h2' } } }
    await cache.refresh(comp({ v: { trimIn: 0.2 } }))
    assert.equal(cache.size, 0)
    let lateClosed = false
    loads.get(frameUrl('v', 2, 'h1'))!.resolve({ close: () => (lateClosed = true) })
    await flush()
    assert.isTrue(lateClosed)
    assert.equal(cache.size, 0)
    assert.isUndefined(cache.getClip('v')!.getFrame(1))
    assert.isTrue(loads.has(frameUrl('v', 1, 'h2')))
  })

  test('failed frame fetch backs off before retrying', async ({ assert }) => {
    let now = 0
    let calls = 0
    const cache = new VideoFrameCache({
      fetchClips: async () => ({ clips: { v: META } }),
      loadFrame: async () => {
        calls++
        throw new Error('boom')
      },
      prefetch: 0,
      retryMs: 1000,
      now: () => now,
    })
    await cache.refresh(comp())
    cache.getClip('v')!.getFrame(1)
    await flush()
    cache.getClip('v')!.getFrame(1)
    assert.equal(calls, 1)
    now = 1500
    cache.getClip('v')!.getFrame(1)
    assert.equal(calls, 2)
  })

  test('slow metadata announces pending, then settles', async ({ assert }) => {
    const gate = deferred<StageClipsResponse>()
    const events: string[] = []
    const cache = new VideoFrameCache({
      fetchClips: () => gate.promise,
      loadFrame: async () => ({}),
      pendingDelayMs: 5,
      onClipsPending: () => events.push('pending'),
      onClipsSettled: (info) => events.push(`settled:${info.announced}:${info.extracted}`),
    })
    const done = cache.refresh(comp())
    await new Promise((r) => setTimeout(r, 20))
    gate.resolve({ clips: { v: META }, extracted: true })
    await done
    assert.deepEqual(events, ['pending', 'settled:true:true'])
  })

  test('fast metadata stays quiet; warnings still surface', async ({ assert }) => {
    const events: string[] = []
    const cache = new VideoFrameCache({
      fetchClips: async () => ({ clips: {}, warnings: ['Video frames unavailable: nope'] }),
      loadFrame: async () => ({}),
      pendingDelayMs: 50,
      onClipsPending: () => events.push('pending'),
      onClipsSettled: (info) => events.push(`settled:${info.announced}:${info.warnings.length}`),
    })
    await cache.refresh(comp())
    assert.deepEqual(events, ['settled:false:1'])
  })
})
