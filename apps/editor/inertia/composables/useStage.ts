// `useStage` — wraps the davidup browser driver for a single canvas mount.
//
// Step 05 in the editor build plan: one Vue page, one full-bleed canvas,
// and the engine's `attach(composition, canvasEl)` driving it. The driver
// owns the requestAnimationFrame loop, asset preload, and tween indexing
// (see `src/drivers/browser/index.ts`); this composable just bridges Vue's
// reactivity to it.
//
// SSR-safe: the davidup browser driver and BrowserAssetLoader touch DOM
// globals (`Image`, `FontFace`, `document.createElement`), so we
// dynamic-import them inside `onMounted`. Server-rendered output stays
// markup-only; the engine starts the moment the client takes over.

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { AttachHandle, ItemBounds, PickHit } from 'davidup/browser'

export type StageStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'ended'
  | 'stopped'
  | 'error'

export interface UseStageOptions {
  /** Composition to mount. May be null when no project is loaded. */
  composition: Ref<unknown> | unknown
  /** Ref to the canvas element that becomes the render target. */
  canvas: Ref<HTMLCanvasElement | null>
}

export interface UseStageReturn {
  status: Ref<StageStatus>
  error: Ref<string | null>
  /** Current driver handle. Null until `attach()` resolves. */
  handle: Ref<AttachHandle | null>
  /**
   * Reactive playhead time in seconds. Advances via RAF while
   * `status === 'playing'`; latches at the last value otherwise (ended,
   * stopped, error, idle).
   */
  playhead: Ref<number>
  /** Re-attach against the canvas, replacing any active handle. */
  restart: () => Promise<void>
  /** Seek to `t` seconds (no-op when not attached). */
  seek: (t: number) => void
  /** Stop the loop. Idempotent. */
  stop: () => void
  /**
   * Hit-test a point in composition coordinates. Returns null when no item
   * was painted at the pixel, or when the stage isn't attached yet. The
   * Stage component converts CSS coords → composition coords before calling.
   */
  pickItemAt: (x: number, y: number, t?: number) => PickHit | null
  /**
   * On-stage bounding rectangle of `itemId` at time `t` (defaults to the
   * driver's current render time). Returns null when no driver is attached,
   * or when the id is not present in the scene. Stage.vue uses this each
   * frame to draw the selection ring.
   */
  getItemBoundsAt: (itemId: string, t?: number) => ItemBounds | null
  /**
   * Register a callback fired once per animation frame, regardless of play
   * state — returns an unsubscriber. Used by Stage.vue to redraw the
   * selection ring overlay in lock-step with the engine's RAF clock so the
   * ring tracks tweens even when the playhead is paused via tab throttling
   * or after the engine self-terminates past duration.
   */
  onTick: (cb: () => void) => () => void
}

