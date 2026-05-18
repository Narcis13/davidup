// `useValidation` — shared validation report state (step 20.16).
//
// The composable holds two things:
//   1. The semantic `ValidationResult` of the current composition (re-run
//      whenever the composition reference changes — fast, Zod-backed).
//   2. The full structured error from the most recent rejected command
//      (`CommandValidationError` / `CommandRejectedError` /
//      `PostValidationError` shapes from `commands_controller.ts`). The
//      previous code path only captured `error.message` — we now preserve
//      `code`, `hint`, `issues`, and `details` so the StatusBar can surface
//      the actual reason a write was rejected (FR-14).
//
// Both feeds flow into a derived `markersByTarget` map: { itemId → count }
// of errors / warnings affecting that target. `Timeline.vue` consumes it to
// paint red/yellow dots on track rows.

import { computed, inject, provide, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import { validateComposition } from 'davidup/schema'
import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from 'davidup/schema'
import type { Composition } from '~/composables/useCommandBus'

/** Structured server error envelope mirroring `commands_controller.ts`. */
export interface CommandErrorReport {
  /** Server-side error code (e.g. `E_INVALID_COMMAND`, `E_TWEEN_OVERLAP`). */
  code: string
  /** Human message — same string we'd put in `bus.error`. */
  message: string
  /** One-liner from the rejection (`CommandRejectedError.hint`). */
  hint?: string | null
  /** Zod path/message pairs from `CommandValidationError`. */
  issues?: ReadonlyArray<{ path: string; message: string }>
  /** Post-apply `ValidationResult` from `PostValidationError`. */
  details?: ValidationResult | null
  /** HTTP status the response carried. Useful for the status pill colour. */
  status?: number
}

/** Per-target marker counts. Used by Timeline.vue. */
export interface TrackMarkerCounts {
  errors: number
  warnings: number
}

export interface ValidationApi {
  /** Empty result while no composition is loaded. */
  result: ComputedRef<ValidationResult>
  /** Most recent command error, or null when the last apply succeeded. */
  lastCommandError: Ref<CommandErrorReport | null>
  /** Map keyed by item id. Always populated even when count = 0. */
  markersByTarget: ComputedRef<ReadonlyMap<string, TrackMarkerCounts>>
  /** Effective total error count (schema + command). */
  errorCount: ComputedRef<number>
  /** Effective total warning count (schema only — commands carry errors). */
  warningCount: ComputedRef<number>

  /** Called by `useCommandBus.apply` on a non-OK response. */
  recordCommandError: (report: CommandErrorReport) => void
  /** Called by `useCommandBus.apply` on a 2xx response. */
  clearCommandError: () => void
  /** Called by `useCommandBus.apply` after composition replaces. */
  setComposition: (next: Composition | null) => void
}

const VALIDATION_KEY: InjectionKey<ValidationApi> = Symbol('davidup.validation')

// Tween id extraction for `E_TWEEN_OVERLAP` — overlap errors emit
// `path: 'tweens'` (no specific id) and stuff both tween ids in the message
// as `"id1" and "id2"`. We pull them out to map back to a target row.
const OVERLAP_IDS = /"([^"]+)"\s+and\s+"([^"]+)"/

function tweenIdsFromOverlapMessage(message: string): string[] {
  const m = OVERLAP_IDS.exec(message)
  return m ? [m[1]!, m[2]!] : []
}

// Resolve which item ids an issue affects, so the Timeline can mark rows.
// Tween-scoped issues map through `composition.tweens[].target`; item-scoped
// issues map through the item id directly. Overlap errors emit `path: 'tweens'`
// without a specific id — we parse the message to find both tween ids.
function targetsForIssue(
  issue: ValidationError | ValidationWarning,
  composition: Composition | null,
): string[] {
  if (!issue.path) return []
  const parts = issue.path.split('.')
  if (parts.length === 0) return []
  const head = parts[0]
  if (head === 'items' && typeof parts[1] === 'string') {
    return [parts[1]]
  }
  if (head === 'tweens') {
    const tweens = (composition?.tweens ?? []) as Array<{ id: string; target?: string }>
    if (typeof parts[1] === 'string') {
      const tween = tweens.find((t) => t.id === parts[1])
      return tween && typeof tween.target === 'string' ? [tween.target] : []
    }
    // Bare `tweens` path — overlap. Parse message for tween ids.
    const ids = tweenIdsFromOverlapMessage(issue.message)
    if (ids.length === 0) return []
    const targets: string[] = []
    for (const id of ids) {
      const tween = tweens.find((t) => t.id === id)
      if (tween && typeof tween.target === 'string' && !targets.includes(tween.target)) {
        targets.push(tween.target)
      }
    }
    return targets
  }
  if (head === 'layers' && typeof parts[1] === 'string') {
    // Layer-scope issues don't anchor to a single track row. Skip — the
    // status bar still shows them in the expanded panel.
    return []
  }
  return []
}

const EMPTY_RESULT: ValidationResult = { valid: true, errors: [], warnings: [] }

export function provideValidation(initial: Composition | null = null): ValidationApi {
  const composition = ref<Composition | null>(initial) as Ref<Composition | null>
  const lastCommandError = ref<CommandErrorReport | null>(null)

  const result = computed<ValidationResult>(() => {
    if (!composition.value) return EMPTY_RESULT
    return validateComposition(composition.value)
  })

  // Merge command-rejection issues into the marker calculation when the
  // server returned a `PostValidationError` (post-apply schema failure).
  // The composition we're holding may not yet reflect that failed state
  // (it was rolled back), but the `details` carry the issues anyway.
  const mergedErrors = computed<ValidationError[]>(() => {
    const base = result.value.errors.slice()
    const extra = lastCommandError.value?.details?.errors
    if (extra && extra.length > 0) base.push(...extra)
    return base
  })

  const mergedWarnings = computed<ValidationWarning[]>(() => {
    const base = result.value.warnings.slice()
    const extra = lastCommandError.value?.details?.warnings
    if (extra && extra.length > 0) base.push(...extra)
    return base
  })

  const markersByTarget = computed<ReadonlyMap<string, TrackMarkerCounts>>(() => {
    const map = new Map<string, TrackMarkerCounts>()
    const bump = (id: string, key: keyof TrackMarkerCounts) => {
      const row = map.get(id) ?? { errors: 0, warnings: 0 }
      row[key] += 1
      map.set(id, row)
    }
    for (const err of mergedErrors.value) {
      for (const id of targetsForIssue(err, composition.value)) bump(id, 'errors')
    }
    for (const warn of mergedWarnings.value) {
      for (const id of targetsForIssue(warn, composition.value)) bump(id, 'warnings')
    }
    return map
  })

  const errorCount = computed(() => mergedErrors.value.length)
  const warningCount = computed(() => mergedWarnings.value.length)

  const api: ValidationApi = {
    result,
    lastCommandError,
    markersByTarget,
    errorCount,
    warningCount,
    recordCommandError(report) {
      lastCommandError.value = report
    },
    clearCommandError() {
      lastCommandError.value = null
    },
    setComposition(next) {
      composition.value = next
    },
  }

  provide(VALIDATION_KEY, api)
  return api
}

export function useValidation(): ValidationApi {
  const api = inject(VALIDATION_KEY, null)
  if (!api) {
    throw new Error(
      'useValidation(): no ValidationApi provided. Call provideValidation() in the editor page.',
    )
  }
  return api
}

export { targetsForIssue, tweenIdsFromOverlapMessage }
