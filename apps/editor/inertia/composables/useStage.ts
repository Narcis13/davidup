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
import type { AttachHandle } from 'davidup/browser'

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
  /** Re-attach against the canvas, replacing any active handle. */
  restart: () => Promise<void>
  /** Seek to `t` seconds (no-op when not attached). */
  seek: (t: number) => void
  /** Stop the loop. Idempotent. */
  stop: () => void
}

export function useStage(options: UseStageOptions): UseStageReturn {
  const status = ref<StageStatus>('idle')
  const error = ref<string | null>(null)
  const handle = ref<AttachHandle | null>(null)
  let endTimer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

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

  async function start(): Promise<void> {
    const canvasEl = options.canvas.value
    const comp = readComposition()
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
      // HTMLCanvasElement's getContext returns CanvasRenderingContext2D, whose
      // setters (fillStyle, strokeStyle, font) accept gradients/patterns too.
      // The engine's `Canvas2DContext` narrows those to `string` because that's
      // all the renderer ever assigns. The runtime objects are 1:1 — cast through
      // unknown to satisfy structural typing.
      const h = await mod.attach(
        comp as Parameters<typeof mod.attach>[0],
        canvasEl as unknown as Parameters<typeof mod.attach>[1],
      )
      if (cancelled) {
        h.stop()
        return
      }
      handle.value = h
      status.value = 'playing'
      const duration = readDuration(comp)
      if (duration > 0) {
        endTimer = setTimeout(() => {
          if (status.value === 'playing') status.value = 'ended'
          endTimer = null
        }, duration * 1000 + 50)
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

  // Re-attach when either the canvas or composition reference changes.
  watch(
    [options.canvas, () => readComposition()],
    () => {
      if (status.value === 'idle' && handle.value === null && !options.canvas.value) {
        return
      }
      void start()
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
    },
    stop() {
      stopInternal()
      status.value = 'stopped'
    },
  }
}

function readDuration(comp: unknown): number {
  if (!comp || typeof comp !== 'object') return 0
  const c = (comp as { composition?: { duration?: unknown } }).composition
  const d = c?.duration
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : 0
}
