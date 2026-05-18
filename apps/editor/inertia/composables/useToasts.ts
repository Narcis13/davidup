// useToasts — step 20.17 of the editor polish plan.
//
// Module-singleton toast queue used by surfaces that don't own their own
// inline feedback area: command failures the inspector can't surface
// (no item selected), render lifecycle, project-switch reloads, library
// refresh errors. Upload jobs keep their own progress state in
// `useAssetUpload` and are rendered by the same `Toasts.vue` component
// so the on-screen stack stays unified.
//
// Four levels mirror the validation taxonomy: success / info / warning /
// error. Each level gets its own default linger so errors stay visible
// longer than informational pings.

import { computed, reactive, type ComputedRef } from 'vue'

export type ToastLevel = 'success' | 'info' | 'warning' | 'error'

export interface Toast {
  id: string
  level: ToastLevel
  title: string
  /** Optional secondary line shown beneath the title. */
  message?: string
  /** Optional grouping key — pushing a new toast with the same key
   *  replaces the prior one instead of stacking duplicates. */
  dedupeKey?: string
  createdAt: number
}

export interface PushOptions {
  message?: string
  /** Override the default linger for this level. `0` disables auto-dismiss. */
  lingerMs?: number
  dedupeKey?: string
}

export interface UseToastsApi {
  toasts: ComputedRef<readonly Toast[]>
  push(level: ToastLevel, title: string, opts?: PushOptions): string
  success(title: string, opts?: PushOptions): string
  info(title: string, opts?: PushOptions): string
  warning(title: string, opts?: PushOptions): string
  error(title: string, opts?: PushOptions): string
  dismiss(id: string): void
  clear(): void
}

interface State {
  list: Toast[]
  seq: number
}

const state = reactive<State>({ list: [], seq: 0 })

// Errors stick around longer than the cheery info / success toasts so the
// user has time to read them before they vanish.
const DEFAULT_LINGER_MS: Record<ToastLevel, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000,
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(id: string): void {
  const t = timers.get(id)
  if (t !== undefined) {
    clearTimeout(t)
    timers.delete(id)
  }
}

function scheduleDismiss(id: string, lingerMs: number): void {
  if (typeof window === 'undefined' || lingerMs <= 0) return
  clearTimer(id)
  const t = setTimeout(() => dismiss(id), lingerMs)
  timers.set(id, t)
}

function push(level: ToastLevel, title: string, opts: PushOptions = {}): string {
  const lingerMs = opts.lingerMs ?? DEFAULT_LINGER_MS[level]
  if (opts.dedupeKey) {
    const existing = state.list.find((t) => t.dedupeKey === opts.dedupeKey)
    if (existing) {
      existing.level = level
      existing.title = title
      existing.message = opts.message
      existing.createdAt = Date.now()
      scheduleDismiss(existing.id, lingerMs)
      return existing.id
    }
  }
  const id = `t_${++state.seq}_${Date.now().toString(36)}`
  state.list.push({
    id,
    level,
    title,
    message: opts.message,
    dedupeKey: opts.dedupeKey,
    createdAt: Date.now(),
  })
  scheduleDismiss(id, lingerMs)
  return id
}

function dismiss(id: string): void {
  clearTimer(id)
  const idx = state.list.findIndex((t) => t.id === id)
  if (idx >= 0) state.list.splice(idx, 1)
}

function clear(): void {
  for (const id of timers.keys()) clearTimer(id)
  state.list.splice(0, state.list.length)
}

let api: UseToastsApi | null = null

export function useToasts(): UseToastsApi {
  if (api) return api
  api = {
    toasts: computed(() => state.list as readonly Toast[]),
    push,
    success: (title, opts) => push('success', title, opts),
    info: (title, opts) => push('info', title, opts),
    warning: (title, opts) => push('warning', title, opts),
    error: (title, opts) => push('error', title, opts),
    dismiss,
    clear,
  }
  return api
}

// Test-only escape hatch — wipes state and resets the cached api.
export function __resetToastsForTests(): void {
  clear()
  state.seq = 0
  api = null
}
