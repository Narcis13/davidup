<script setup lang="ts">
// LibraryCard — step 13 of the editor build plan.
//
// One card per library catalog entry. Shows a 1-second preview thumbnail
// (lazy-loaded from `/api/library/thumbnail`), the item name, and its
// provenance (kind + source file). The thumbnail request goes through the
// existing `render_preview_frame` path on the server; when synthesis
// isn't viable the server returns a styled placeholder PNG and tags the
// response with `X-Thumbnail-Placeholder: 1` — we surface that as a small
// kind badge over the image.
//
// IntersectionObserver gates the fetch so cards below the fold don't
// trigger renders until they scroll into view.

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { LibraryItem } from '~/composables/useLibrary'
import { useLibraryDrag } from '~/composables/useLibraryDrag'

interface AssetUsageEntry {
  registered: boolean
  usages: number
  usingItemIds: ReadonlyArray<string>
}

const props = defineProps<{
  item: LibraryItem
  /** Cache-buster bumped when the catalog reloads. */
  generation?: number
  /** Disables the promote action while a request is in flight. */
  promoteBusy?: boolean
  /**
   * Usage info for `kind: 'asset'` / `kind: 'font'` cards. Null for other
   * kinds (templates, scenes, behaviors). When present, drives the "Used
   * by N · Unused · Not registered" badge and gates the remove button.
   */
  assetUsage?: AssetUsageEntry | null
}>()

const emit = defineEmits<{
  (event: 'promote', item: LibraryItem): void
  (event: 'apply', item: LibraryItem): void
  (event: 'add', item: LibraryItem): void
  (event: 'remove', item: LibraryItem): void
}>()

// Promotion is only meaningful for JSON definitions authored as standalone
// files inside the project library. Inline entries (index.json) and
// asset/font binaries are out of scope for v1.
const PROMOTABLE_KINDS = new Set(['template', 'behavior', 'scene'])

const canPromote = computed(() => {
  if (props.item.scope !== 'project') return false
  if (!PROMOTABLE_KINDS.has(props.item.kind)) return false
  if (!props.item.source || props.item.source === 'index.json') return false
  return true
})

function onPromote(event: Event): void {
  event.stopPropagation()
  event.preventDefault()
  if (!canPromote.value || props.promoteBusy) return
  emit('promote', props.item)
}

// "Apply…" button: deliberate insertion path for parameterized templates,
// opening the override dialog. Available on every template card so the
// non-param case also has a click-to-apply affordance.
const canApply = computed(() => props.item.kind === 'template')
const hasParams = computed(
  () => Array.isArray(props.item.params) && props.item.params.length > 0,
)

function onApply(event: Event): void {
  event.stopPropagation()
  event.preventDefault()
  if (!canApply.value) return
  emit('apply', props.item)
}

// Step 14: library cards are draggable. We push the catalog payload onto the
// shared `useLibraryDrag` state and the dataTransfer MIME so Stage / Timeline
// drop targets can resolve it.
const libraryDrag = useLibraryDrag()
const isDragging = ref(false)

function onDragStart(event: DragEvent): void {
  libraryDrag.onDragStart(props.item, event)
  isDragging.value = true
}

function onDragEnd(): void {
  libraryDrag.onDragEnd()
  isDragging.value = false
}

const root = ref<HTMLElement | null>(null)
const inView = ref(false)
const loaded = ref(false)
const errored = ref(false)

let observer: IntersectionObserver | null = null

onMounted(() => {
  if (!root.value) return
  if (typeof IntersectionObserver === 'undefined') {
    // SSR / test fallback — load immediately.
    inView.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          inView.value = true
          if (observer && entry.target instanceof Element) observer.unobserve(entry.target)
        }
      }
    },
    { rootMargin: '80px' }
  )
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
  observer = null
})

const isFontKind = computed(() => props.item.kind === 'font')

const thumbnailSrc = computed(() => {
  // Fonts get a client-side preview rendered in the font itself (below),
  // so we deliberately skip the server thumbnail PNG for them — the
  // placeholder it returns when synth fails is the very thing UX_FINDINGS §7
  // calls out.
  if (isFontKind.value) return null
  if (!inView.value) return null
  const params = new URLSearchParams({ kind: props.item.kind, id: props.item.id })
  if (props.generation) params.set('v', String(props.generation))
  return `/api/library/thumbnail?${params.toString()}`
})

