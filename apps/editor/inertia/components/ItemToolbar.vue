<script setup lang="ts">
// ItemToolbar — UX_GAPS section A.
//
// Vertical button rail docked on the left edge of the Stage panel that lets
// a human user create primitives (shape, text, sprite) without touching the
// library or hand-editing JSON. Each button puts the editor into "place
// mode" via `useItemToolbar`: the next Stage click drops the primitive at
// the cursor position on the topmost layer.
//
// The toolbar never invents a new mutation path — it only dispatches the
// existing `add_shape` / `add_text` / `add_sprite` commands through the
// command bus, same shape as the MCP server's tools.
//
// UX_GAPS §L: Group / Ungroup live at the bottom of the rail behind a
// separator. They're verbs (not create tools) so they don't enter place
// mode — they dispatch immediately against the current selection.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useItemToolbar, type PlaceTool } from '~/composables/useItemToolbar'
import { useActiveLayer } from '~/composables/useActiveLayer'
import type { Composition } from '~/composables/useCommandBus'

const props = defineProps<{
  composition: Composition | null
  /** True while the current selection can be wrapped in a new group (≥2 items, same layer). */
  canGroup: boolean
  /** True while the current selection is a single group eligible for flatten. */
  canUngroup: boolean
}>()

const emit = defineEmits<{
  (event: 'group'): void
  (event: 'ungroup'): void
}>()

const toolbar = useItemToolbar()
const activeLayer = useActiveLayer()

// ── derived: which layer placement targets ─────────────────────────────
// LayersPanel sets `activeLayer.activeLayerId`; we honour it when set, and
// fall back to the topmost layer otherwise — same rule Stage.vue uses, so
// place mode and library drag stay consistent.
const targetLayerId = computed<string | null>(() => activeLayer.resolveTarget(props.composition))

// ── derived: font assets registered on the composition ─────────────────
// `add_text` requires a `font` field naming an asset of type 'font'. In a
// fresh project there are no fonts, so we disable the text button with a
// tooltip rather than dispatching a command the validator will flag.
const fontAssets = computed<Array<{ id: string; family?: string }>>(() => {
  const assets = props.composition?.assets
  if (!Array.isArray(assets)) return []
  const out: Array<{ id: string; family?: string }> = []
  for (const a of assets as Array<{ id?: unknown; type?: unknown; family?: unknown }>) {
    if (a?.type !== 'font') continue
    if (typeof a.id !== 'string') continue
    out.push({
      id: a.id,
      family: typeof a.family === 'string' ? a.family : undefined,
    })
  }
  return out
})

const imageAssets = computed<Array<{ id: string; src?: string }>>(() => {
  const assets = props.composition?.assets
  if (!Array.isArray(assets)) return []
  const out: Array<{ id: string; src?: string }> = []
  for (const a of assets as Array<{ id?: unknown; type?: unknown; src?: unknown }>) {
    if (a?.type !== 'image') continue
    if (typeof a.id !== 'string') continue
    out.push({
      id: a.id,
      src: typeof a.src === 'string' ? a.src : undefined,
    })
  }
  return out
})

// ── UI state: popovers for text input and sprite asset picker ──────────
const textInputOpen = ref(false)
const textValue = ref('')
const spritePickerOpen = ref(false)
const textInputEl = ref<HTMLInputElement | null>(null)

function closePopovers(): void {
  textInputOpen.value = false
  spritePickerOpen.value = false
}

// ── button handlers ────────────────────────────────────────────────────
function pickShape(kind: 'rect' | 'circle'): void {
  closePopovers()
  // Toggle: clicking the active tool again cancels it. Lets users back out
  // without having to find the Escape key.
  const current = toolbar.activeTool.value
  if (
    (kind === 'rect' && current?.kind === 'shape-rect') ||
    (kind === 'circle' && current?.kind === 'shape-circle')
  ) {
    toolbar.clearTool()
    return
  }
  toolbar.setTool({ kind: kind === 'rect' ? 'shape-rect' : 'shape-circle' })
}

function startText(): void {
  closePopovers()
  if (fontAssets.value.length === 0) return
  // If text is already pending placement, a second click cancels.
  if (toolbar.activeTool.value?.kind === 'text') {
    toolbar.clearTool()
    return
  }
  textValue.value = 'Text'
  textInputOpen.value = true
  // Focus the input on the next tick so the user can immediately type.
  setTimeout(() => textInputEl.value?.select(), 0)
}

function confirmTextInput(): void {
  const text = textValue.value.trim().length > 0 ? textValue.value : 'Text'
  textInputOpen.value = false
  toolbar.setTool({ kind: 'text', text })
}

function cancelTextInput(): void {
  textInputOpen.value = false
}

