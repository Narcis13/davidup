<script setup lang="ts">
// StatusBar — step 20.15 of the editor build plan (FR-14).
//
// Sits below the timeline at the bottom of `EditorLayout`. Shows:
//   • error count   — red,    runs `validateComposition` on the current
//                     composition.
//   • warning count — yellow, same source.
//   • current selection id, playhead time, render status.
//
// Clicking the error count toggles an expanded panel showing every
// ValidationResult issue. Each issue is clickable — emits `reveal-issue`
// with the resolved JSON pointer + path so the page can drive the
// SourceDrawer to the right line.

import { computed, ref, watch } from 'vue'
import type { ValidationError, ValidationWarning } from 'davidup/schema'
import { encodePtrToken } from '~/composables/jsonPointerLines'
import { useRender } from '~/composables/useRender'
import { useValidation } from '~/composables/useValidation'
import type { Composition } from '~/composables/useCommandBus'
import type { StageStatus } from '~/composables/useStage'

const props = defineProps<{
  composition: Composition | null
  playhead: number
  selectedItemId: string | null
  stageStatus: StageStatus | null
  stageError: string | null
}>()

const emit = defineEmits<{
  (event: 'reveal-issue', payload: { jsonPointer: string | null; path: string | undefined }): void
}>()

const expanded = ref(false)

// Step 20.16 — pull the validated state from the shared composable instead
// of running validateComposition() here. Same result, but the Timeline now
// shares the work and we can also display the structured command error
// (code, hint, issues) from the most recent rejected write.
const validationApi = useValidation()
const validation = validationApi.result

// Merge schema + command-error issues so the panel shows everything.
const allErrors = computed<ValidationError[]>(() => {
  const errs = validation.value.errors.slice()
  const detail = validationApi.lastCommandError.value?.details
  if (detail?.errors?.length) errs.push(...detail.errors)
  return errs
})
const allWarnings = computed<ValidationWarning[]>(() => {
  const warns = validation.value.warnings.slice()
  const detail = validationApi.lastCommandError.value?.details
  if (detail?.warnings?.length) warns.push(...detail.warnings)
  return warns
})

const errorCount = computed(() => allErrors.value.length)
const warningCount = computed(() => allWarnings.value.length)
const commandError = computed(() => validationApi.lastCommandError.value)

// Auto-collapse the panel when there's nothing to show (no schema issues
// AND no command error to surface).
watch(
  [errorCount, warningCount, commandError],
  ([e, w, cmd]) => {
    if (e === 0 && w === 0 && !cmd) expanded.value = false
  },
)

const render = useRender()

const renderLabel = computed<string>(() => {
  const job = render.current.value
  if (!job) return 'Render: idle'
  switch (job.status) {
    case 'pending':
      return 'Render: queued'
    case 'running':
      return `Render: ${job.frame}/${job.totalFrames}`
    case 'done':
      return 'Render: done'
    case 'error':
      return 'Render: error'
  }
  return 'Render: idle'
})

const renderTone = computed<'idle' | 'busy' | 'done' | 'error'>(() => {
  const job = render.current.value
  if (!job) return 'idle'
  if (job.status === 'done') return 'done'
  if (job.status === 'error') return 'error'
  return 'busy'
})

const playheadLabel = computed<string>(() => {
  const t = Number.isFinite(props.playhead) ? props.playhead : 0
  const dur = props.composition?.composition?.duration
  if (typeof dur === 'number' && Number.isFinite(dur)) {
    return `${t.toFixed(2)}s / ${dur.toFixed(2)}s`
  }
  return `${t.toFixed(2)}s`
})

const stageLabel = computed<string>(() => {
  if (props.stageError) return `Stage: ${props.stageStatus ?? 'error'} (${props.stageError})`
  return props.stageStatus ? `Stage: ${props.stageStatus}` : 'Stage: idle'
})

function pathToPointer(
  path: string | undefined,
  composition: Composition | null,
): string | null {
  if (!path || !composition) return null
  if (path === 'tweens') return '/tweens'
  const parts = path.split('.')
  if (parts.length === 0) return null
  const head = parts[0]
  const rest = parts.slice(2).map(encodePtrToken)
  if (head === 'items' && typeof parts[1] === 'string') {
    const tail = rest.length > 0 ? `/${rest.join('/')}` : ''
    return `/items/${encodePtrToken(parts[1])}${tail}`
  }
  if (head === 'tweens' && typeof parts[1] === 'string') {
    const idx = composition.tweens.findIndex((t) => t.id === parts[1])
    if (idx < 0) return null
    const tail = rest.length > 0 ? `/${rest.join('/')}` : ''
    return `/tweens/${idx}${tail}`
  }
  if (head === 'layers' && typeof parts[1] === 'string') {
    const idx = composition.layers.findIndex((l) => l.id === parts[1])
    if (idx < 0) return null
    const tail = rest.length > 0 ? `/${rest.join('/')}` : ''
    return `/layers/${idx}${tail}`
  }
  return null
}

