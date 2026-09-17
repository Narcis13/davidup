<script setup lang="ts">
// v1.1 S17 input · tween easing picker.
//
// One select over the 19 easing names plus `cubic-bezier…` and `steps…`.
// Picking an object form seeds it (CSS `ease` / 4 steps) and shows its
// fields: x1 y1 / x2 y2 for a bezier, n for steps. Every edit emits the whole
// easing (a name or the object), so one change is one `update_tween`. Number
// fields commit on `change` (Enter / blur) like the Shadow input; a value the
// engine would reject (x outside [0, 1], steps not an integer ≥ 1) reverts
// the field instead of emitting. Visual curve editing is Session 28.

import { computed } from 'vue'
import { EASING_NAMES } from 'davidup/easings'
import type { Easing } from 'davidup/easings'
import {
  BEZIER_OPTION,
  STEPS_OPTION,
  easingForOption,
  easingOptionValue,
  isBezierEasing,
  isStepsEasing,
  parseSteps,
  patchBezier,
  type BezierSlot,
} from '~/composables/easingInputMath'

const props = defineProps<{
  modelValue: Easing | undefined
  label: string
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: Easing): void
}>()

const BEZIER_SLOTS: ReadonlyArray<{ slot: BezierSlot; label: string }> = [
  { slot: 0, label: 'x1' },
  { slot: 1, label: 'y1' },
  { slot: 2, label: 'x2' },
  { slot: 3, label: 'y2' },
]

const option = computed(() => easingOptionValue(props.modelValue))
const bezier = computed(() => (isBezierEasing(props.modelValue) ? props.modelValue : null))
const steps = computed(() => (isStepsEasing(props.modelValue) ? props.modelValue : null))

function onSelect(event: Event): void {
  const next = easingForOption((event.target as HTMLSelectElement).value, props.modelValue)
  if (next !== null) emit('update:modelValue', next)
}

function onBezierSlot(slot: BezierSlot, event: Event): void {
  const target = event.target as HTMLInputElement
  const current = bezier.value
  if (!current) return
  const next = patchBezier(current, slot, target.value)
  if (!next) {
    target.value = String(current.bezier[slot])
    return
  }
  emit('update:modelValue', next)
}

function onSteps(event: Event): void {
  const target = event.target as HTMLInputElement
  const next = parseSteps(target.value)
  if (!next) {
    target.value = String(steps.value?.steps ?? '')
    return
  }
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="easing-input" :class="{ overridden, disabled }" data-testid="easing-input">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </span>
    <div class="controls">
      <select
        class="select"
        data-testid="easing-select"
        :value="option"
        :disabled="disabled"
        @change="onSelect"
      >
        <option v-for="name in EASING_NAMES" :key="name" :value="name">{{ name }}</option>
        <option :value="BEZIER_OPTION">cubic-bezier…</option>
        <option :value="STEPS_OPTION">steps…</option>
      </select>
      <div v-if="bezier" class="grid">
        <label v-for="s in BEZIER_SLOTS" :key="s.slot" class="sub">
          <span class="sub-label">{{ s.label }}</span>
          <input
            type="text"
            inputmode="decimal"
            class="text num"
            :data-testid="`easing-bezier-${s.label}`"
            :value="String(bezier.bezier[s.slot])"
            :disabled="disabled"
            @change="(e) => onBezierSlot(s.slot, e)"
          />
        </label>
      </div>
      <label v-else-if="steps" class="sub">
        <span class="sub-label">n (steps)</span>
        <input
          type="text"
          inputmode="numeric"
          class="text num"
          data-testid="easing-steps"
          :value="String(steps.steps)"
          :disabled="disabled"
          @change="onSteps"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.easing-input {
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

.easing-input.overridden .label-text {
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

.select {
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  padding: 4px 6px;
  border-radius: 4px;
  min-width: 0;
}

/* P1 (x1, y1) on the first row, P2 (x2, y2) on the second. */
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

.sub-label {
  font-size: 11px;
  color: #707070;
}

.text {
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

.select:focus,
.text:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.easing-input.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
