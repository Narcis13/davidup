<script setup lang="ts">
// Asset picker — UX_GAPS §J.
//
// Drop-in replacement for the raw text input the Inspector used for the
// sprite's `asset` field (and text's `font`). Enumerates the composition's
// currently-registered assets so the user can swap a sprite to a different
// asset without remembering the id, and so accidentally-invalid ids are
// impossible by construction. The current value is preserved verbatim even
// when it doesn't match a registered asset — we surface it as a `(missing)`
// option so the user can see what's wrong instead of silently switching to
// something arbitrary.

import { computed } from 'vue'

type Asset = { id: string; type?: string; src?: string; family?: string }

const props = defineProps<{
  modelValue: string | undefined
  label: string
  /** Filter the listed assets to a single type. */
  assetType?: 'image' | 'font' | 'audio' | 'video'
  /** Composition's `assets` array — defaults to empty when nothing's loaded. */
  assets?: ReadonlyArray<Asset>
  overridden?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const filteredAssets = computed<ReadonlyArray<Asset>>(() => {
  const list = props.assets ?? []
  if (!props.assetType) return list
  return list.filter((a) => a.type === props.assetType)
})

const currentMissing = computed<boolean>(() => {
  const v = props.modelValue
  if (typeof v !== 'string' || v === '') return false
  return !filteredAssets.value.some((a) => a.id === v)
})

const isEmpty = computed<boolean>(() => filteredAssets.value.length === 0)

const emptyLabel = computed<string>(() => {
  if (props.assetType === 'font') return 'No fonts registered'
  if (props.assetType === 'image') return 'No image assets registered'
  if (props.assetType === 'audio') return 'No audio assets registered'
  if (props.assetType === 'video') return 'No video assets registered'
  return 'No assets registered'
})

function onChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <label class="asset-picker" :class="{ overridden, disabled }">
    <span class="label">
      <span v-if="overridden" class="override-dot" aria-hidden="true" />
      <span class="label-text">{{ label }}</span>
    </span>
    <select
      class="select"
      :value="modelValue ?? ''"
      :disabled="disabled || (isEmpty && !currentMissing)"
      data-testid="inspector-asset-picker"
      @change="onChange"
    >
      <option v-if="isEmpty && !currentMissing" disabled value="">
        {{ emptyLabel }}
      </option>
      <option v-if="currentMissing" :value="modelValue ?? ''">
        {{ modelValue }} (missing)
      </option>
      <option v-for="a in filteredAssets" :key="a.id" :value="a.id">
        {{ a.id }}<template v-if="a.family"> · {{ a.family }}</template>
      </option>
    </select>
  </label>
</template>

<style scoped>
.asset-picker {
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

.asset-picker.overridden .label-text {
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

.asset-picker.disabled {
  opacity: 0.45;
  pointer-events: none;
}
</style>
