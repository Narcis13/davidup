// Persistent editor UI state — currently just the three-panel layout sizes,
// stored in `~/.davidup/state.json`. Step 08 of the editor build plan.
//
// Lives outside the project directory because layout preferences belong to
// the user, not to the composition. Atomic writes (tmp + rename) so a torn
// state.json can't survive a crash.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import logger from '@adonisjs/core/services/logger'

export type PanelLayout = {
  /** Library panel width in pixels (left column). */
  leftWidth: number
  /** Inspector panel width in pixels (right column). */
  rightWidth: number
  /** Timeline panel height in pixels (bottom row). */
  bottomHeight: number
}

export type RenderPreset = 'draft' | 'web' | 'final'

export type RenderPrefs = {
  /** Last preset the user picked in the render dialog. */
  preset: RenderPreset
  /** Most recently used custom basename (empty ≡ auto-stamp). */
  filename: string
}

export type OnboardingState = {
  /** True once the user dismisses the empty-state overlay. */
  dismissed: boolean
}

export type EditorState = {
  panelLayout: PanelLayout
  renderPrefs: RenderPrefs
  onboarding: OnboardingState
}

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  leftWidth: 280,
  rightWidth: 320,
  bottomHeight: 220,
}

export const DEFAULT_RENDER_PREFS: RenderPrefs = {
  preset: 'web',
  filename: '',
}

export const DEFAULT_ONBOARDING: OnboardingState = {
  dismissed: false,
}

export const PANEL_LIMITS = {
  leftWidth: { min: 180, max: 600 },
  rightWidth: { min: 180, max: 600 },
  bottomHeight: { min: 120, max: 600 },
} as const

const RENDER_PRESETS: ReadonlySet<RenderPreset> = new Set(['draft', 'web', 'final'])

const DEFAULT_STATE: EditorState = {
  panelLayout: { ...DEFAULT_PANEL_LAYOUT },
  renderPrefs: { ...DEFAULT_RENDER_PREFS },
  onboarding: { ...DEFAULT_ONBOARDING },
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizePanelLayout(input: unknown): PanelLayout {
  const src = (input ?? {}) as Partial<Record<keyof PanelLayout, unknown>>
  const left = clamp(
    Number(src.leftWidth ?? DEFAULT_PANEL_LAYOUT.leftWidth),
    PANEL_LIMITS.leftWidth.min,
    PANEL_LIMITS.leftWidth.max,
  )
  const right = clamp(
    Number(src.rightWidth ?? DEFAULT_PANEL_LAYOUT.rightWidth),
    PANEL_LIMITS.rightWidth.min,
    PANEL_LIMITS.rightWidth.max,
  )
  const bottom = clamp(
    Number(src.bottomHeight ?? DEFAULT_PANEL_LAYOUT.bottomHeight),
    PANEL_LIMITS.bottomHeight.min,
    PANEL_LIMITS.bottomHeight.max,
  )
  return { leftWidth: left, rightWidth: right, bottomHeight: bottom }
}

function normalizeRenderPrefs(input: unknown): RenderPrefs {
  const src = (input ?? {}) as Partial<Record<keyof RenderPrefs, unknown>>
  const preset =
    typeof src.preset === 'string' && RENDER_PRESETS.has(src.preset as RenderPreset)
      ? (src.preset as RenderPreset)
      : DEFAULT_RENDER_PREFS.preset
  const filename =
    typeof src.filename === 'string' ? src.filename.slice(0, 120) : DEFAULT_RENDER_PREFS.filename
  return { preset, filename }
}

function normalizeOnboarding(input: unknown): OnboardingState {
  const src = (input ?? {}) as Partial<Record<keyof OnboardingState, unknown>>
  return {
    dismissed: src.dismissed === true,
  }
}

export class EditorStateStore {
  #explicitPath: string | null
  #state: EditorState | null = null
  #loaded = false

  constructor(opts: { path?: string } = {}) {
    this.#explicitPath = opts.path ?? null
  }

  /**
   * Absolute path to the state.json file backing this store. Resolved on
   * every access so tests can redirect via `DAVIDUP_STATE_DIR` after the
   * default singleton has already been constructed.
   */
  get path(): string {
    return this.#explicitPath ?? defaultStatePath()
  }

  /** Override the on-disk path. Useful for tests; production code uses defaults. */
  setPath(path: string | null): void {
    this.#explicitPath = path
    this.resetCache()
  }

  /**
   * Read the state from disk on first call, then cache. A missing file
   * resolves to defaults — first launch is not an error. Malformed JSON is
   * logged and silently replaced with defaults so a corrupt file can't
   * brick the editor.
   */
  async read(): Promise<EditorState> {
    if (this.#loaded && this.#state) return this.#state
    const path = this.path
    let parsed: unknown = null
    try {
      const raw = await fs.readFile(path, 'utf8')
      parsed = JSON.parse(raw)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.warn(
          { err, path },
          'editor_state: failed to read state.json — falling back to defaults',
        )
      }
    }
    const root = (parsed ?? {}) as {
      panelLayout?: unknown
      renderPrefs?: unknown
      onboarding?: unknown
    }
    this.#state = {
      panelLayout: normalizePanelLayout(root.panelLayout),
      renderPrefs: normalizeRenderPrefs(root.renderPrefs),
      onboarding: normalizeOnboarding(root.onboarding),
    }
    this.#loaded = true
    return this.#state
  }

  /**
   * Merge `patch` into the current state and atomically rewrite state.json.
   * Returns the resulting state. Unknown fields in `patch.panelLayout` are
   * dropped; numeric fields are clamped to {@link PANEL_LIMITS}.
   */
  async update(patch: {
    panelLayout?: Partial<PanelLayout>
    renderPrefs?: Partial<RenderPrefs>
    onboarding?: Partial<OnboardingState>
  }): Promise<EditorState> {
    const current = await this.read()
    const nextLayout = normalizePanelLayout({ ...current.panelLayout, ...patch.panelLayout })
    const nextRender = normalizeRenderPrefs({ ...current.renderPrefs, ...patch.renderPrefs })
    const nextOnboarding = normalizeOnboarding({
      ...current.onboarding,
      ...patch.onboarding,
    })
    const next: EditorState = {
      panelLayout: nextLayout,
      renderPrefs: nextRender,
      onboarding: nextOnboarding,
    }
    await this.#write(next)
    this.#state = next
    return next
  }

  async #write(state: EditorState): Promise<void> {
    const path = this.path
    await fs.mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    const json = `${JSON.stringify(state, null, 2)}\n`
    await fs.writeFile(tmp, json, 'utf8')
    await fs.rename(tmp, path)
  }

  /** Drop the in-memory cache so the next `read()` re-hits disk. Tests only. */
  resetCache(): void {
    this.#state = null
    this.#loaded = false
  }
}

export function defaultStatePath(): string {
  // Allow tests / sandboxes to redirect via env var.
  const override = process.env.DAVIDUP_STATE_DIR
  const dir = override ? override : join(homedir(), '.davidup')
  return join(dir, 'state.json')
}

const editorState = new EditorStateStore()
export default editorState
export const __defaults = DEFAULT_STATE
