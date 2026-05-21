<script setup lang="ts">
// ApplyTemplateDialog — override template params per insertion.
//
// Drag-and-drop applies a parameterized template silently with its saved
// defaults. This dialog is the explicit "Apply…" path: it lists each
// `TemplateParamDescriptor` with a type-appropriate input pre-filled from
// the descriptor's `default` (or the library card's pre-resolved default
// payload, which reuses the same brand-defaults logic as the drag path),
// and emits an `apply` event with the final value map.
//
// Per-param scope: each row has an `fx` toggle that switches the value
// between a literal (inline) and a substitution string (e.g. `${params.X}`).
// When toggled on, the value is sent as a string so downstream substitution
// (composition or scene scope) resolves it. The toggle is also auto-set
// when the descriptor's default is already an expression-looking string.

import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

type ParamType = 'number' | 'string' | 'color' | 'boolean'

interface ParamDescriptor {
  name: string
  type?: ParamType
  required?: boolean
  default?: unknown
  description?: string
}

interface TemplateItem {
  id: string
  name?: string
  description?: string
  params?: unknown[]
}

const props = defineProps<{
  open: boolean
  /** The library template item being applied. */
  item: TemplateItem | null
  /** Defaults already resolved by `useLibraryDrag` (brand placeholders). */
  initialValues?: Record<string, unknown>
  /** Where the template will land. Surfaced read-only as a hint. */
  layerId?: string | null
  /** Seconds the instance will begin at. Surfaced read-only as a hint. */
  start?: number
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'apply', payload: { params: Record<string, unknown> }): void
}>()

interface Row {
  name: string
  type: ParamType
  required: boolean
  defaultValue: unknown
  description?: string
  value: unknown
  /** When true the value is treated as an expression string (e.g. `${params.X}`). */
  fx: boolean
}

const rows = ref<Row[]>([])
const errorMsg = ref<string | null>(null)
const firstInput = ref<HTMLInputElement | null>(null)

const descriptors = computed<ParamDescriptor[]>(() => {
  const raw = props.item?.params
  if (!Array.isArray(raw)) return []
  return raw
    .map((p) => p as ParamDescriptor)
    .filter((p) => p && typeof p.name === 'string' && p.name.length > 0)
})

const hasParams = computed(() => descriptors.value.length > 0)

function looksLikeExpression(v: unknown): boolean {
  return typeof v === 'string' && /\$\{[^}]+\}/.test(v)
}

function defaultValueFor(desc: ParamDescriptor): unknown {
  // Prefer the parent-supplied resolved default (matches the brand-default
  // map used by the drag path), then the descriptor's `default`, then a
  // type-appropriate empty value.
  const supplied = props.initialValues?.[desc.name]
  if (supplied !== undefined) return supplied
  if (desc.default !== undefined) return desc.default
  switch (desc.type) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'color':
      return '#ffffff'
    default:
      return ''
  }
}

function buildRows(): Row[] {
  return descriptors.value.map((desc) => {
    const type: ParamType = desc.type ?? 'string'
    const value = defaultValueFor(desc)
    return {
      name: desc.name,
      type,
      required: !!desc.required,
      defaultValue: desc.default ?? props.initialValues?.[desc.name],
      description: desc.description,
      value,
      fx: looksLikeExpression(value),
    }
  })
}

watch(
  () => props.open,
  (next) => {
    if (!next) return
    rows.value = buildRows()
    errorMsg.value = null
    nextTick(() => firstInput.value?.focus())
  },
)

function resetRow(row: Row): void {
  const desc = descriptors.value.find((d) => d.name === row.name)
  if (!desc) return
  const v = defaultValueFor(desc)
  row.value = v
  row.fx = looksLikeExpression(v)
}

function toggleFx(row: Row): void {
  if (row.fx) {
    // Switching from fx → literal: try to keep a sensible literal value.
    if (typeof row.value !== 'string') {
      row.fx = false
      return
    }
    // Strip a single ${params.X} wrapper if present.
    const m = row.value.match(/^\$\{params\.([A-Za-z0-9_]+)\}$/)
    if (m) {
      const desc = descriptors.value.find((d) => d.name === row.name)
      row.value = desc?.default ?? defaultEmptyFor(row.type)
    }
    row.fx = false
    return
  }
  // Switching literal → fx: seed with `${params.<name>}` to give the user a
  // starting point. They can edit it freely.
  row.value = `\${params.${row.name}}`
  row.fx = true
}

function defaultEmptyFor(t: ParamType): unknown {
  switch (t) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'color':
      return '#ffffff'
    default:
      return ''
  }
}