function startSprite(): void {
  closePopovers()
  if (imageAssets.value.length === 0) return
  if (toolbar.activeTool.value?.kind === 'sprite') {
    toolbar.clearTool()
    return
  }
  spritePickerOpen.value = true
}

function chooseSprite(assetId: string): void {
  spritePickerOpen.value = false
  toolbar.setTool({ kind: 'sprite', asset: assetId })
}

// ── place-mode indicator + cancel ──────────────────────────────────────
function isToolActive(test: PlaceTool['kind']): boolean {
  return toolbar.activeTool.value?.kind === test
}

function cancelActiveTool(): void {
  toolbar.clearTool()
  closePopovers()
}

// Global Escape: cancels placement mode AND any open popover. Listening at
// the window level lets the user back out without having to focus the
// toolbar first (consistent with how Esc closes the help overlay).
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (!toolbar.isActive.value && !textInputOpen.value && !spritePickerOpen.value) return
  event.preventDefault()
  cancelActiveTool()
}

// Clear placement state if the composition swaps under us (project switch).
// A stale `sprite` tool referencing a now-missing asset would otherwise
// produce an immediate command error on the next click.
watch(
  () => props.composition,
  () => {
    toolbar.clearTool()
    closePopovers()
  },
)

// UX_GAPS §S — OnboardingOverlay routes its "Add a shape" CTA through a
// window event so this component can stay decoupled from the overlay.
function onFocusToolbarEvent(event: Event): void {
  const detail = (event as CustomEvent).detail as { kind?: string } | null
  const kind = detail?.kind
  if (kind === 'rect' || kind === 'circle') {
    pickShape(kind)
  } else if (kind === 'text') {
    startText()
  } else if (kind === 'sprite') {
    startSprite()
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('davidup:focus-toolbar-button', onFocusToolbarEvent)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('davidup:focus-toolbar-button', onFocusToolbarEvent)
  }
  toolbar.clearTool()
})

// ── button metadata ────────────────────────────────────────────────────
interface ToolButton {
  id: 'rect' | 'circle' | 'text' | 'sprite'
  label: string
  glyph: string
  active: boolean
  disabled: boolean
  title: string
  onClick: () => void
}

const buttons = computed<ToolButton[]>(() => [
  {
    id: 'rect',
    label: 'Rectangle',
    glyph: '▭',
    active: isToolActive('shape-rect'),
    disabled: targetLayerId.value === null,
    title: 'Add rectangle — click to enter place mode, then click on the stage',
    onClick: () => pickShape('rect'),
  },
  {
    id: 'circle',
    label: 'Circle',
    glyph: '◯',
    active: isToolActive('shape-circle'),
    disabled: targetLayerId.value === null,
    title: 'Add circle — click to enter place mode, then click on the stage',
    onClick: () => pickShape('circle'),
  },
  {
    id: 'text',
    label: 'Text',
    glyph: 'T',
    active: isToolActive('text') || textInputOpen.value,
    disabled: targetLayerId.value === null || fontAssets.value.length === 0,
    title:
      fontAssets.value.length === 0
        ? 'Add a font asset to the composition before placing text'
        : 'Add text — type, then click on the stage',
    onClick: startText,
  },
  {
    id: 'sprite',
    label: 'Sprite',
    glyph: '◧',
    active: isToolActive('sprite') || spritePickerOpen.value,
    disabled: targetLayerId.value === null || imageAssets.value.length === 0,
    title:
      imageAssets.value.length === 0
        ? 'Drop an image asset into the Library before placing a sprite'
        : 'Add sprite — pick an asset, then click on the stage',
    onClick: startSprite,
  },
])
</script>

