<script setup lang="ts">
// Step 09 input · time param editor.
//
// Specialised number input for "seconds" values: shows a `s` suffix, uses
// 0.05s steps by default, and clamps to non-negative. The Inspector uses
// this for any field semantically describing a duration / time offset.
//
// The spinner is buffered locally so multi-digit typing isn't clobbered by
// the modelValue prop flowing back per keystroke — see Number.vue.

import { computed, ref } from 'vue'

const props = defineProps<{
  modelValue: number | undefined
  label: string
  /** Override the smallest editable increment. Default 0.05s. */
  step?: number
  /** Upper bound (e.g. composition duration). Optional. */
  max?: number
  /** Hint shown when modelValue is undefined (e.g. for optional lifespan fields). */
  placeholder?: string
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: number): void
}>()

const step = computed(() => props.step ?? 0.05)
// Locale-independent display — see Number.vue for context. When modelValue
// is undefined (optional field that hasn't been set), render empty so the
// placeholder shows instead of a misleading "0".
const displayValue = computed(() =>
  props.modelValue === undefined ? '' : String(props.modelValue),
)

const buffer = ref(displayValue.value)
const focused = ref(false)
const spinnerDisplay = computed(() => (focused.value ? buffer.value : displayValue.value))

function parseAndEmit(raw: string): void {
  if (raw === '') return
  const next = Number(raw.replace(',', '.'))
  if (!Number.isFinite(next)) return
  const clamped = Math.max(0, props.max !== undefined ? Math.min(props.max, next) : next)
  if (clamped !== props.modelValue) emit('update:modelValue', clamped)
}

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement
  buffer.value = target.value
}

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement
  parseAndEmit(target.value)
}

function onFocus(event: FocusEvent): void {
  buffer.value = displayValue.value
  focused.value = true
  ;(event.target as HTMLInputElement).select()
}

function onBlur(): void {
  focused.value = false
  buffer.value = displayValue.value
}
</script>

<template>
  <label class="time-input" :class="{ overridden, disabled }">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </span>
    <span class="controls">
      <input
        type="text"
        inputmode="decimal"
        class="spinner"
        :value="spinnerDisplay"
        :placeholder="placeholder"
        :disabled="disabled"
        @input="onInput"
        @change="onChange"
        @focus="onFocus"
        @blur="onBlur"
      />
      <span class="suffix">s</span>
    </span>
  </label>
</template>

<style scoped>
.time-input {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #d4d4d4;
}

.label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #a3a3a3;
}

.time-input.overridden .label-text {
  color: #f5f5f5;
}

.override-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ff8a3d;
  flex: 0 0 auto;
}

.controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spinner {
  flex: 0 0 88px;
  width: 88px;
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  padding: 4px 6px;
  border-radius: 4px;
  font-feature-settings: 'tnum';
}

.spinner:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.suffix {
  color: #707070;
  font-size: 11px;
  text-transform: lowercase;
}

.time-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
