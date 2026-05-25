<script setup lang="ts">
// Step 09 input · enum param editor.
//
// Renders a <select> over a fixed option list. Used for `align`, `kind`,
// `easing`, etc. Caller passes either string options or `{label, value}`
// objects so the displayed text can differ from the wire value.

import { computed } from 'vue'

export type EnumOption = string | { label: string; value: string }

const props = defineProps<{
  modelValue: string | undefined
  label: string
  options: ReadonlyArray<EnumOption>
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const value = computed(() => props.modelValue ?? '')

const normalised = computed(() =>
  props.options.map((opt) =>
    typeof opt === 'string' ? { label: opt, value: opt } : opt,
  ),
)

function onChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <label class="enum-input" :class="{ overridden, disabled }">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </span>
    <select
      class="select"
      :value="value"
      :disabled="disabled"
      @change="onChange"
    >
      <option v-for="opt in normalised" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.enum-input {
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

.enum-input.overridden .label-text {
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

.select {
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  padding: 4px 6px;
  border-radius: 4px;
  min-width: 0;
}

.select:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.enum-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