<template>
  <div
    class="item-toolbar"
    data-testid="item-toolbar"
    :data-place-active="toolbar.isActive.value ? 'true' : 'false'"
  >
    <button
      v-for="btn in buttons"
      :key="btn.id"
      type="button"
      class="tool-btn"
      :class="{ active: btn.active }"
      :disabled="btn.disabled"
      :title="btn.title"
      :aria-pressed="btn.active ? 'true' : 'false'"
      :data-testid="`item-toolbar-${btn.id}`"
      @click="btn.onClick"
    >
      <span class="tool-glyph" aria-hidden="true">{{ btn.glyph }}</span>
      <span class="tool-label">{{ btn.label }}</span>
    </button>

    <div class="tool-divider" aria-hidden="true" />

    <button
      type="button"
      class="tool-btn"
      :disabled="!canGroup"
      :title="canGroup
        ? 'Group selection (⌘G / Ctrl+G)'
        : 'Select 2+ items on the same layer to group'"
      data-testid="item-toolbar-group"
      @click="emit('group')"
    >
      <span class="tool-glyph" aria-hidden="true">⛶</span>
      <span class="tool-label">Group</span>
    </button>

    <button
      type="button"
      class="tool-btn"
      :disabled="!canUngroup"
      :title="canUngroup
        ? 'Ungroup selected group (⌘⇧G / Ctrl+Shift+G)'
        : 'Select a single group to ungroup'"
      data-testid="item-toolbar-ungroup"
      @click="emit('ungroup')"
    >
      <span class="tool-glyph" aria-hidden="true">⊟</span>
      <span class="tool-label">Ungroup</span>
    </button>

    <div
      v-if="toolbar.isActive.value"
      class="place-banner"
      data-testid="item-toolbar-place-banner"
    >
      <span>Click stage to place</span>
      <button
        type="button"
        class="place-cancel"
        title="Cancel placement (Esc)"
        data-testid="item-toolbar-cancel"
        @click="cancelActiveTool"
      >
        ×
      </button>
    </div>

    <div
      v-if="textInputOpen"
      class="popover popover-text"
      data-testid="item-toolbar-text-input"
    >
      <label class="popover-label">Text</label>
      <input
        ref="textInputEl"
        v-model="textValue"
        type="text"
        class="popover-input"
        placeholder="Text"
        @keydown.enter.prevent="confirmTextInput"
        @keydown.escape.prevent="cancelTextInput"
      />
      <div class="popover-actions">
        <button type="button" class="popover-btn ghost" @click="cancelTextInput">
          Cancel
        </button>
        <button
          type="button"
          class="popover-btn primary"
          data-testid="item-toolbar-text-confirm"
          @click="confirmTextInput"
        >
          Place
        </button>
      </div>
    </div>

    <div
      v-if="spritePickerOpen"
      class="popover popover-sprite"
      data-testid="item-toolbar-sprite-picker"
    >
      <label class="popover-label">Choose image</label>
      <ul class="sprite-list">
        <li v-for="a in imageAssets" :key="a.id">
          <button
            type="button"
            class="sprite-row"
            :data-testid="`item-toolbar-sprite-${a.id}`"
            @click="chooseSprite(a.id)"
          >
            <span class="sprite-row-id">{{ a.id }}</span>
            <span v-if="a.src" class="sprite-row-src">{{ a.src }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.item-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  background: rgba(13, 13, 13, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  font-family: 'Instrument Sans', system-ui, sans-serif;
  color: #e5e5e5;
  pointer-events: auto;
}

.tool-btn {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  color: #d4d4d4;
  width: 56px;
  padding: 8px 4px;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  font: inherit;
}

.tool-btn:hover:not(:disabled) {
  background: rgba(91, 124, 250, 0.12);
  border-color: rgba(91, 124, 250, 0.35);
  color: #f0f0f0;
}

.tool-btn.active {
  background: rgba(91, 124, 250, 0.22);
  border-color: rgba(91, 124, 250, 0.7);
  color: #ffffff;
}

.tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tool-glyph {
  font-size: 18px;
  line-height: 1;
}

.tool-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 4px;
}

.tool-label {
  font-size: 10.5px;
  letter-spacing: 0.02em;
}

.place-banner {
  margin-top: 4px;
  padding: 6px 8px;
  background: rgba(91, 124, 250, 0.18);
  border: 1px solid rgba(91, 124, 250, 0.55);
  border-radius: 6px;
  font-size: 10.5px;
  color: #e7ecff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  text-align: center;
  line-height: 1.2;
}

.place-cancel {
  appearance: none;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.place-cancel:hover {
  background: rgba(255, 255, 255, 0.12);
}

.popover {
  position: absolute;
  left: calc(100% + 8px);
  top: 0;
  min-width: 220px;
  max-width: 320px;
  padding: 10px;
  background: #131313;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.popover-label {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #909090;
}

.popover-input {
  appearance: none;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #f0f0f0;
  padding: 6px 8px;
  border-radius: 5px;
  font: inherit;
  font-size: 13px;
}

.popover-input:focus {
  outline: none;
  border-color: rgba(91, 124, 250, 0.65);
  background: rgba(91, 124, 250, 0.08);
}

.popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.popover-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: #d4d4d4;
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 5px;
  cursor: pointer;
}

.popover-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.06);
}

.popover-btn.primary {
  background: rgba(91, 124, 250, 0.2);
  border-color: rgba(91, 124, 250, 0.6);
  color: #ffffff;
}

.popover-btn.primary:hover {
  background: rgba(91, 124, 250, 0.32);
}

.popover-sprite {
  max-height: 280px;
}

.sprite-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
}

.sprite-row {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  color: #e5e5e5;
  font: inherit;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sprite-row:hover {
  background: rgba(91, 124, 250, 0.12);
  border-color: rgba(91, 124, 250, 0.35);
}

.sprite-row-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #f0f0f0;
}

.sprite-row-src {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #909090;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
