<script setup lang="ts">
// SaveDefinitionDialog — small modal for writing a user-authored
// template / behavior / scene to disk.
//
// Mirrors the asset-upload `target` shape: the user picks Project | Global
// and the server writes `<root>/<kinds>/<id>.<kind>.json`.
//
// v1 keeps the schema editor honest: a `body` textarea with JSON for the
// definition fields (description, params, items, tweens, …). A richer
// wizard can be layered on later — the endpoint shape will not need to
// change.

import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'

export type DefinitionKind = 'template' | 'behavior' | 'scene'
export type DefinitionTarget = 'project' | 'global'

const props = defineProps<{
  open: boolean
  /** Pre-selected kind when the dialog opens. */
  kind: DefinitionKind
  /** Pre-fill the body textarea (e.g. when promoting an in-progress draft). */
  initialBody?: string
  /** Pre-fill the id field. */
  initialId?: string
  /** Default target — defaults to 'project'. */
  initialTarget?: DefinitionTarget
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'saved', payload: { kind: DefinitionKind; id: string; target: DefinitionTarget; relative: string }): void
}>()

const KIND_OPTIONS: DefinitionKind[] = ['template', 'behavior', 'scene']
const TARGET_OPTIONS: DefinitionTarget[] = ['project', 'global']

const kind = ref<DefinitionKind>(props.kind)
const id = ref(props.initialId ?? '')
const target = ref<DefinitionTarget>(props.initialTarget ?? 'project')
const bodyText = ref(props.initialBody ?? defaultBody('template'))
const busy = ref(false)
const errorMsg = ref<string | null>(null)
const idInput = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  (next) => {
    if (!next) return
    kind.value = props.kind
    id.value = props.initialId ?? ''
    target.value = props.initialTarget ?? 'project'
    bodyText.value = props.initialBody ?? defaultBody(props.kind)
    errorMsg.value = null
    nextTick(() => idInput.value?.focus())
  },
)

watch(kind, (next, prev) => {
  // Swap the default body when the user changes the kind, but only if the
  // textarea still holds an untouched default (so we don't trash edits).
  if (bodyText.value.trim() === defaultBody(prev).trim()) {
    bodyText.value = defaultBody(next)
  }
})

function defaultBody(k: DefinitionKind): string {
  if (k === 'template') {
    return [
      '{',
      '  "description": "",',
      '  "params": [],',
      '  "items": {},',
      '  "tweens": []',
      '}',
      '',
    ].join('\n')
  }
  if (k === 'scene') {
    return [
      '{',
      '  "description": "",',
      '  "duration": 1,',
      '  "params": [],',
      '  "assets": [],',
      '  "items": {},',
      '  "tweens": []',
      '}',
      '',
    ].join('\n')
  }
  return [
    '{',
    '  "description": "",',
    '  "params": [],',
    '  "emits": [],',
    '  "tweens": []',
    '}',
    '',
  ].join('\n')
}

const canSubmit = computed(() => !busy.value && id.value.trim().length > 0)

