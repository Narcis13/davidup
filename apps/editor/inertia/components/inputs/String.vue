<script setup lang="ts">
// Step 09 input · string param editor.
//
// Plain text input for things like `text` body, asset id, font id. Emits
// `update:modelValue` on `change` (blur or Enter) — not on every keystroke —
// so command dispatch isn't fired mid-typing.

import { computed } from 'vue'

const props = defineProps<{
  modelValue: string | undefined
  label: string
  placeholder?: string
  overridden?: boolean
  disabled?: boolean
  /** Use a <textarea> for multi-line text bodies. */
  multiline?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const value = computed(() => props.modelValue ?? '')

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <label class="string-input" :class="{ overridden, disabled, multiline }">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </span>
    <textarea
      v-if="multiline"
      class="text"
      rows="2"
      spellcheck="false"
      :value="value"
      :placeholder="placeholder"
      :disabled="disabled"
      @change="onChange"
    />
    <input
      v-else
      type="text"
      class="text"
      spellcheck="false"
      :value="value"
      :placeholder="placeholder"
      :disabled="disabled"
      @change="onChange"
    />
  </label>
</template>

<style scoped>
.string-input {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #d4d4d4;
}

.string-input.multiline {
  align-items: start;
}

.label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #a3a3a3;
  padding-top: 4px;
}

.string-input.overridden .label-text {
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

.text {
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  padding: 4px 6px;
  border-radius: 4px;
  min-width: 0;
  width: 100%;
  resize: vertical;
}

.text:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.string-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