function coerceForSubmit(row: Row): unknown {
  if (row.fx) {
    // fx rows always send a string — substitution happens downstream.
    return typeof row.value === 'string' ? row.value : String(row.value ?? '')
  }
  switch (row.type) {
    case 'number': {
      const n = typeof row.value === 'number' ? row.value : Number(row.value)
      return Number.isFinite(n) ? n : 0
    }
    case 'boolean':
      return !!row.value
    case 'color':
    case 'string':
    default:
      return row.value ?? ''
  }
}

function submit(): void {
  errorMsg.value = null
  const out: Record<string, unknown> = {}
  for (const row of rows.value) {
    if (row.required && !row.fx) {
      const v = row.value
      const empty =
        v === null ||
        v === undefined ||
        (row.type === 'string' && typeof v === 'string' && v.trim().length === 0)
      if (empty) {
        errorMsg.value = `Required param "${row.name}" is empty.`
        return
      }
    }
    out[row.name] = coerceForSubmit(row)
  }
  emit('apply', { params: out })
  emit('close')
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const startLabel = computed(() => {
  if (typeof props.start !== 'number') return null
  return `${props.start.toFixed(2)}s`
})
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="apply-template-title"
    data-testid="apply-template-dialog"
    @click="onBackdropClick"
  >
    <div class="dialog">
      <header class="dialog-head">
        <div class="head-text">
          <h2 id="apply-template-title" class="dialog-title">
            Apply template
            <span class="title-name">{{ item?.name ?? item?.id ?? '' }}</span>
          </h2>
          <p v-if="item?.description" class="dialog-sub">{{ item.description }}</p>
        </div>
        <button
          type="button"
          class="dialog-close"
          aria-label="Close"
          data-testid="apply-template-close"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <form class="dialog-body" @submit.prevent="submit">
        <div v-if="layerId || startLabel" class="placement-row">
          <span v-if="layerId" class="placement-chip">
            <span class="chip-label">layer</span>
            <span class="chip-val">{{ layerId }}</span>
          </span>
          <span v-if="startLabel" class="placement-chip">
            <span class="chip-label">start</span>
            <span class="chip-val">{{ startLabel }}</span>
          </span>
        </div>

        <p v-if="!hasParams" class="no-params" data-testid="apply-template-no-params">
          This template has no parameters. Confirm to apply it as-is.
        </p>

        <div v-else class="param-list" data-testid="apply-template-params">
          <div
            v-for="(row, idx) in rows"
            :key="row.name"
            class="param-row"
            :data-param="row.name"
          >
            <div class="param-head">
              <label class="param-name" :for="`apply-tpl-${row.name}`">
                <span class="name-text">{{ row.name }}</span>
                <span v-if="row.required" class="req" title="Required">*</span>
                <span class="type-chip" :data-type="row.type">{{ row.type }}</span>
              </label>
              <div class="param-tools">
                <button
                  type="button"
                  class="tool-btn"
                  :data-active="row.fx ? 'true' : 'false'"
                  :title="row.fx ? 'Switch to literal value' : 'Use expression (e.g. ${params.foo})'"
                  :data-testid="`apply-template-fx-${row.name}`"
                  @click="toggleFx(row)"
                >
                  ƒx
                </button>
                <button
                  type="button"
                  class="tool-btn"
                  title="Reset to default"
                  :data-testid="`apply-template-reset-${row.name}`"
                  @click="resetRow(row)"
                >
                  ↺
                </button>
              </div>
            </div>

            <p v-if="row.description" class="param-desc">{{ row.description }}</p>

            <template v-if="row.fx">
              <input
                :ref="(el) => { if (idx === 0) firstInput = (el as HTMLInputElement | null) }"
                :id="`apply-tpl-${row.name}`"
                v-model="row.value as string"
                class="input mono"
                type="text"
                spellcheck="false"
                autocomplete="off"
                :data-testid="`apply-template-input-${row.name}`"
                placeholder="${params.someName}"
              />
              <p class="hint mono">
                Sent verbatim; resolved by composition/scene substitution.
              </p>
            </template>
            <template v-else-if="row.type === 'number'">
              <input
                :ref="(el) => { if (idx === 0) firstInput = (el as HTMLInputElement | null) }"
                :id="`apply-tpl-${row.name}`"
                v-model.number="row.value as number"
                class="input"
                type="number"
                step="any"
                :data-testid="`apply-template-input-${row.name}`"
              />
            </template>
            <template v-else-if="row.type === 'boolean'">
              <label class="bool-row">
                <input
                  :ref="(el) => { if (idx === 0) firstInput = (el as HTMLInputElement | null) }"
                  :id="`apply-tpl-${row.name}`"
                  v-model="row.value as boolean"
                  type="checkbox"
                  :data-testid="`apply-template-input-${row.name}`"
                />
                <span class="bool-text">{{ (row.value as boolean) ? 'true' : 'false' }}</span>
              </label>
            </template>
            <template v-else-if="row.type === 'color'">
              <div class="color-row">
                <input
                  :ref="(el) => { if (idx === 0) firstInput = (el as HTMLInputElement | null) }"
                  :id="`apply-tpl-${row.name}`"
                  v-model="row.value as string"
                  class="color-swatch"
                  type="color"
                  :data-testid="`apply-template-input-${row.name}`"
                />
                <input
                  v-model="row.value as string"
                  class="input mono color-hex"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  :data-testid="`apply-template-input-${row.name}-hex`"
                />
              </div>
            </template>
            <template v-else>
              <input
                :ref="(el) => { if (idx === 0) firstInput = (el as HTMLInputElement | null) }"
                :id="`apply-tpl-${row.name}`"
                v-model="row.value as string"
                class="input"
                type="text"
                spellcheck="false"
                autocomplete="off"
                :data-testid="`apply-template-input-${row.name}`"
              />
            </template>
          </div>
        </div>

        <p v-if="errorMsg" class="error" role="alert" data-testid="apply-template-error">
          {{ errorMsg }}
        </p>

        <footer class="dialog-foot">
          <button
            type="button"
            class="btn btn-ghost"
            data-testid="apply-template-cancel"
            @click="emit('close')"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            data-testid="apply-template-submit"
          >
            Apply
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-items: center;
  z-index: 60;
  padding: 24px;
  backdrop-filter: blur(2px);
}