async function submit(forceOverwrite = false): Promise<void> {
  errorMsg.value = null
  const trimmedId = id.value.trim()
  if (!trimmedId) {
    errorMsg.value = '`id` is required'
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText.value || '{}')
  } catch (err) {
    errorMsg.value = `Body is not valid JSON: ${(err as Error).message}`
    return
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errorMsg.value = 'Body must be a JSON object'
    return
  }
  busy.value = true
  let res: Response
  try {
    res = await fetch('/api/library/definitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-inertia': 'false' },
      body: JSON.stringify({
        kind: kind.value,
        id: trimmedId,
        target: target.value,
        body: parsed,
        force: forceOverwrite,
      }),
    })
  } catch (err) {
    busy.value = false
    errorMsg.value = (err as Error).message
    return
  }
  busy.value = false
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string }
    } | null
    if (body?.error?.code === 'E_TARGET_EXISTS') {
      const proceed = window.confirm(
        `${target.value === 'global' ? 'Global' : 'Project'} library already has ${kind.value} "${trimmedId}". Overwrite?`,
      )
      if (proceed) await submit(true)
      return
    }
    errorMsg.value = body?.error?.message ?? `Save failed (HTTP ${res.status})`
    return
  }
  const okBody = (await res.json().catch(() => null)) as {
    kind: DefinitionKind
    id: string
    target: DefinitionTarget
    relative: string
  } | null
  emit('saved', {
    kind: kind.value,
    id: trimmedId,
    target: target.value,
    relative: okBody?.relative ?? `${kind.value}s/${trimmedId}.${kind.value}.json`,
  })
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
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="save-def-title"
    data-testid="save-definition-dialog"
    @click="onBackdropClick"
  >
    <div class="dialog">
      <header class="dialog-head">
        <h2 id="save-def-title" class="dialog-title">Save as library definition</h2>
        <button
          type="button"
          class="dialog-close"
          aria-label="Close"
          data-testid="save-def-close"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <form class="dialog-body" @submit.prevent="submit(false)">
        <div class="row">
          <label class="field">
            <span class="label">Kind</span>
            <select v-model="kind" class="input" data-testid="save-def-kind">
              <option v-for="k in KIND_OPTIONS" :key="k" :value="k">{{ k }}</option>
            </select>
          </label>
          <label class="field">
            <span class="label">id</span>
            <input
              ref="idInput"
              v-model="id"
              class="input"
              type="text"
              placeholder="card-glow"
              autocomplete="off"
              spellcheck="false"
              data-testid="save-def-id"
            />
          </label>
        </div>

        <div class="field">
          <span class="label">Save to</span>
          <div class="target-radio" role="radiogroup" aria-label="Target library">
            <label
              v-for="t in TARGET_OPTIONS"
              :key="t"
              class="target-pill"
              :data-active="target === t ? 'true' : 'false'"
            >
              <input
                v-model="target"
                type="radio"
                :value="t"
                :data-testid="`save-def-target-${t}`"
              />
              <span class="target-icon">{{ t === 'global' ? '🌐' : '📁' }}</span>
              <span class="target-text">
                <span class="target-name">{{ t === 'global' ? 'Global' : 'Project' }}</span>
                <span class="target-sub">
                  {{ t === 'global' ? '~/.davidup/library' : '<project>/library' }}
                </span>
              </span>
            </label>
          </div>
        </div>

        <label class="field">
          <span class="label">Body (JSON)</span>
          <textarea
            v-model="bodyText"
            class="input textarea"
            rows="12"
            spellcheck="false"
            data-testid="save-def-body"
          />
          <span class="hint">
            The <code>id</code> is added automatically — describe the rest of the definition here
            (description, params, items, tweens, …).
          </span>
        </label>

        <p v-if="errorMsg" class="error" role="alert" data-testid="save-def-error">
          {{ errorMsg }}
        </p>

        <footer class="dialog-foot">
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="busy"
            @click="emit('close')"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="!canSubmit"
            data-testid="save-def-submit"
          >
            {{ busy ? 'Saving…' : `Save to ${target}` }}
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
  z-index: 50;
  padding: 24px;
  backdrop-filter: blur(2px);
}

.dialog {
  width: min(560px, 100%);
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
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.dialog-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
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

.row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.label {
  font-size: 11px;
  color: #a3a3a3;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.input {
  width: 100%;
  box-sizing: border-box;
  background: #0a0a0a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e5e5e5;
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 5px;
  outline: none;
  transition: border-color 120ms ease;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

.input:focus {
  border-color: rgba(91, 124, 250, 0.7);
  box-shadow: 0 0 0 3px rgba(91, 124, 250, 0.18);
}

.textarea {
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}

.hint {
  font-size: 11px;
  color: #808080;
}

.hint code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.target-radio {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.target-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #0a0a0a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}

.target-pill input {
  margin: 0;
  accent-color: #5b7cfa;
}

.target-pill[data-active='true'] {
  border-color: rgba(91, 124, 250, 0.7);
  background: rgba(91, 124, 250, 0.08);
}

.target-icon {
  font-size: 18px;
  line-height: 1;
}

.target-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.target-name {
  font-size: 13px;
  font-weight: 500;
}

.target-sub {
  font-size: 11px;
  color: #808080;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
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