// ─── Client-side font preview (UX_FINDINGS §7) ───────────────────────────
//
// The server thumbnail endpoint falls back to a plain-text placeholder when
// it can't resolve the font file (e.g. `global:fonts/...` srcs), so fonts
// end up rendering as anonymous text rows with no glyph cue. We solve that
// here by loading the actual TTF/WOFF via the FontFace API and showing the
// family name + an "AaBbCc 123" sample rendered in that font.

const loadedFontFamilies = (() => {
  // Module-level cache so re-mounting a card (panel scroll / tab switch)
  // doesn't re-fetch the same font, and so two cards for the same id share
  // the same registered family alias.
  const g = globalThis as typeof globalThis & { __dvpLibraryFontFamilies?: Set<string> }
  if (!g.__dvpLibraryFontFamilies) g.__dvpLibraryFontFamilies = new Set()
  return g.__dvpLibraryFontFamilies
})()

function libraryAssetUrl(item: LibraryItem): string | null {
  const raw = (item.raw as { url?: string; src?: string } | null) ?? {}
  const src = item.url ?? raw.url ?? raw.src
  if (typeof src !== 'string' || src.length === 0) return null
  if (src.startsWith('global:')) {
    return `/library-files/${src.slice('global:'.length).replace(/^\/+/, '')}`
  }
  if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:')) return src
  const trimmed = src.replace(/^(?:\.{1,2}\/)+/, '').replace(/^\/+/, '')
  return item.scope === 'global'
    ? `/library-files/${trimmed}`
    : `/project-files/${trimmed}`
}

const fontAssetUrl = computed(() => (isFontKind.value ? libraryAssetUrl(props.item) : null))

// Synthetic family alias keeps two fonts that share a `family` field (e.g.
// "Inter Regular" + "Inter Bold" both calling themselves "Inter") rendering
// in their own face on the card.
const fontFamilyAlias = computed(() =>
  isFontKind.value ? `dvp-libcard-${props.item.id}` : null
)

const fontLoaded = ref(false)
const fontErrored = ref(false)

async function loadFontPreview(): Promise<void> {
  if (!isFontKind.value || fontLoaded.value || fontErrored.value) return
  const alias = fontFamilyAlias.value
  const url = fontAssetUrl.value
  if (!alias || !url) {
    fontErrored.value = true
    return
  }
  if (loadedFontFamilies.has(alias)) {
    fontLoaded.value = true
    return
  }
  const FontFaceCtor = (globalThis as { FontFace?: typeof FontFace }).FontFace
  const doc = (globalThis as { document?: Document }).document
  if (!FontFaceCtor || !doc) {
    fontErrored.value = true
    return
  }
  try {
    const face = new FontFaceCtor(alias, `url("${url}")`)
    await face.load()
    ;(doc.fonts as unknown as { add(f: FontFace): unknown }).add(face)
    loadedFontFamilies.add(alias)
    fontLoaded.value = true
  } catch {
    fontErrored.value = true
  }
}

watch(inView, (v) => {
  if (v) void loadFontPreview()
})

const fontPreviewStyle = computed(() => {
  if (!isFontKind.value) return undefined
  // Keep a sensible fallback while the file is still loading so the row
  // never looks blank — once the FontFace resolves the browser swaps in
  // the real face automatically.
  const family = fontLoaded.value && fontFamilyAlias.value
    ? `"${fontFamilyAlias.value}", system-ui, sans-serif`
    : 'system-ui, sans-serif'
  return { fontFamily: family }
})

const provenance = computed(() => {
  if (props.item.source && props.item.source !== 'index.json') return props.item.source
  return 'inline'
})

const displayName = computed(() => props.item.name ?? props.item.id)
const subtitle = computed(() => {
  if (props.item.description) return props.item.description
  return props.item.id
})

const kindLabel = computed(() => props.item.kind)

// "Add" button: discoverable click-path for fonts / behaviors / scenes so the
// library is usable without prior drag-and-drop knowledge (UX_FINDINGS §6).
// Drag-drop remains the power-user path; the parent decides what to do per
// kind (register the font asset, apply behavior to selection, drop a scene
// instance on the first layer).
const ADD_KINDS = new Set(['font', 'behavior', 'scene'])
const canAdd = computed(() => {
  if (!ADD_KINDS.has(props.item.kind)) return false
  // For fonts, hide the Add button once the asset is already registered so it
  // doesn't overlap (or duplicate) the Remove button at the same bottom-left.
  if (props.item.kind === 'font' && props.assetUsage?.registered) return false
  return true
})
const addLabel = computed(() => {
  if (props.item.kind === 'behavior') return '+ Apply'
  return '+ Add'
})
const addTitle = computed(() => {
  if (props.item.kind === 'font') {
    return `Register "${displayName.value}" in this composition so the Text tool can use it`
  }
  if (props.item.kind === 'behavior') {
    return `Apply ${displayName.value} to the selected item at the playhead (select an item first)`
  }
  if (props.item.kind === 'scene') {
    return `Insert ${displayName.value} on the first layer at the playhead`
  }
  return `Add ${displayName.value} to the composition`
})

