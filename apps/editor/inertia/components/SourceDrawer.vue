<script setup lang="ts">
// SourceDrawer — step 17 reveal-in-source pane.
//
// Bottom drawer (toggle: ⌘J) showing the *authored* composition.json text
// with the originating source location highlighted for the current item
// selection. "Edit" (v1.1 S29) swaps the view for a textarea; Save parses
// the draft and hands it to `onSave`, which dispatches `replace_composition`
// — one validated, undoable command for the whole document.
//
// The line is computed by `indexJsonPointerLines` (see
// `composables/jsonPointerLines.ts`), which walks the text as JSON and
// records the start line of every value. When the selection changes (or the
// drawer opens with an existing selection), we scroll the matched line into
// the middle of the viewport and overlay a highlight band on it.

import { computed, nextTick, ref, watch } from 'vue'
import { indexJsonPointerLines, pointerForSelection } from '~/composables/jsonPointerLines'
import { parseSourceDraft } from '~/composables/sourceDraft'

const props = defineProps<{
  /** Authored JSON text from the loaded composition.json. */
  source: { text: string; file: string; mtimeMs: number } | null
  /** Currently selected item id (null when nothing is selected). */
  selectedItemId: string | null
  /** RFC-6901 pointer captured during the last stage pick (or null). */
  pickSourceJsonPointer: string | null
  /** File path the picked pointer refers to (may differ from displayed file). */
  pickSourceFile: string | null
  /** Whether the drawer is open. */
  open: boolean
  /**
   * Apply an edited document. Resolves to null on success, or the rejection
   * message to show inline. Omitted ⇒ the drawer stays read-only.
   */
  onSave?: (json: Record<string, unknown>) => Promise<string | null>
}>()

const emit = defineEmits<{ (event: 'close'): void }>()

const codeContainer = ref<HTMLDivElement | null>(null)

const lineLookup = computed(() => {
  if (!props.source) return { lines: new Map<string, number>(), totalLines: 1 }
  return indexJsonPointerLines(props.source.text)
})

const resolvedPointer = computed<string | null>(() =>
  pointerForSelection({
    selectedItemId: props.selectedItemId,
    pickSourceFile: props.pickSourceFile,
    pickSourceJsonPointer: props.pickSourceJsonPointer,
    displayedFile: props.source?.file ?? null,
  }),
)

const highlightedLine = computed<number | null>(() => {
  const ptr = resolvedPointer.value
  if (ptr === null) return null
  const line = lineLookup.value.lines.get(ptr)
  return typeof line === 'number' ? line : null
})

const lines = computed<string[]>(() => (props.source ? props.source.text.split('\n') : []))

const relativeFile = computed<string>(() => {
  const f = props.source?.file
  if (!f) return ''
  // Show only the file name + parent dir — paths can be long.
  const parts = f.split(/[/\\]/)
  if (parts.length <= 2) return f
  return `…/${parts.slice(-2).join('/')}`
})

const sourceMissingForPick = computed<boolean>(() => {
  // True when the user picked an item whose source-map entry points at a
  // different file (e.g. a $ref'd library). v1.0 only renders the loaded
  // composition.json, so we surface a note rather than silently misleading.
  if (!props.pickSourceJsonPointer || !props.pickSourceFile || !props.source) return false
  return props.pickSourceFile !== props.source.file
})

