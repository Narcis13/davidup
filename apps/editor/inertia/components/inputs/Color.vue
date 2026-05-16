<script setup lang="ts">
// Step 09 input · color param editor.
//
// Pairs a native <input type="color"> with a text field so the user can
// pick visually or paste a hex. Strict input contract: emits valid #rgb
// or #rrggbb strings only. Other formats (named colors, rgba) round-trip
// through the text field but the live color swatch only updates when the
// value matches `#[0-9a-fA-F]{3,8}`.

import { computed } from 'vue'

const props = defineProps<{
  modelValue: string | undefined
  label: string
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const value = computed(() => props.modelValue ?? '')

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const swatchValue = computed(() => {
  const v = value.value
  if (!v) return '#000000'
  if (HEX_RE.test(v)) {
    // Native picker requires the 7-char form. Expand `#abc` → `#aabbcc`.
    if (v.length === 4) {
      return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
    }
    if (v.length === 9) {
      return v.slice(0, 7)
    }
    return v
  }
  return '#000000'
})

function onPicker(event: Event): void {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

function onText(event: Event): void {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <label class="color-input" :class="{ overridden, disabled }">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </span>
    <span class="controls">
      <input
        type="color"
        class="picker"
        :value="swatchValue"
        :disabled="disabled"
        @input="onPicker"
      />
      <input
        type="text"
        class="text"
        spellcheck="false"
        :value="value"
        :disabled="disabled"
        @change="onText"
      />
    </span>
  </label>
</template>

<style scoped>
.color-input {
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

.label-text {
  color: inherit;
}

.color-input.overridden .label-text {
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
  min-width: 0;
}

.picker {
  flex: 0 0 28px;
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  background: #161616;
  cursor: pointer;
}

.picker::-webkit-color-swatch-wrapper {
  padding: 2px;
}
.picker::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}

.text {
  flex: 1 1 auto;
  min-width: 0;
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  padding: 4px 6px;
  border-radius: 4px;
}

.text:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.color-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
