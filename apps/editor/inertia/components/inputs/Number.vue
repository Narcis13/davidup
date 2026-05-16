<script setup lang="ts">
// Step 09 input · numeric param editor.
//
// One row in the Inspector. Renders a label, an optional override dot
// (rendered by the parent), and a paired range + number input so the
// user can either scrub or type. Emits `update:modelValue` on every
// change so the Inspector can dispatch `updateItem` commands.

import { computed } from 'vue'

const props = defineProps<{
  modelValue: number | undefined
  label: string
  min?: number
  max?: number
  step?: number
  /** Show a slider next to the spinner. Default: only when min & max are defined. */
  slider?: boolean
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: number): void
}>()

const showSlider = computed(() =>
  props.slider !== undefined
    ? props.slider
    : props.min !== undefined && props.max !== undefined,
)

const step = computed(() => props.step ?? 1)
const value = computed(() => (props.modelValue ?? 0))

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value === '') return
  const next = Number(target.value)
  if (!Number.isFinite(next)) return
  emit('update:modelValue', next)
}
</script>

<template>
  <label class="number-input" :class="{ overridden, disabled }">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </span>
    <span class="controls">
      <input
        v-if="showSlider"
        type="range"
        class="slider"
        :value="value"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        @input="onInput"
      />
      <input
        type="number"
        class="spinner"
        :value="value"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        @input="onInput"
      />
    </span>
  </label>
</template>

<style scoped>
.number-input {
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

.number-input.overridden .label-text {
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

.spinner {
  flex: 0 0 72px;
  width: 72px;
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  padding: 4px 6px;
  border-radius: 4px;
  font-feature-settings: 'tnum';
}

.spinner:focus,
.slider:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.number-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
