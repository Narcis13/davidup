<script setup lang="ts">
// v1.1 S14 input · text drop shadow editor.
//
// Compound value `{ color, blur?, offsetX?, offsetY? }` (engine
// TextShadowSchema). A checkbox toggles the shadow on/off: off emits `null`,
// which `update_item` treats as "remove the shadow"; on seeds a visible
// default. Each sub-field edit emits the whole object so one change is one
// `update_item`. Number sub-fields commit on `change` (Enter / blur), like the
// Number input's spinner, so typing isn't clobbered by the echo.

import { computed } from 'vue'

// Mirrors TextShadowSchema in app/types/commands.ts (client code doesn't
// import server types — see useCommandBus.ts).
interface TextShadow {
  color: string
  blur?: number
  offsetX?: number
  offsetY?: number
}

const props = defineProps<{
  modelValue: TextShadow | null | undefined
  label: string
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: TextShadow | null): void
}>()

const DEFAULT_SHADOW: TextShadow = { color: '#000000', blur: 8, offsetX: 0, offsetY: 4 }

const shadow = computed<TextShadow | null>(() => props.modelValue ?? null)
const enabled = computed(() => shadow.value !== null)

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const swatchValue = computed(() => {
  const v = shadow.value?.color ?? ''
  if (!HEX_RE.test(v)) return '#000000'
  if (v.length === 4) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return v.slice(0, 7)
})

function onToggle(event: Event): void {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.checked ? { ...DEFAULT_SHADOW } : null)
}

function patch(next: Partial<TextShadow>): void {
  if (!shadow.value) return
  emit('update:modelValue', { ...shadow.value, ...next })
}

function onColor(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  if (value !== '') patch({ color: value })
}

function onNumber(key: 'blur' | 'offsetX' | 'offsetY', event: Event): void {
  const target = event.target as HTMLInputElement
  const next = Number(target.value.replace(',', '.'))
  if (target.value === '' || !Number.isFinite(next) || (key === 'blur' && next < 0)) {
    target.value = String(shadow.value?.[key] ?? 0)
    return
  }
  patch({ [key]: next })
}
</script>

<template>
  <div class="shadow-input" :class="{ overridden, disabled }" data-testid="shadow-input">
    <label class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </label>
    <div class="controls">
      <label class="toggle">
        <input
          type="checkbox"
          class="checkbox"
          data-testid="shadow-toggle"
          :checked="enabled"
          :disabled="disabled"
          @change="onToggle"
        />
        <span class="state">{{ enabled ? 'on' : 'off' }}</span>
      </label>
      <div v-if="shadow" class="grid">
        <label class="sub">
          <span class="sub-label">color</span>
          <span class="color">
            <input
              type="color"
              class="picker"
              :value="swatchValue"
              :disabled="disabled"
              @input="onColor"
            />
            <input
              type="text"
              class="text"
              spellcheck="false"
              data-testid="shadow-color"
              :value="shadow.color"
              :disabled="disabled"
              @change="onColor"
            />
          </span>
        </label>
        <label v-for="key in (['blur', 'offsetX', 'offsetY'] as const)" :key="key" class="sub">
          <span class="sub-label">{{ key }}</span>
          <input
            type="text"
            inputmode="decimal"
            class="text num"
            :data-testid="`shadow-${key}`"
            :value="String(shadow[key] ?? 0)"
            :disabled="disabled"
            @change="(e) => onNumber(key, e)"
          />
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shadow-input {
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
  padding-top: 2px;
}

.shadow-input.overridden .label-text {
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
  gap: 6px;
  min-width: 0;
}

.toggle {
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

.state {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #707070;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.sub {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sub:first-child {
  grid-column: 1 / -1;
}

.sub-label {
  font-size: 11px;
  color: #707070;
}

.color {
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

.num {
  font-feature-settings: 'tnum';
}

.text:focus,
.checkbox:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.shadow-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