export function useStage(options: UseStageOptions): UseStageReturn {
  const status = ref<StageStatus>('idle')
  const error = ref<string | null>(null)
  const handle = ref<AttachHandle | null>(null)
  const playhead = ref(0)
  let endTimer: ReturnType<typeof setTimeout> | null = null
  let rafId: number | null = null
  let cancelled = false
  // Wall-clock at which the current attach assumed t=0. Used to preserve the
  // playhead when the composition mutates (Inspector edits, MCP commands)
  // and we need to re-attach — without this, every edit would jump back to
  // the start of the comp.
  let lastAttachStartMs = 0
  let lastAttachStartAt = 0
  const tickSubscribers = new Set<() => void>()

  function cancelRaf(): void {
    if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafId)
    }
    rafId = null
  }

  function tickPlayhead(): void {
    // Advance the playhead only while playing — once we hit ended/stopped the
    // reactive ref must latch — but the RAF loop itself should keep going as
    // long as anyone subscribed via onTick (e.g. the selection-ring overlay,
    // which must redraw if the user re-selects an item on a paused stage).
    if (status.value === 'playing' && lastAttachStartMs !== 0) {
      const elapsed = (Date.now() - lastAttachStartMs) / 1000
      const duration = readDuration(readComposition())
      let next = Math.max(0, lastAttachStartAt + elapsed)
      if (duration > 0 && next > duration) next = duration
      playhead.value = next
    }
    for (const cb of tickSubscribers) {
      try {
        cb()
      } catch {
        /* one subscriber's throw must not stop the loop */
      }
    }
    if (status.value !== 'playing' && tickSubscribers.size === 0) {
      rafId = null
      return
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(tickPlayhead)
    } else {
      rafId = null
    }
  }

  function startTicking(): void {
    if (rafId !== null) return
    if (typeof requestAnimationFrame === 'undefined') return
    rafId = requestAnimationFrame(tickPlayhead)
  }

  function clearEndTimer(): void {
    if (endTimer !== null) {
      clearTimeout(endTimer)
      endTimer = null
    }
  }

  function readComposition(): unknown {
    const c = options.composition as { value?: unknown }
    return c && typeof c === 'object' && 'value' in c ? c.value : options.composition
  }

  function readCurrentPlayhead(): number {
    if (!handle.value || lastAttachStartMs === 0) return 0
    const elapsed = (Date.now() - lastAttachStartMs) / 1000
    return Math.max(0, lastAttachStartAt + elapsed)
  }

  async function start(opts: { resume?: boolean } = {}): Promise<void> {
    const canvasEl = options.canvas.value
    const comp = readComposition()
    const resumeAt = opts.resume ? readCurrentPlayhead() : 0
    stopInternal()
    if (!canvasEl) {
      status.value = 'error'
      error.value = 'useStage: canvas element is not mounted'
      return
    }
    if (!comp) {
      status.value = 'idle'
      error.value = null
      return
    }

    status.value = 'loading'
    error.value = null
    try {
      // Dynamic import keeps the DOM-only browser driver out of the SSR bundle.
      const mod = await import('davidup/browser')
      if (cancelled) return
      const duration = readDuration(comp)
      const startAt = duration > 0 ? Math.min(resumeAt, Math.max(0, duration - 0.001)) : resumeAt
      // HTMLCanvasElement's getContext returns CanvasRenderingContext2D, whose
      // setters (fillStyle, strokeStyle, font) accept gradients/patterns too.
      // The engine's `Canvas2DContext` narrows those to `string` because that's
      // all the renderer ever assigns. The runtime objects are 1:1 — cast through
      // unknown to satisfy structural typing.
      const h = await mod.attach(
        comp as Parameters<typeof mod.attach>[0],
        canvasEl as unknown as Parameters<typeof mod.attach>[1],
        // emitSourceMap unlocks pickItemAt's source-map output. The cost is
        // a second precompile pass under the hood (the resolved JSON itself
        // is byte-identical, see precompile.ts §"R1 mitigation").
        { startAt, emitSourceMap: true },
      )
      if (cancelled) {
        h.stop()
        return
      }
      handle.value = h
      lastAttachStartMs = Date.now()
      lastAttachStartAt = startAt
      playhead.value = startAt
      status.value = 'playing'
      startTicking()
      if (duration > 0) {
        const remaining = Math.max(0, duration - startAt)
        endTimer = setTimeout(() => {
          if (status.value === 'playing') status.value = 'ended'
          endTimer = null
        }, remaining * 1000 + 50)
      }
    } catch (err) {
      if (cancelled) return
      status.value = 'error'
      error.value = (err as Error).message ?? String(err)
      handle.value = null
    }
  }

  function stopInternal(): void {
    clearEndTimer()
    cancelRaf()
    if (handle.value) {
      try {
        handle.value.stop()
      } catch {
        /* ignore */
      }
      handle.value = null
    }
  }

  onMounted(() => {
    void start()
  })

  // Re-attach when either the canvas or composition reference changes. The
  // canvas swap (page navigation) starts from t=0; a composition mutation
  // (Inspector edit, MCP command) preserves the current playhead so the
  // user doesn't lose their place every time they nudge a value.
  watch(
    options.canvas,
    () => {
      if (status.value === 'idle' && handle.value === null && !options.canvas.value) {
        return
      }
      void start()
    },
    { flush: 'post' },
  )
  watch(
    () => readComposition(),
    () => {
      if (status.value === 'idle' && handle.value === null && !options.canvas.value) {
        return
      }
      void start({ resume: true })
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => {
    cancelled = true
    stopInternal()
  })

  return {
    status,
    error,
    handle,
    async restart() {
      await start()
    },
    seek(t: number) {
      handle.value?.seek(t)
      lastAttachStartMs = Date.now()
      lastAttachStartAt = t
      playhead.value = t
      if (status.value === 'ended') status.value = 'playing'
      clearEndTimer()
      const comp = readComposition()
      const duration = readDuration(comp)
      if (duration > 0 && t < duration) {
        endTimer = setTimeout(
          () => {
            if (status.value === 'playing') status.value = 'ended'
            endTimer = null
          },
          (duration - t) * 1000 + 50,
        )
      }
      if (status.value === 'playing') startTicking()
    },
    stop() {
      stopInternal()
      status.value = 'stopped'
    },
    pickItemAt(x: number, y: number, t?: number): PickHit | null {
      const h = handle.value
      if (!h) return null
      return h.pickItemAt(x, y, t)
    },
    getItemBoundsAt(itemId: string, t?: number): ItemBounds | null {
      const h = handle.value
      if (!h) return null
      return h.getItemBoundsAt(itemId, t)
    },
    onTick(cb: () => void): () => void {
      tickSubscribers.add(cb)
      // Kick the loop in case the engine is paused (or not attached yet).
      startTicking()
      return () => {
        tickSubscribers.delete(cb)
      }
    },
    playhead,
  }
}

function readDuration(comp: unknown): number {
  if (!comp || typeof comp !== 'object') return 0
  const c = (comp as { composition?: { duration?: unknown } }).composition
  const d = c?.duration
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : 0
}
