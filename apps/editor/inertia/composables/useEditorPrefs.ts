// useEditorPrefs — UX_GAPS §N + §S.
//
// Thin wrapper over `GET / PUT /api/editor-state` for the non-layout slices
// of editor state: render preferences (preset + filename) and the
// onboarding-dismissed flag. The panel layout has its own composable
// (usePanelLayout) because it ships a heap of resize-handle plumbing this
// doesn't need.
//
// Module-singleton so the render dialog, the editor page, and the empty-
// state overlay all see the same reactive values.

import { computed, ref, type Ref } from 'vue'

export type RenderPreset = 'draft' | 'web' | 'final'

export interface RenderPrefs {
  preset: RenderPreset
  filename: string
}

export interface OnboardingState {
  dismissed: boolean
}

const DEFAULT_RENDER_PREFS: RenderPrefs = { preset: 'web', filename: '' }
const DEFAULT_ONBOARDING: OnboardingState = { dismissed: false }

const renderPrefs: Ref<RenderPrefs> = ref({ ...DEFAULT_RENDER_PREFS })
const onboarding: Ref<OnboardingState> = ref({ ...DEFAULT_ONBOARDING })
const hydrated = ref(false)
let hydratePromise: Promise<void> | null = null

async function hydrate(): Promise<void> {
  if (hydrated.value) return
  if (hydratePromise) return hydratePromise
  if (typeof fetch === 'undefined') {
    hydrated.value = true
    return
  }
  hydratePromise = (async () => {
    try {
      const res = await fetch('/api/editor-state', { credentials: 'same-origin' })
      if (!res.ok) return
      const body = (await res.json()) as {
        renderPrefs?: Partial<RenderPrefs>
        onboarding?: Partial<OnboardingState>
      }
      if (body.renderPrefs) {
        renderPrefs.value = { ...DEFAULT_RENDER_PREFS, ...body.renderPrefs }
      }
      if (body.onboarding) {
        onboarding.value = { ...DEFAULT_ONBOARDING, ...body.onboarding }
      }
    } catch {
      // Defaults already loaded; persistence is best-effort.
    } finally {
      hydrated.value = true
      hydratePromise = null
    }
  })()
  return hydratePromise
}

async function persist(patch: {
  renderPrefs?: Partial<RenderPrefs>
  onboarding?: Partial<OnboardingState>
}): Promise<void> {
  if (typeof fetch === 'undefined') return
  try {
    await fetch('/api/editor-state', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
  } catch {
    // Best-effort; in-memory state already updated.
  }
}

async function setRenderPrefs(next: Partial<RenderPrefs>): Promise<void> {
  renderPrefs.value = { ...renderPrefs.value, ...next }
  await persist({ renderPrefs: renderPrefs.value })
}

async function dismissOnboarding(): Promise<void> {
  if (onboarding.value.dismissed) return
  onboarding.value = { dismissed: true }
  await persist({ onboarding: onboarding.value })
}

async function resetOnboarding(): Promise<void> {
  onboarding.value = { dismissed: false }
  await persist({ onboarding: onboarding.value })
}

export interface EditorPrefsApi {
  renderPrefs: Ref<RenderPrefs>
  onboarding: Ref<OnboardingState>
  hydrated: Ref<boolean>
  hydrate: () => Promise<void>
  setRenderPrefs: (next: Partial<RenderPrefs>) => Promise<void>
  dismissOnboarding: () => Promise<void>
  resetOnboarding: () => Promise<void>
  /** True once hydration completes (defaults shown until then). */
  isReady: Ref<boolean>
}

let api: EditorPrefsApi | null = null

export function useEditorPrefs(): EditorPrefsApi {
  if (api) return api
  api = {
    renderPrefs,
    onboarding,
    hydrated,
    hydrate,
    setRenderPrefs,
    dismissOnboarding,
    resetOnboarding,
    isReady: computed(() => hydrated.value) as Ref<boolean>,
  }
  return api
}

/** Map a UI preset to the ffmpeg knobs the worker accepts. */
export function presetToRenderOptions(preset: RenderPreset): {
  codec: 'libx264'
  crf: number
  preset: string
  pixFmt: string
} {
  switch (preset) {
    case 'draft':
      return { codec: 'libx264', crf: 30, preset: 'ultrafast', pixFmt: 'yuv420p' }
    case 'final':
      return { codec: 'libx264', crf: 18, preset: 'slow', pixFmt: 'yuv420p' }
    case 'web':
    default:
      return { codec: 'libx264', crf: 23, preset: 'medium', pixFmt: 'yuv420p' }
  }
}