function onAdd(event: Event): void {
  event.stopPropagation()
  event.preventDefault()
  if (!canAdd.value) return
  emit('add', props.item)
}

const scope = computed(() => props.item.scope ?? 'project')
const scopeChip = computed(() => (scope.value === 'global' ? '🌐' : '📁'))
const scopeChipTitle = computed(() =>
  scope.value === 'global' ? 'Global library (~/.davidup/library)' : 'Project library'
)
const isOverridden = computed(() => props.item.overridden === true)
const overrideTitle = computed(() =>
  isOverridden.value ? 'Shadowed by a project entry with the same id' : ''
)

// ─── Asset usage / remove (UX_GAPS §J) ───────────────────────────────────
const isAssetKind = computed(() => props.item.kind === 'asset' || props.item.kind === 'font')

const usageBadge = computed<{ tone: 'reg' | 'unused' | 'unreg'; text: string; title: string } | null>(() => {
  if (!isAssetKind.value) return null
  const u = props.assetUsage
  if (!u) return null
  if (!u.registered) {
    return {
      tone: 'unreg',
      text: 'Not registered',
      title: 'No entry in the current composition\'s `assets` array — the engine cannot resolve it until registered.',
    }
  }
  if (u.usages === 0) {
    return {
      tone: 'unused',
      text: 'Unused',
      title: 'Registered in composition.assets but no item currently references it. Safe to remove.',
    }
  }
  const sample = u.usingItemIds.slice(0, 3).join(', ')
  const tail = u.usingItemIds.length > 3 ? `, …(+${u.usingItemIds.length - 3})` : ''
  return {
    tone: 'reg',
    text: `Used by ${u.usages}`,
    title: `Referenced by: ${sample}${tail}`,
  }
})

const canRemove = computed<boolean>(() => {
  if (!isAssetKind.value) return false
  const u = props.assetUsage
  return u !== null && u !== undefined && u.registered
})

const removeTitle = computed<string>(() => {
  if (!isAssetKind.value) return ''
  const u = props.assetUsage
  if (!u || !u.registered) return 'Asset is not registered in the current composition'
  if (u.usages > 0) return `Remove "${props.item.id}" from composition.assets (${u.usages} item(s) still reference it — will need to be reassigned first)`
  return `Remove "${props.item.id}" from composition.assets`
})

function onRemove(event: Event): void {
  event.stopPropagation()
  event.preventDefault()
  if (!canRemove.value) return
  emit('remove', props.item)
}
</script>