function toggle(): void {
  if (errorCount.value === 0 && warningCount.value === 0 && !commandError.value) return
  expanded.value = !expanded.value
}

function onIssueClick(issue: ValidationError | ValidationWarning): void {
  const ptr = pathToPointer(issue.path, props.composition)
  emit('reveal-issue', { jsonPointer: ptr, path: issue.path })
}
</script>

<template>
  <div class="status-bar" data-testid="status-bar">
    <div class="status-bar-row">
      <button
        type="button"
        class="status-pill error"
        :class="{ inactive: errorCount === 0 && !commandError, active: expanded }"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-disabled="errorCount === 0 && warningCount === 0 && !commandError ? 'true' : 'false'"
        data-testid="status-bar-error-count"
        :title="errorCount > 0 ? `${errorCount} validation error${errorCount === 1 ? '' : 's'} — click for details` : commandError ? `Command rejected: ${commandError.code} — click for details` : 'No validation errors'"
        @click="toggle"
      >
        <span class="dot" aria-hidden="true" />
        <span class="label">{{ errorCount }} error{{ errorCount === 1 ? '' : 's' }}</span>
      </button>

      <button
        type="button"
        class="status-pill warning"
        :class="{ inactive: warningCount === 0, active: expanded }"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-disabled="errorCount === 0 && warningCount === 0 && !commandError ? 'true' : 'false'"
        data-testid="status-bar-warning-count"
        :title="warningCount > 0 ? `${warningCount} validation warning${warningCount === 1 ? '' : 's'} — click for details` : 'No validation warnings'"
        @click="toggle"
      >
        <span class="dot" aria-hidden="true" />
        <span class="label">{{ warningCount }} warning{{ warningCount === 1 ? '' : 's' }}</span>
      </button>

      <span
        v-if="commandError"
        class="status-text command-error"
        data-testid="status-bar-command-error"
        :title="commandError.hint || commandError.message"
      >
        <span class="text-label">Rejected:</span>
        <span class="text-value mono">{{ commandError.code }}</span>
      </span>

      <span class="divider" aria-hidden="true" />

      <span
        class="status-text selection"
        data-testid="status-bar-selection"
        :title="selectedItemId ? `Selected item: ${selectedItemId}` : 'No selection'"
      >
        <span class="text-label">Selection:</span>
        <span class="text-value mono">{{ selectedItemId ?? '—' }}</span>
      </span>

      <span
        class="status-text playhead"
        data-testid="status-bar-playhead"
      >
        <span class="text-label">Playhead:</span>
        <span class="text-value mono">{{ playheadLabel }}</span>
      </span>

      <span
        class="status-text stage"
        :data-tone="stageError ? 'error' : 'normal'"
        data-testid="status-bar-stage"
      >
        <span class="text-label">{{ stageLabel }}</span>
      </span>

      <span class="spacer" />

      <span
        class="status-text render"
        :data-tone="renderTone"
        data-testid="status-bar-render"
      >
        <span class="render-dot" aria-hidden="true" />
        <span class="text-value">{{ renderLabel }}</span>
      </span>
    </div>

    <div
      v-if="expanded && (errorCount > 0 || warningCount > 0 || commandError)"
      class="issues-panel"
      role="region"
      aria-label="Validation issues"
      data-testid="status-bar-issues-panel"
    >
      <div class="issues-head">
        <span>Validation</span>
        <button
          type="button"
          class="close-btn"
          aria-label="Close issues panel"
          data-testid="status-bar-issues-close"
          @click="expanded = false"
        >
          ×
        </button>
      </div>

      <div
        v-if="commandError"
        class="command-error-panel"
        data-testid="status-bar-command-error-panel"
      >
        <div class="command-error-head">
          <span class="issue-badge error">{{ commandError.code }}</span>
          <span class="command-error-message">{{ commandError.message }}</span>
          <span class="command-error-status mono">HTTP {{ commandError.status }}</span>
        </div>
        <p v-if="commandError.hint" class="command-error-hint">{{ commandError.hint }}</p>
        <ul
          v-if="commandError.issues && commandError.issues.length > 0"
          class="command-error-issues"
        >
          <li
            v-for="(zissue, idx) in commandError.issues"
            :key="`zissue-${idx}`"
            class="issue-row error"
            :data-testid="`status-bar-command-issue-${idx}`"
          >
            <span class="issue-badge error">field</span>
            <span class="issue-message">{{ zissue.message }}</span>
            <span v-if="zissue.path" class="issue-path mono">{{ zissue.path }}</span>
          </li>
        </ul>
      </div>

      <ul v-if="allErrors.length > 0" class="issues-list">
        <li
          v-for="(issue, idx) in allErrors"
          :key="`err-${idx}`"
          class="issue-row error"
          :data-testid="`status-bar-issue-error-${idx}`"
          tabindex="0"
          @click="onIssueClick(issue)"
          @keydown.enter.prevent="onIssueClick(issue)"
          @keydown.space.prevent="onIssueClick(issue)"
        >
          <span class="issue-badge error">{{ issue.code }}</span>
          <span class="issue-message">{{ issue.message }}</span>
          <span v-if="issue.path" class="issue-path mono">{{ issue.path }}</span>
        </li>
      </ul>
      <ul v-if="allWarnings.length > 0" class="issues-list">
        <li
          v-for="(issue, idx) in allWarnings"
          :key="`warn-${idx}`"
          class="issue-row warning"
          :data-testid="`status-bar-issue-warning-${idx}`"
          tabindex="0"
          @click="onIssueClick(issue)"
          @keydown.enter.prevent="onIssueClick(issue)"
          @keydown.space.prevent="onIssueClick(issue)"
        >
          <span class="issue-badge warning">{{ issue.code }}</span>
          <span class="issue-message">{{ issue.message }}</span>
          <span v-if="issue.path" class="issue-path mono">{{ issue.path }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  position: relative;
  background: #0d0d0d;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  color: #d4d4d4;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  font-size: 11px;
  flex: 0 0 auto;
}

