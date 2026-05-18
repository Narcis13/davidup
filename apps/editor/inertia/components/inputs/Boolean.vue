<script setup lang="ts">
// Step 20.22 input · boolean param editor.
//
// Mirrors the shape of String/Enum/Number inputs (label + override dot +
// control column) so the field grid stays aligned. Emits
// `update:modelValue` on every toggle so the Inspector can dispatch a
// single `update_item` per click.

import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean | undefined
  label: string
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
}>()

const checked = computed(() => Boolean(props.modelValue))

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.checked)
}
</script>

<template>
  <label class="boolean-input" :class="{ overridden, disabled }">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </span>
    <span class="controls">
      <input
        type="checkbox"
        class="checkbox"
        :checked="checked"
        :disabled="disabled"
        @change="onChange"
      />
      <span class="state">{{ checked ? 'true' : 'false' }}</span>
    </span>
  </label>
</template>

<style scoped>
.boolean-input {
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

.boolean-input.overridden .label-text {
  color: #f5f5f5;
}

.controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.checkbox {
  appearance: none;
  width: 14px;
  height: 14px;
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 3px;
  cursor: pointer;
  position: relative;
  flex: 0 0 auto;
}

.checkbox:checked {
  background: #5b7cfa;
  border-color: #5b7cfa;
}

.checkbox:checked::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 4px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.checkbox:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.state {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #707070;
}

.boolean-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