<template>
  <article
    ref="root"
    class="library-card"
    :data-kind="item.kind"
    :data-item-id="item.id"
    :data-scope="scope"
    :data-overridden="isOverridden ? 'true' : null"
    :data-dragging="isDragging ? 'true' : null"
    draggable="true"
    tabindex="0"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <div class="thumb-wrap">
      <div
        v-if="isFontKind"
        class="thumb thumb-font"
        :style="fontPreviewStyle"
        data-testid="library-font-preview"
      >
        <span class="font-sample">AaBbCc 123</span>
        <span class="font-name">{{ displayName }}</span>
      </div>
      <img
        v-else-if="thumbnailSrc && !errored"
        :src="thumbnailSrc"
        :alt="`${item.kind} preview · ${displayName}`"
        class="thumb"
        loading="lazy"
        decoding="async"
        @load="loaded = true"
        @error="errored = true"
      />
      <div v-else-if="!inView" class="thumb thumb-pending" aria-hidden="true" />
      <div v-else class="thumb thumb-error" aria-hidden="true">
        <span class="thumb-error-text">no preview</span>
      </div>

      <div
        v-if="!isFontKind && !loaded && !errored && inView"
        class="thumb-shimmer"
        aria-hidden="true"
      />

      <span class="kind-badge" :data-kind="item.kind">{{ kindLabel }}</span>
      <span
        class="scope-chip"
        :data-scope="scope"
        :title="scopeChipTitle"
        aria-hidden="true"
      >
        {{ scopeChip }}
      </span>
      <button
        v-if="canPromote"
        type="button"
        class="promote-btn"
        :disabled="promoteBusy"
        :title="`Promote to global library (move to ~/.davidup/library)`"
        :aria-label="`Promote ${displayName} to global library`"
        data-testid="library-promote"
        draggable="false"
        @mousedown.stop
        @click="onPromote"
        @keydown.enter.stop="onPromote"
        @keydown.space.stop="onPromote"
      >
        {{ promoteBusy ? '…' : '↑ 🌐' }}
      </button>
      <button
        v-if="canApply"
        type="button"
        class="apply-btn"
        :title="hasParams
          ? `Apply ${displayName} with custom parameters`
          : `Apply ${displayName}`"
        :aria-label="hasParams
          ? `Apply ${displayName} with parameters`
          : `Apply ${displayName}`"
        data-testid="library-apply"
        draggable="false"
        @mousedown.stop
        @click="onApply"
        @keydown.enter.stop="onApply"
        @keydown.space.stop="onApply"
      >
        {{ hasParams ? 'Apply…' : 'Apply' }}
      </button>
      <button
        v-if="canAdd"
        type="button"
        class="add-btn"
        :title="addTitle"
        :aria-label="addTitle"
        data-testid="library-add"
        draggable="false"
        @mousedown.stop
        @click="onAdd"
        @keydown.enter.stop="onAdd"
        @keydown.space.stop="onAdd"
      >
        {{ addLabel }}
      </button>
      <button
        v-if="canRemove"
        type="button"
        class="remove-btn"
        :title="removeTitle"
        :aria-label="`Remove asset ${displayName} from composition`"
        data-testid="library-remove-asset"
        draggable="false"
        @mousedown.stop
        @click="onRemove"
        @keydown.enter.stop="onRemove"
        @keydown.space.stop="onRemove"
      >✕</button>
    </div>
    <div class="meta">
      <h3 class="name" :class="{ 'name-overridden': isOverridden }" :title="displayName">
        {{ displayName }}
      </h3>
      <p class="sub" :title="subtitle">{{ subtitle }}</p>
      <p
        class="prov"
        :class="{ 'prov-overridden': isOverridden }"
        :title="isOverridden ? overrideTitle : provenance"
      >
        <span class="prov-dot" />
        <span class="prov-text">{{ provenance }}</span>
        <span v-if="isOverridden" class="prov-note">overridden</span>
      </p>
      <p
        v-if="usageBadge"
        class="usage"
        :data-tone="usageBadge.tone"
        :title="usageBadge.title"
        data-testid="library-asset-usage"
      >
        <span class="usage-dot" />
        <span class="usage-text">{{ usageBadge.text }}</span>
      </p>
    </div>
  </article>
</template>

<style scoped>
.library-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: grab;
  outline: none;
  transition: border-color 120ms ease, transform 120ms ease;
}

.library-card:hover {
  border-color: rgba(91, 124, 250, 0.45);
}

.library-card:focus-visible {
  border-color: rgba(91, 124, 250, 0.65);
  box-shadow: 0 0 0 2px rgba(91, 124, 250, 0.25);
}

.library-card[data-dragging='true'] {
  opacity: 0.45;
  transform: scale(0.98);
}

.thumb-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #050505;
  overflow: hidden;
}

.thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #050505;
}

