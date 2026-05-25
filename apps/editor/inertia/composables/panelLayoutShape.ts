// Pure shape + clamping helpers for the editor's three-panel layout.
//
// Lives separately from `usePanelLayout.ts` so the headless tests in
// `tests/unit/` can import this module without dragging the composable's
// DOM-only references (`window`, `PointerEvent`, `document`) through tsc.
// The composable re-exports the public types/constants from here so callers
// keep a single import surface.

export type PanelLayout = {
  leftWidth: number
  rightWidth: number
  bottomHeight: number
}

export type PanelKey = keyof PanelLayout

export type PanelLimits = Record<PanelKey, { min: number; max: number }>

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  leftWidth: 280,
  rightWidth: 320,
  bottomHeight: 220,
}

export const PANEL_LIMITS: PanelLimits = {
  leftWidth: { min: 180, max: 600 },
  rightWidth: { min: 180, max: 600 },
  bottomHeight: { min: 120, max: 600 },
}

/** Width (in px) of the resize gutters between panels. */
export const HANDLE_SIZE = 6

export function clampPanel(value: number, panel: PanelKey): number {
  const { min, max } = PANEL_LIMITS[panel]
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function normalizeLayout(input: Partial<PanelLayout> | undefined | null): PanelLayout {
  return {
    leftWidth: clampPanel(input?.leftWidth ?? DEFAULT_PANEL_LAYOUT.leftWidth, 'leftWidth'),
    rightWidth: clampPanel(input?.rightWidth ?? DEFAULT_PANEL_LAYOUT.rightWidth, 'rightWidth'),
    bottomHeight: clampPanel(
      input?.bottomHeight ?? DEFAULT_PANEL_LAYOUT.bottomHeight,
      'bottomHeight',
    ),
  }
}

/** Five-track grid columns: left | handle | stage | handle | right. */
export function makeGridColumns(layout: PanelLayout): string {
  return `${layout.leftWidth}px ${HANDLE_SIZE}px 1fr ${HANDLE_SIZE}px ${layout.rightWidth}px`
}

/** Three-track grid rows: stage | handle | timeline. */
export function makeGridRows(layout: PanelLayout): string {
  return `1fr ${HANDLE_SIZE}px ${layout.bottomHeight}px`
}
