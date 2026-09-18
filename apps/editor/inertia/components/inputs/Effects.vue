<script setup lang="ts">
// v1.1 S21 input · per-item effects stack editor.
//
// Value is the item's ordered `effects` list (engine EffectSchema):
//   { type: 'blur', radius } | { type: 'shadow', color, blur?, offsetX?, offsetY? }
//   | { type: 'glow', color, radius }
// Every edit emits the whole list, so one change is one `update_item`; an
// emptied list emits `null`, which `update_item` treats as "remove effects".
// Order matters (each effect applies to the result of the one above it), so
// rows can be moved up and down. Number sub-fields commit on `change`
// (Enter / blur), like the Shadow input, so typing isn't clobbered by the
// echo. Tweening an effect parameter (`effects.<i>.<field>`) is done with
// add_tween; this editor sets the authored values.

import { computed } from 'vue'

// Mirrors EffectSchema in src/schema/zod.ts (client code doesn't import
// server types — see useCommandBus.ts).
type Effect =
  | { type: 'blur'; radius: number }
  | { type: 'shadow'; color: string; blur?: number; offsetX?: number; offsetY?: number }
  | { type: 'glow'; color: string; radius: number }
type EffectType = Effect['type']

const props = defineProps<{
  modelValue: Effect[] | null | undefined
  label: string
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: Effect[] | null): void
}>()

const DEFAULTS: Record<EffectType, Effect> = {
  blur: { type: 'blur', radius: 4 },
  shadow: { type: 'shadow', color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
  glow: { type: 'glow', color: '#ffffff', radius: 8 },
}

// Number fields per effect type, in display order.
const NUMBER_FIELDS: Record<EffectType, ReadonlyArray<string>> = {
  blur: ['radius'],
  shadow: ['blur', 'offsetX', 'offsetY'],
  glow: ['radius'],
}
// Fields that must stay ≥ 0 (the rest are offsets and may go negative).
const NON_NEGATIVE = new Set(['radius', 'blur'])

const effects = computed<Effect[]>(() => props.modelValue ?? [])

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function swatch(color: string): string {
  if (!HEX_RE.test(color)) return '#000000'
  if (color.length === 4) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  return color.slice(0, 7)
}

function commit(next: Effect[]): void {
  emit('update:modelValue', next.length > 0 ? next : null)
}

function add(type: EffectType): void {
  commit([...effects.value, { ...DEFAULTS[type] }])
}

function remove(index: number): void {
  commit(effects.value.filter((_, i) => i !== index))
}

function move(index: number, delta: -1 | 1): void {
  const to = index + delta
  if (to < 0 || to >= effects.value.length) return
  const next = [...effects.value]
  const [row] = next.splice(index, 1)
  next.splice(to, 0, row!)
  commit(next)
}

function patch(index: number, fields: Record<string, unknown>): void {
  commit(effects.value.map((e, i) => (i === index ? ({ ...e, ...fields } as Effect) : e)))
}

function numberOf(effect: Effect, key: string): number {
  const v = (effect as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : 0
}

function onNumber(index: number, key: string, event: Event): void {
  const target = event.target as HTMLInputElement
  const next = Number(target.value.replace(',', '.'))
  const effect = effects.value[index]
  if (
    !effect ||
    target.value === '' ||
    !Number.isFinite(next) ||
    (NON_NEGATIVE.has(key) && next < 0)
  ) {
    if (effect) target.value = String(numberOf(effect, key))
    return
  }
  patch(index, { [key]: next })
}

function onColor(index: number, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  if (value !== '') patch(index, { color: value })
}

function colorOf(effect: Effect): string | null {
  return effect.type === 'blur' ? null : effect.color
}
</script>

<template>
  <div class="effects-input" :class="{ overridden, disabled }" data-testid="effects-input">
    <label class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </label>
    <div class="controls">
      <div
        v-for="(effect, index) in effects"
        :key="index"
        class="effect"
        :data-testid="`effect-${index}`"
        :data-effect-type="effect.type"
      >
        <div class="effect-head">
          <span class="effect-type">{{ index }} · {{ effect.type }}</span>
          <span class="effect-actions">
            <button
              type="button"
              class="icon-btn"
              title="Move up"
              :disabled="disabled || index === 0"
              @click="move(index, -1)"
            >↑</button>
            <button
              type="button"
              class="icon-btn"
              title="Move down"
              :disabled="disabled || index === effects.length - 1"
              @click="move(index, 1)"
            >↓</button>
            <button
              type="button"
              class="icon-btn"
              title="Remove effect"
              :data-testid="`effect-${index}-remove`"
              :disabled="disabled"
              @click="remove(index)"
            >×</button>
          </span>
        </div>
        <div class="grid">
          <label v-if="colorOf(effect) !== null" class="sub wide">
            <span class="sub-label">color</span>
            <span class="color">
              <input
                type="color"
                class="picker"
                :value="swatch(colorOf(effect)!)"
                :disabled="disabled"
                @input="(e) => onColor(index, e)"
              />
              <input
                type="text"
                class="text"
                spellcheck="false"
                :data-testid="`effect-${index}-color`"
                :value="colorOf(effect)"
                :disabled="disabled"
                @change="(e) => onColor(index, e)"
              />
            </span>
          </label>
          <label v-for="key in NUMBER_FIELDS[effect.type]" :key="key" class="sub">
            <span class="sub-label">{{ key }}</span>
            <input
              type="text"
              inputmode="decimal"
              class="text num"
              :data-testid="`effect-${index}-${key}`"
              :value="String(numberOf(effect, key))"
              :disabled="disabled"
              @change="(e) => onNumber(index, key, e)"
            />
          </label>
        </div>
      </div>
      <div class="add-row">
        <button
          v-for="type in (['blur', 'shadow', 'glow'] as const)"
          :key="type"
          type="button"
          class="add-btn"
          :data-testid="`effect-add-${type}`"
          :disabled="disabled"
          @click="add(type)"
        >+ {{ type }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.effects-input {
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

.effects-input.overridden .label-text {
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
  gap: 8px;
  min-width: 0;
}

.effect {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
}

.effect-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.effect-type {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #a3a3a3;
}

.effect-actions {
  display: inline-flex;
  gap: 2px;
}

.icon-btn,
.add-btn {
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #d4d4d4;
  font: inherit;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
}

.icon-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  line-height: 1;
}

.add-btn {
  padding: 3px 8px;
}

.icon-btn:disabled,
.add-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.icon-btn:not(:disabled):hover,
.add-btn:not(:disabled):hover {
  border-color: #5b7cfa;
}

.add-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
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

.sub.wide {
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
.icon-btn:focus,
.add-btn:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.effects-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