watch(
  [() => props.open, highlightedLine, () => props.source?.text],
  async ([open, line]) => {
    if (!open) return
    await nextTick()
    if (line === null) return
    const root = codeContainer.value
    if (!root) return
    const el = root.querySelector<HTMLElement>(`[data-line="${line}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'auto' })
  },
  { flush: 'post' },
)

// ─── Editing (v1.1 S29) ───────────────────────────────────────────────
const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const draftError = ref<{ message: string; line: number | null } | null>(null)

function startEdit(): void {
  if (!props.source) return
  draft.value = props.source.text
  draftError.value = null
  editing.value = true
}

function cancelEdit(): void {
  editing.value = false
  draftError.value = null
}

async function saveEdit(): Promise<void> {
  if (!props.onSave || saving.value) return
  const parsed = parseSourceDraft(draft.value)
  if (!parsed.ok) {
    draftError.value = { message: parsed.message, line: parsed.line }
    return
  }
  saving.value = true
  try {
    const rejection = await props.onSave(parsed.json)
    if (rejection === null) {
      editing.value = false
      draftError.value = null
    } else {
      draftError.value = { message: rejection, line: null }
    }
  } finally {
    saving.value = false
  }
}

function onDraftKeydown(event: KeyboardEvent): void {
  // Keep typing out of the editor's global shortcuts (Delete, arrows, ⌘Z…).
  event.stopPropagation()
  if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'Enter')) {
    event.preventDefault()
    void saveEdit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  } else if (event.key === 'Tab') {
    event.preventDefault()
    const el = event.target as HTMLTextAreaElement
    const { selectionStart, selectionEnd } = el
    draft.value = `${draft.value.slice(0, selectionStart)}  ${draft.value.slice(selectionEnd)}`
    void nextTick(() => el.setSelectionRange(selectionStart + 2, selectionStart + 2))
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) cancelEdit()
  },
)

function onClose(): void {
  emit('close')
}
</script>

<template>
  <div
    v-if="open"
    class="source-drawer"
    role="dialog"
    aria-label="Reveal in source"
    data-testid="source-drawer"
  >
    <header class="drawer-header">
      <div class="title">
        <span class="title-label">Source</span>
        <span v-if="source" class="title-file" :title="source.file">{{ relativeFile }}</span>
      </div>
      <div class="actions">
        <template v-if="editing">
          <button
            type="button"
            class="text-btn"
            data-testid="source-drawer-cancel"
            :disabled="saving"
            @click="cancelEdit"
          >
            Cancel
          </button>
          <button
            type="button"
            class="text-btn text-btn-primary"
            data-testid="source-drawer-save"
            :disabled="saving"
            title="Save (⌘S)"
            @click="saveEdit"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </template>
        <button
          v-else-if="source && onSave"
          type="button"
          class="text-btn"
          data-testid="source-drawer-edit"
          @click="startEdit"
        >
          Edit
        </button>
        <span v-if="!editing && highlightedLine" class="line-pill" data-testid="source-drawer-line">
          Line {{ highlightedLine }}
        </span>
        <span
          v-else-if="!editing && resolvedPointer"
          class="line-pill line-pill-muted"
          data-testid="source-drawer-line"
        >
          No source location
        </span>
        <button
          type="button"
          class="close-btn"
          aria-label="Close source drawer"
          data-testid="source-drawer-close"
          @click="onClose"
        >
          ×
        </button>
      </div>
    </header>

    <div v-if="!source" class="drawer-empty">
      <p>No composition source loaded.</p>
    </div>

    <div v-else class="drawer-body">
      <div v-if="editing && draftError" class="drawer-error" data-testid="source-drawer-error">
        <span v-if="draftError.line">Line {{ draftError.line }}: </span>{{ draftError.message }}
      </div>
      <textarea
        v-if="editing"
        v-model="draft"
        class="code-edit"
        spellcheck="false"
        aria-label="composition.json source"
        data-testid="source-drawer-textarea"
        @keydown="onDraftKeydown"
      />
      <div v-if="!editing && sourceMissingForPick" class="drawer-note">
        Picked entry lives in another file ({{ pickSourceFile }}). Showing
        {{ relativeFile }} instead.
      </div>
      <div v-if="!editing" ref="codeContainer" class="code-scroll" data-testid="source-drawer-code">
        <pre class="code">
          <div
            v-for="(text, idx) in lines"
            :key="idx"
            class="code-line"
            :class="{ 'is-highlighted': highlightedLine === idx + 1 }"
            :data-line="idx + 1"
          ><span class="gutter">{{ idx + 1 }}</span><span class="line-text">{{ text }}</span></div>
        </pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.source-drawer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 40vh;
  min-height: 220px;
  max-height: 70vh;
  background: #0d0d10;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  z-index: 50;
  color: #e5e5e5;
  font-family: 'Instrument Sans', system-ui, sans-serif;
}

.drawer-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.02);
}

.title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a3a3a3;
}

.title-file {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #d4d4d4;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.line-pill {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  background: rgba(91, 124, 250, 0.18);
  color: #aab7ff;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(91, 124, 250, 0.4);
}

.line-pill-muted {
  background: rgba(255, 255, 255, 0.05);
  color: #a3a3a3;
  border-color: rgba(255, 255, 255, 0.12);
}

.close-btn {
  background: transparent;
  border: none;
  color: #d4d4d4;
  font-size: 18px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
}

.text-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #d4d4d4;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.text-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.text-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.text-btn-primary {
  background: rgba(91, 124, 250, 0.25);
  border-color: rgba(91, 124, 250, 0.5);
  color: #dbe2ff;
}

.text-btn-primary:hover:not(:disabled) {
  background: rgba(91, 124, 250, 0.4);
}

.drawer-error {
  padding: 6px 12px;
  font-size: 12px;
  color: #ff9d9d;
  background: rgba(255, 90, 90, 0.08);
  border-bottom: 1px solid rgba(255, 90, 90, 0.2);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.code-edit {
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  border: none;
  outline: none;
  margin: 0;
  padding: 8px 12px;
  background: #07070a;
  color: #d4d4d4;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre;
  tab-size: 2;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.drawer-empty {
  padding: 20px 16px;
  color: #707070;
  font-size: 13px;
}

.drawer-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.drawer-note {
  padding: 6px 12px;
  font-size: 12px;
  color: #f0c97e;
  background: rgba(240, 201, 126, 0.08);
  border-bottom: 1px solid rgba(240, 201, 126, 0.18);
}

.code-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  background: #07070a;
}

.code {
  margin: 0;
  padding: 8px 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.55;
  color: #d4d4d4;
}

.code-line {
  display: flex;
  align-items: flex-start;
  padding: 0 12px;
  white-space: pre;
}

.code-line.is-highlighted {
  background: rgba(91, 124, 250, 0.18);
  box-shadow: inset 3px 0 0 0 #5b7cfa;
}

.gutter {
  display: inline-block;
  min-width: 3.5ch;
  margin-right: 14px;
  color: #555555;
  text-align: right;
  user-select: none;
  flex: 0 0 auto;
}

.code-line.is-highlighted .gutter {
  color: #aab7ff;
}

.line-text {
  flex: 1 1 auto;
  white-space: pre;
}
</style>
