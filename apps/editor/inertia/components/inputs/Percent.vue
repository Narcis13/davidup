<script setup lang="ts">
// Step 20.22 input · percent param editor.
//
// Wraps Number's range+spinner pair but presents the value as a percent
// (0-100) while preserving the underlying 0-1 wire format. Useful for
// `opacity`, weight knobs, etc., where authors think in percent but the
// composition stores a fraction.

import { computed } from 'vue'

const props = defineProps<{
  modelValue: number | undefined
  label: string
  /** Display step in percent points (default 1). */
  step?: number
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: number): void
}>()

const step = computed(() => props.step ?? 1)
const percent = computed(() => Math.round(((props.modelValue ?? 0) * 100) * 1000) / 1000)
// Locale-independent display — see Number.vue for context.
const percentDisplay = computed(() => String(percent.value))

function emitFromPercent(rawPct: number): void {
  if (!Number.isFinite(rawPct)) return
  const clamped = Math.max(0, Math.min(100, rawPct))
  const next = Math.round((clamped / 100) * 100000) / 100000
  emit('update:modelValue', next)
}

function onSliderInput(event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value === '') return
  emitFromPercent(Number(target.value))
}

function onNumberInput(event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value === '') return
  emitFromPercent(Number(target.value.replace(',', '.')))
}
</script>

<template>
  <label class="percent-input" :class="{ overridden, disabled }">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </span>
    <span class="controls">
      <input
        type="range"
        class="slider"
        :value="percent"
        min="0"
        max="100"
        :step="step"
        :disabled="disabled"
        @input="onSliderInput"
      />
      <span class="spinner-wrap">
        <input
          type="text"
          inputmode="decimal"
          class="spinner"
          :value="percentDisplay"
          :disabled="disabled"
          @input="onNumberInput"
        />
        <span class="unit" aria-hidden="true">%</span>
      </span>
    </span>
  </label>
</template>

<style scoped>
.percent-input {
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

.override-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ff8a3d;
  flex: 0 0 auto;
}

.percent-input.overridden .label-text {
  color: #f5f5f5;
}

.controls {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.slider {
  flex: 1 1 auto;
  min-width: 0;
  accent-color: #5b7cfa;
}

.spinner-wrap {
  position: relative;
  flex: 0 0 72px;
  width: 72px;
}

.spinner {
  width: 100%;
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  padding: 4px 18px 4px 6px;
  border-radius: 4px;
  font-feature-settings: 'tnum';
}

.unit {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: #707070;
  pointer-events: none;
}

.spinner:focus,
.slider:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.percent-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
