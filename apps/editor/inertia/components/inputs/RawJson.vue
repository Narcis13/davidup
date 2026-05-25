<script setup lang="ts">
// Step 20.22 input · raw-JSON fallback editor.
//
// The Inspector's registry maps known Zod-meta types to typed inputs. Any
// field whose `kind` isn't in the registry — or whose schema is opaque —
// falls through to this component so authors can still tweak the value
// without dropping out to the source drawer (closes PRD R2: "unknown
// types should never block editing").
//
// Validation is deliberately local: we parse on blur, surface a small
// inline error when JSON.parse throws, and only emit `update:modelValue`
// once the buffer parses cleanly. Tab-leaving with invalid text restores
// the last good buffer so the field can't lie about its current state.

import { computed, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: unknown
  label: string
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: unknown): void
}>()

function formatJson(v: unknown): string {
  if (v === undefined) return ''
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return ''
  }
}

const buffer = ref<string>(formatJson(props.modelValue))
const error = ref<string | null>(null)
const dirty = ref(false)

// External updates (apply succeeded, item replaced) reset the buffer
// unless the user is mid-edit — in that case their unsubmitted text
// stays put.
watch(
  () => props.modelValue,
  (next) => {
    if (dirty.value) return
    buffer.value = formatJson(next)
    error.value = null
  },
)

const rows = computed(() => Math.min(8, Math.max(2, buffer.value.split('\n').length)))

function onInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement
  buffer.value = target.value
  dirty.value = true
  error.value = null
}

function commit(): void {
  if (!dirty.value) return
  const text = buffer.value.trim()
  if (text === '') {
    error.value = null
    dirty.value = false
    emit('update:modelValue', undefined)
    return
  }
  try {
    const parsed = JSON.parse(text) as unknown
    error.value = null
    dirty.value = false
    emit('update:modelValue', parsed)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Invalid JSON'
  }
}

function onBlur(): void {
  commit()
}

function onKeyDown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    commit()
  }
}
</script>

<template>
  <label class="rawjson-input" :class="{ overridden, disabled, 'has-error': !!error }">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
      <span class="hint" aria-hidden="true">JSON</span>
    </span>
    <span class="controls">
      <textarea
        class="text"
        spellcheck="false"
        :rows="rows"
        :value="buffer"
        :disabled="disabled"
        data-testid="rawjson-textarea"
        @input="onInput"
        @blur="onBlur"
        @keydown="onKeyDown"
      />
      <span v-if="error" class="error" role="alert">{{ error }}</span>
    </span>
  </label>
</template>

<style scoped>
.rawjson-input {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: start;
  gap: 8px;
  font-size: 12px;
  color: #d4d4d4;
}

.label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #a3a3a3;
  padding-top: 4px;
}

.hint {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #707070;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 1px 4px;
  border-radius: 3px;
}

.rawjson-input.overridden .label-text {
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
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.text {
  background: #0d0d10;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  line-height: 1.45;
  padding: 6px 8px;
  border-radius: 4px;
  min-width: 0;
  width: 100%;
  resize: vertical;
  white-space: pre;
  overflow-x: auto;
}

.text:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.rawjson-input.has-error .text {
  border-color: rgba(255, 107, 107, 0.45);
}

.error {
  font-size: 11px;
  color: #ff6b6b;
}

.rawjson-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
