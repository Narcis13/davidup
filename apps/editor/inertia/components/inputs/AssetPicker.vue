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
//
// Asset library E2: with `pickLibrary`, the picker also lists the library's
// records of its type that the composition has not registered (the Library
// panel's Assets / Fonts tabs, every shelf). Picking one registers it —
// `pickLibrary` is use_asset with `place: false`, resolving to the composition
// asset id — and the field takes that id.

import { computed, onMounted, ref } from 'vue'

type Asset = { id: string; type?: string; src?: string; family?: string }

/** A library record as GET /api/library lists it. */
interface LibraryRecord {
  id: string
  name?: string
  shelf?: string
  assetType?: string
}

const LIBRARY_PREFIX = 'library:'

const props = defineProps<{
  modelValue: string | undefined
  label: string
  /** Filter the listed assets to a single type. */
  assetType?: 'image' | 'font' | 'audio' | 'video'
  /** Composition's `assets` array — defaults to empty when nothing's loaded. */
  assets?: ReadonlyArray<Asset>
  overridden?: boolean
  disabled?: boolean
  /**
   * Register a library record (use_asset, `place: false`) and resolve to the
   * composition asset id, or null when it failed. Without it the picker lists
   * the composition's assets only.
   */
  pickLibrary?: (recordId: string) => Promise<string | null>
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const filteredAssets = computed<ReadonlyArray<Asset>>(() => {
  const list = props.assets ?? []
  if (!props.assetType) return list
  return list.filter((a) => a.type === props.assetType)
})

// The library's records of this type, read when the picker mounts and again
// when it is focused (a record uploaded since shows up).
const records = ref<LibraryRecord[]>([])
const registering = ref(false)

async function loadRecords(): Promise<void> {
  if (!props.pickLibrary) return
  const kind = props.assetType === 'font' ? 'font' : 'asset'
  try {
    const res = await fetch(`/api/library?kind=${kind}`, { headers: { accept: 'application/json' } })
    if (!res.ok) return
    const body = (await res.json()) as { items?: LibraryRecord[] }
    records.value = (body.items ?? []).filter((i) => typeof i.shelf === 'string')
  } catch {
    /* the composition's assets still list */
  }
}

onMounted(() => void loadRecords())

/** The record id an `asset:<id>[@sha12]` src names, else null. */
function recordIdOf(src: string | undefined): string | null {
  const m = typeof src === 'string' ? /^asset:([^@]+)/.exec(src) : null
  return m ? m[1]! : null
}

const libraryOptions = computed<LibraryRecord[]>(() => {
  const registered = new Set((props.assets ?? []).map((a) => recordIdOf(a.src)).filter(Boolean))
  return records.value.filter(
    (r) => (!props.assetType || r.assetType === props.assetType) && !registered.has(r.id)
  )
})

const currentMissing = computed<boolean>(() => {
  const v = props.modelValue
  if (typeof v !== 'string' || v === '') return false
  return !filteredAssets.value.some((a) => a.id === v)
})

const isEmpty = computed<boolean>(
  () => filteredAssets.value.length === 0 && libraryOptions.value.length === 0
)

const emptyLabel = computed<string>(() => {
  if (props.assetType === 'font') return 'No fonts registered'
  if (props.assetType === 'image') return 'No image assets registered'
  if (props.assetType === 'audio') return 'No audio assets registered'
  if (props.assetType === 'video') return 'No video assets registered'
  return 'No assets registered'
})

async function onChange(event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement
  const value = target.value
  if (!value.startsWith(LIBRARY_PREFIX)) {
    emit('update:modelValue', value)
    return
  }
  // Back to the current value until the record is registered: the select
  // shows the asset id the field takes, never the `library:` option.
  target.value = props.modelValue ?? ''
  if (!props.pickLibrary || registering.value) return
  registering.value = true
  try {
    const assetId = await props.pickLibrary(value.slice(LIBRARY_PREFIX.length))
    if (assetId) emit('update:modelValue', assetId)
  } finally {
    registering.value = false
  }
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
      :disabled="disabled || registering || (isEmpty && !currentMissing)"
      data-testid="inspector-asset-picker"
      @focus="loadRecords"
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
      <optgroup
        v-if="libraryOptions.length > 0"
        label="Library (registers on pick)"
        data-testid="inspector-asset-picker-library"
      >
        <option v-for="r in libraryOptions" :key="r.id" :value="`${LIBRARY_PREFIX}${r.id}`">
          {{ r.name ?? r.id }} · {{ r.shelf }}
        </option>
      </optgroup>
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