.status-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  height: 24px;
  min-height: 24px;
  white-space: nowrap;
  overflow: hidden;
}

.status-pill {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  color: inherit;
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
  flex: 0 0 auto;
}

.status-pill[aria-disabled='true'] {
  cursor: default;
}

.status-pill .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
}

.status-pill .label {
  font-feature-settings: 'tnum';
}

.status-pill.error {
  color: #ff6b6b;
  background: rgba(255, 107, 107, 0.1);
  border-color: rgba(255, 107, 107, 0.3);
}

.status-pill.error.inactive {
  color: #707070;
  background: transparent;
  border-color: rgba(255, 255, 255, 0.06);
}

.status-pill.warning {
  color: #f4c66e;
  background: rgba(244, 198, 110, 0.1);
  border-color: rgba(244, 198, 110, 0.3);
}

.status-pill.warning.inactive {
  color: #707070;
  background: transparent;
  border-color: rgba(255, 255, 255, 0.06);
}

.status-pill:not(.inactive):hover {
  filter: brightness(1.18);
}

.status-pill.active:not(.inactive) {
  filter: brightness(1.25);
  box-shadow: inset 0 0 0 1px currentColor;
}

.divider {
  display: inline-block;
  width: 1px;
  height: 14px;
  background: rgba(255, 255, 255, 0.1);
  flex: 0 0 auto;
}

.status-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #c8c8c8;
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
}

.text-label {
  color: #909090;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 10px;
}

.text-value {
  color: #e5e5e5;
}

.mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-feature-settings: 'tnum';
}

.spacer {
  flex: 1 1 auto;
  min-width: 0;
}

.status-text.stage[data-tone='error'] .text-label {
  color: #ff8a8a;
  text-transform: none;
  letter-spacing: 0;
  font-size: 11px;
}

.status-text.render {
  font-size: 11px;
}

.render-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #707070;
  display: inline-block;
}

.status-text.render[data-tone='busy'] .render-dot {
  background: #f4c66e;
  animation: render-pulse 1.1s ease-in-out infinite;
}

.status-text.render[data-tone='done'] .render-dot {
  background: #7fcb9a;
}

.status-text.render[data-tone='error'] .render-dot {
  background: #ff6b6b;
}

@keyframes render-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

.issues-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  background: #131313;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.45);
  max-height: 220px;
  overflow-y: auto;
  z-index: 25;
}

.issues-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a3a3a3;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  position: sticky;
  top: 0;
}

.close-btn {
  appearance: none;
  background: transparent;
  border: none;
  color: #d4d4d4;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 4px;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.issues-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

.issue-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 120ms ease;
  font-size: 11.5px;
}

.issue-row:hover,
.issue-row:focus-visible {
  background: rgba(91, 124, 250, 0.1);
  outline: none;
}

.issue-badge {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid currentColor;
  background: transparent;
}

.issue-badge.error {
  color: #ff6b6b;
}

.issue-badge.warning {
  color: #f4c66e;
}

.issue-message {
  color: #e5e5e5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.issue-path {
  color: #909090;
  font-size: 10.5px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}

.status-text.command-error {
  color: #ff8a8a;
}

.status-text.command-error .text-label {
  color: #ff8a8a;
}

.status-text.command-error .text-value {
  color: #ffd5d5;
}

.command-error-panel {
  padding: 6px 12px 8px;
  background: rgba(255, 107, 107, 0.06);
  border-bottom: 1px solid rgba(255, 107, 107, 0.18);
}

.command-error-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.command-error-message {
  color: #ffe5e5;
  font-size: 12px;
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.command-error-status {
  color: #b07070;
  font-size: 10.5px;
}

.command-error-hint {
  margin: 4px 0 0;
  color: #c5a8a8;
  font-size: 11.5px;
}

.command-error-issues {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  border-top: 1px dashed rgba(255, 107, 107, 0.18);
}
</style>