.dialog {
  width: min(540px, 100%);
  max-height: 100%;
  background: #111;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
  color: #e5e5e5;
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  gap: 8px;
}

.head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dialog-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.title-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #ffb86b;
  font-weight: 500;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-sub {
  margin: 0;
  font-size: 11px;
  color: #a3a3a3;
  line-height: 1.4;
}

.dialog-close {
  background: transparent;
  border: none;
  color: #a3a3a3;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.dialog-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e5e5e5;
}

.dialog-body {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}

.placement-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.placement-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(91, 124, 250, 0.1);
  border: 1px solid rgba(91, 124, 250, 0.3);
}

.chip-label {
  color: #909090;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 9px;
}

.chip-val {
  color: #c9d4ff;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.no-params {
  margin: 0;
  font-size: 12px;
  color: #a3a3a3;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  text-align: center;
}

.param-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.param-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.param-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #e5e5e5;
  min-width: 0;
}

.name-text {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.req {
  color: #ff6b6b;
  font-weight: 700;
}

.type-chip {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: #a3a3a3;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.type-chip[data-type='color'] {
  color: #ffb86b;
}
.type-chip[data-type='number'] {
  color: #8aa8ff;
}
.type-chip[data-type='boolean'] {
  color: #6bd06b;
}

.param-tools {
  display: flex;
  gap: 4px;
}

.tool-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #a3a3a3;
  font-size: 11px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  padding: 2px 7px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.2;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.tool-btn:hover {
  border-color: rgba(91, 124, 250, 0.55);
  color: #e5e5e5;
}

.tool-btn[data-active='true'] {
  border-color: rgba(91, 124, 250, 0.7);
  background: rgba(91, 124, 250, 0.18);
  color: #c9d4ff;
}

.param-desc {
  margin: 0;
  font-size: 11px;
  color: #808080;
  line-height: 1.4;
}

.input {
  width: 100%;
  box-sizing: border-box;
  background: #0a0a0a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e5e5e5;
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 5px;
  outline: none;
  transition: border-color 120ms ease;
}

.input:focus {
  border-color: rgba(91, 124, 250, 0.7);
  box-shadow: 0 0 0 3px rgba(91, 124, 250, 0.18);
}

.mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
}

.hint {
  margin: 0;
  font-size: 10px;
  color: #707070;
}

.bool-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #c5c5c5;
  cursor: pointer;
}

.bool-text {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #a3a3a3;
}

.color-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.color-swatch {
  width: 36px;
  height: 30px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #0a0a0a;
  padding: 2px;
  cursor: pointer;
}

.color-hex {
  flex: 1 1 auto;
}

.error {
  margin: 0;
  font-size: 12px;
  color: #ff6b6b;
}

.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 8px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-primary {
  background: #5b7cfa;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #6e8cff;
}

.btn-ghost {
  background: transparent;
  color: #c5c5c5;
  border-color: rgba(255, 255, 255, 0.1);
}

.btn-ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.2);
}
</style>
