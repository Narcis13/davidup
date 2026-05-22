<script setup lang="ts">
// CompositionSettingsDialog — UX_GAPS §D.
//
// Exposes `composition.composition` (width / height / fps / duration /
// background) to humans. Dispatches one `set_composition_property` per
// changed field — the command accepts a single property/value pair, so
// the batching is purely UI-side. Mirrors styling from
// SaveDefinitionDialog.vue so dialogs feel uniform.

import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import type { Command, Composition } from '~/composables/useCommandBus'

interface CompositionMeta {
  width: number
  height: number
  fps: number
  duration: number
  background: string
}

const props = defineProps<{
  open: boolean
  composition: Composition | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'apply', command: Command): void
}>()

const width = ref(1280)
const height = ref(720)
const fps = ref(60)
const duration = ref(1)
const background = ref('#000000')
const errorMsg = ref<string | null>(null)
const widthInput = ref<HTMLInputElement | null>(null)

const meta = computed<CompositionMeta | null>(() => {
  const c = props.composition?.composition as unknown as CompositionMeta | undefined
  if (!c) return null
  return c
})

function syncFromComposition(): void {
  const m = meta.value
  if (!m) return
  width.value = m.width
  height.value = m.height
  fps.value = m.fps
  duration.value = m.duration
  background.value = normalizeColor(m.background ?? '#000000')
  errorMsg.value = null
}

// Coerce engine-accepted color strings (named colors, rgb(), 8-digit hex)
// into the 6-digit hex an `<input type="color">` understands. Anything that
// doesn't parse falls back to black so the picker stays usable.
function normalizeColor(raw: string): string {
  if (typeof raw !== 'string') return '#000000'
  const v = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1]
    const g = v[2]
    const b = v[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 7).toLowerCase()
  return '#000000'
}

watch(
  () => props.open,
  (next) => {
    if (!next) return
    syncFromComposition()
    nextTick(() => widthInput.value?.focus())
  },
)

const canSubmit = computed(() => {
  if (!meta.value) return false
  return (
    Number.isFinite(width.value) &&
    width.value > 0 &&
    Number.isInteger(width.value) &&
    Number.isFinite(height.value) &&
    height.value > 0 &&
    Number.isInteger(height.value) &&
    Number.isFinite(fps.value) &&
    fps.value > 0 &&
    Number.isFinite(duration.value) &&
    duration.value >= 0 &&
    background.value.length > 0
  )
})

function submit(): void {
  errorMsg.value = null
  const m = meta.value
  if (!m) {
    errorMsg.value = 'No composition loaded.'
    return
  }
  if (!canSubmit.value) {
    errorMsg.value =
      'Width / height must be positive integers; fps must be > 0; duration must be ≥ 0.'
    return
  }
  // Emit one command per changed property — `set_composition_property`
  // takes a single property/value pair per call (see commands.ts:107).
  // The bus serialises them; the server applies in order; each lands as
  // an undo entry. Keeps every field independently revertable.
  const changes: Array<{ property: CompositionMeta extends infer T ? keyof T : never; value: number | string }> = []
  if (width.value !== m.width) changes.push({ property: 'width', value: width.value })
  if (height.value !== m.height) changes.push({ property: 'height', value: height.value })
  if (fps.value !== m.fps) changes.push({ property: 'fps', value: fps.value })
  if (duration.value !== m.duration) changes.push({ property: 'duration', value: duration.value })
  if (normalizeColor(m.background ?? '') !== background.value)
    changes.push({ property: 'background', value: background.value })

  for (const c of changes) {
    emit('apply', {
      kind: 'set_composition_property',
      payload: { property: c.property as string, value: c.value },
      source: 'ui',
    })
  }
  emit('close')
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="comp-settings-title"
    data-testid="composition-settings-dialog"
    @click="onBackdropClick"
  >
    <div class="dialog">
      <header class="dialog-head">
        <h2 id="comp-settings-title" class="dialog-title">Composition settings</h2>
        <button
          type="button"
          class="dialog-close"
          aria-label="Close"
          data-testid="comp-settings-close"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <form class="dialog-body" @submit.prevent="submit">
        <div class="row two">
          <label class="field">
            <span class="label">Width (px)</span>
            <input
              ref="widthInput"
              v-model.number="width"
              class="input"
              type="number"
              min="1"
              step="1"
              data-testid="comp-settings-width"
            />
          </label>
          <label class="field">
            <span class="label">Height (px)</span>
            <input
              v-model.number="height"
              class="input"
              type="number"
              min="1"
              step="1"
              data-testid="comp-settings-height"
            />
          </label>
        </div>

        <div class="row two">
          <label class="field">
            <span class="label">FPS</span>
            <input
              v-model.number="fps"
              class="input"
              type="number"
              min="1"
              step="1"
              data-testid="comp-settings-fps"
            />
          </label>
          <label class="field">
            <span class="label">Duration (s)</span>
            <input
              v-model.number="duration"
              class="input"
              type="number"
              min="0"
              step="0.1"
              data-testid="comp-settings-duration"
            />
          </label>
        </div>

        <div class="field">
          <span class="label">Background</span>
          <div class="bg-row">
            <input
              v-model="background"
              type="color"
              class="color"
              data-testid="comp-settings-background-picker"
            />
            <input
              v-model="background"
              class="input bg-text"
              type="text"
              spellcheck="false"
              placeholder="#000000"
              data-testid="comp-settings-background-text"
            />
          </div>
          <span class="hint">
            Any color string the engine accepts (e.g. <code>#0a0a0a</code>, <code>black</code>,
            <code>rgb(10,10,10)</code>). The picker only writes 6-digit hex.
          </span>
        </div>

        <p v-if="errorMsg" class="error" role="alert" data-testid="comp-settings-error">
          {{ errorMsg }}
        </p>

        <footer class="dialog-foot">
          <button
            type="button"
            class="btn btn-ghost"
            data-testid="comp-settings-cancel"
            @click="emit('close')"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="!canSubmit"
            data-testid="comp-settings-submit"
          >
            Apply
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-items: center;
  z-index: 50;
  padding: 24px;
  backdrop-filter: blur(2px);
}

.dialog {
  width: min(480px, 100%);
  max-height: 100%;
  background: #111;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
  color: #e5e5e5;
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.dialog-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.dialog-close {
  background: transparent;
  border: none;
  color: #a3a3a3;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.dialog-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e5e5e5;
}

.dialog-body {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}

.row.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.label {
  font-size: 11px;
  color: #a3a3a3;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.input {
  width: 100%;
  box-sizing: border-box;
  background: #0a0a0a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e5e5e5;
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 5px;
  outline: none;
  transition: border-color 120ms ease;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

.input:focus {
  border-color: rgba(91, 124, 250, 0.7);
  box-shadow: 0 0 0 3px rgba(91, 124, 250, 0.18);
}

.bg-row {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 8px;
  align-items: center;
}

.color {
  width: 44px;
  height: 34px;
  padding: 0;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  cursor: pointer;
}

.bg-text {
  font-size: 13px;
}

.hint {
  font-size: 11px;
  color: #808080;
}

.hint code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.error {
  margin: 0;
  font-size: 12px;
  color: #ff6b6b;
}

.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 8px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-primary {
  background: #5b7cfa;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #6e8cff;
}

.btn-ghost {
  background: transparent;
  color: #c5c5c5;
  border-color: rgba(255, 255, 255, 0.1);
}

.btn-ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.2);
}
</style>
