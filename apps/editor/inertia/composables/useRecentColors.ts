// useRecentColors — UX_GAPS §K.
//
// Module-singleton store of the last 8 distinct color values the user picked
// in any Inspector colour input. Persisted in localStorage so the swatch
// strip survives reloads; falls back to an in-memory array when storage
// isn't writable (private mode, SSR).
//
// The strip itself lives in `inputs/Color.vue` — each <Color> instance reads
// `recent.value` and clicks dispatch the same `update:modelValue` event a
// hex paste would.

import { ref, type Ref } from 'vue'

const STORAGE_KEY = 'davidup:recentColors:v1'
const MAX = 8
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function load(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const v of parsed) {
      if (typeof v === 'string' && HEX_RE.test(v) && !out.includes(v)) {
        out.push(v)
        if (out.length >= MAX) break
      }
    }
    return out
  } catch {
    return []
  }
}

function save(colors: ReadonlyArray<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(colors))
  } catch {
    // ignore quota / private-mode failures
  }
}

const recent: Ref<string[]> = ref<string[]>(load())

function push(color: string): void {
  if (typeof color !== 'string' || !HEX_RE.test(color)) return
  const next = recent.value.filter((c) => c !== color)
  next.unshift(color)
  if (next.length > MAX) next.length = MAX
  recent.value = next
  save(next)
}

export interface RecentColorsApi {
  recent: Ref<string[]>
  push(color: string): void
}

let api: RecentColorsApi | null = null

export function useRecentColors(): RecentColorsApi {
  if (api) return api
  api = { recent, push }
  return api
}