.thumb-pending,
.thumb-error {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #050505;
  color: #404040;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.thumb-font {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 14px;
  background: linear-gradient(135deg, #0c0c10 0%, #0a0a14 100%);
  color: #f5f5f5;
  text-align: center;
  overflow: hidden;
}

.font-sample {
  font-size: 28px;
  line-height: 1.05;
  font-weight: inherit;
  white-space: nowrap;
  letter-spacing: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.font-name {
  font-size: 14px;
  color: rgba(229, 229, 229, 0.78);
  letter-spacing: 0.02em;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thumb-error-text {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.thumb-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.04) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  animation: shimmer 1.2s linear infinite;
  pointer-events: none;
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.kind-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  color: #e5e5e5;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  pointer-events: none;
}

.scope-chip {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 12px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
  user-select: none;
}

.promote-btn {
  position: absolute;
  bottom: 6px;
  right: 6px;
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 4px;
  background: rgba(91, 124, 250, 0.18);
  border: 1px solid rgba(91, 124, 250, 0.45);
  color: #c9d4ff;
  cursor: pointer;
  letter-spacing: 0.04em;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, transform 120ms ease;
  z-index: 2;
}

.library-card:hover .promote-btn,
.library-card:focus-within .promote-btn {
  opacity: 1;
}

.promote-btn:hover:not(:disabled) {
  background: rgba(91, 124, 250, 0.32);
  transform: translateY(-1px);
}

.promote-btn:disabled {
  opacity: 0.55;
  cursor: progress;
}

.apply-btn {
  position: absolute;
  bottom: 6px;
  left: 6px;
  font-size: 11px;
  line-height: 1;
  padding: 4px 9px;
  border-radius: 4px;
  background: rgba(255, 184, 107, 0.18);
  border: 1px solid rgba(255, 184, 107, 0.45);
  color: #ffd0a3;
  cursor: pointer;
  letter-spacing: 0.04em;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, transform 120ms ease;
  z-index: 2;
  font-family: inherit;
}

.library-card:hover .apply-btn,
.library-card:focus-within .apply-btn {
  opacity: 1;
}

.apply-btn:hover {
  background: rgba(255, 184, 107, 0.32);
  transform: translateY(-1px);
}

.add-btn {
  position: absolute;
  bottom: 6px;
  left: 6px;
  font-size: 11px;
  line-height: 1;
  padding: 4px 9px;
  border-radius: 4px;
  background: rgba(107, 208, 107, 0.18);
  border: 1px solid rgba(107, 208, 107, 0.45);
  color: #c9efc9;
  cursor: pointer;
  letter-spacing: 0.04em;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, transform 120ms ease;
  z-index: 2;
  font-family: inherit;
}

.library-card:hover .add-btn,
.library-card:focus-within .add-btn {
  opacity: 1;
}

.add-btn:hover {
  background: rgba(107, 208, 107, 0.32);
  border-color: rgba(107, 208, 107, 0.7);
  transform: translateY(-1px);
}

.remove-btn {
  position: absolute;
  bottom: 6px;
  left: 6px;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(255, 90, 90, 0.16);
  border: 1px solid rgba(255, 90, 90, 0.42);
  color: #ffb4b4;
  cursor: pointer;
  letter-spacing: 0.04em;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, transform 120ms ease;
  z-index: 2;
  font-family: inherit;
}

.library-card:hover .remove-btn,
.library-card:focus-within .remove-btn {
  opacity: 1;
}

.remove-btn:hover {
  background: rgba(255, 90, 90, 0.32);
  border-color: rgba(255, 90, 90, 0.7);
  color: #ffffff;
  transform: translateY(-1px);
}

.library-card[data-overridden='true'] .scope-chip {
  opacity: 0.45;
}

.kind-badge[data-kind='template'] {
  color: #ffb86b;
}
.kind-badge[data-kind='behavior'] {
  color: #6bd06b;
}
.kind-badge[data-kind='scene'] {
  color: #ffd66b;
}
.kind-badge[data-kind='asset'] {
  color: #8aa8ff;
}
.kind-badge[data-kind='font'] {
  color: #cf8aff;
}

.meta {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: #e5e5e5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub {
  font-size: 11px;
  color: #909090;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prov {
  font-size: 10px;
  color: #707070;
  margin: 2px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prov-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  flex: 0 0 auto;
}

.prov-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.prov-note {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 2px;
  background: rgba(255, 184, 107, 0.18);
  color: #ffb86b;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  flex: 0 0 auto;
}

.library-card[data-overridden='true'] {
  opacity: 0.72;
}

.library-card[data-overridden='true'] .thumb-wrap {
  opacity: 0.7;
}

.name-overridden {
  text-decoration: line-through;
  text-decoration-color: rgba(255, 184, 107, 0.6);
  text-decoration-thickness: 1px;
  color: #b0b0b0;
}

.prov-overridden .prov-text {
  text-decoration: line-through;
  text-decoration-color: rgba(255, 184, 107, 0.55);
  text-decoration-thickness: 1px;
}

.usage {
  font-size: 10px;
  margin: 2px 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.usage-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.usage[data-tone='reg'] {
  color: #8aa8ff;
}

.usage[data-tone='reg'] .usage-dot {
  background: #5b7cfa;
}

.usage[data-tone='unused'] {
  color: #d4d4d4;
}

.usage[data-tone='unused'] .usage-dot {
  background: rgba(255, 255, 255, 0.45);
}

.usage[data-tone='unreg'] {
  color: #707070;
}

.usage[data-tone='unreg'] .usage-dot {
  background: rgba(255, 255, 255, 0.18);
}
</style>
