<script setup lang="ts">
// RecordDrawer — the asset library's record drawer (docs/asset-library-plan.md E4).
//
// Clicking a record card in the Library panel opens this over the grid: the
// preview, what search reads (name, desc, tags, licence, credit, source), the
// record's facts, what it was made from and what was made from it, and where
// the open composition uses it. The record comes from `GET
// /api/library/record` (the MCP `get_asset`); an edit is `POST
// /api/library/record` (the MCP `tag_asset`). A text field is sent when it
// changes (Enter or leaving it), a tag or the licence at once. The edit
// writes the shelf, not the composition: no undo step, and a composition that
// registered the record keeps the credit and licence it copied then (the
// "Used here" rows say so).

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LibraryItem } from '~/composables/useLibrary'
import { useToasts } from '~/composables/useToasts'
import {
  RECORD_LICENCES,
  newTags,
  recordUses,
  textEdit,
  type CompositionUsageLike,
  type RecordTextField,
} from '~/composables/recordDrawerMath'

interface RecordFields {
  id: string
  kind: string
  media?: string
  name?: string
  desc?: string | null
  tags?: string[]
  licence?: string
  credit?: string
  source?: string
  sha?: string
  ext?: string
  bytes?: number
  added?: string
  by?: string
  w?: number
  h?: number
  sec?: number
  family?: string
  dark?: boolean
  made?: { tool?: string; at?: string } | null
  [k: string]: unknown
}

interface RecordDetail {
  record: RecordFields
  shelf: string
  shelves: string[]
  same: { shelf: string; id: string }[]
  made: {
    from: ({ id: string; kind: string; shelf: string } | { id: string; missing: true })[]
    into: { id: string; kind: string; shelf: string; tool?: string }[]
  }
}

const props = defineProps<{
  /** The card clicked; null keeps the drawer closed. */
  item: LibraryItem | null
  composition?: CompositionUsageLike | null
  /** The catalog's generation, so the preview follows a redraw. */
  generation?: number
}>()

const emit = defineEmits<{
  (event: 'close'): void
  /** The record was edited: the panel re-reads the catalog. */
  (event: 'changed', id: string): void
  /** Another record named in the drawer (made from / into) was clicked. */
  (event: 'open', id: string): void
}>()

const toasts = useToasts()

const detail = ref<RecordDetail | null>(null)
const loadError = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)

// The inputs' values, reset from the record whenever it is (re)read.
const draft = ref<Record<RecordTextField, string>>({ name: '', desc: '', credit: '', source: '' })
const tagInput = ref('')

const recordId = computed(() => props.item?.id ?? null)

function resetDraft(): void {
  const r = detail.value?.record
  draft.value = {
    name: r?.name ?? '',
    desc: r?.desc ?? '',
    credit: r?.credit ?? '',
    source: r?.source ?? '',
  }
}

let requestSeq = 0

async function load(id: string): Promise<void> {
  const seq = ++requestSeq
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch(`/api/library/record?id=${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json' },
    })
    const body = (await res.json().catch(() => null)) as
      | (RecordDetail & { error?: undefined })
      | { error?: { message?: string } }
      | null
    if (seq !== requestSeq) return
    if (!res.ok || !body || 'error' in body && body.error) {
      detail.value = null
      loadError.value = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`
      return
    }
    detail.value = body as RecordDetail
    resetDraft()
  } catch (err) {
    if (seq !== requestSeq) return
    detail.value = null
    loadError.value = (err as Error).message
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

watch(
  recordId,
  (id) => {
    tagInput.value = ''
    if (id) void load(id)
    else detail.value = null
  },
  { immediate: true }
)

/** Send one `tag_asset` edit; the drawer shows the record as it is after it. */
async function save(patch: Record<string, unknown>): Promise<boolean> {
  const d = detail.value
  if (!d) return false
  saving.value = true
  try {
    const res = await fetch('/api/library/record', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-inertia': 'false' },
      body: JSON.stringify({ id: d.record.id, shelf: d.shelf, ...patch }),
    })
    const body = (await res.json().catch(() => null)) as
      | { edit: { warnings?: string[] }; detail: RecordDetail }
      | { error?: { message?: string; hint?: string } }
      | null
    if (!res.ok || !body || !('detail' in body)) {
      const err = (body as { error?: { message?: string; hint?: string } } | null)?.error
      toasts.error(err?.message ?? `Saving "${d.record.id}" failed (HTTP ${res.status})`, {
        ...(err?.hint ? { message: err.hint } : {}),
        dedupeKey: `library:record:${d.record.id}`,
      })
      resetDraft()
      return false
    }
    detail.value = body.detail
    resetDraft()
    for (const w of body.edit.warnings ?? []) {
      toasts.warning(w, { dedupeKey: `library:record:${d.record.id}:warn` })
    }
    emit('changed', d.record.id)
    return true
  } catch (err) {
    toasts.error(`Saving "${d.record.id}" failed: ${(err as Error).message}`, {
      dedupeKey: `library:record:${d.record.id}`,
    })
    resetDraft()
    return false
  } finally {
    saving.value = false
  }
}

function commitText(field: RecordTextField): void {
  const r = detail.value?.record
  if (!r || saving.value) return
  const patch = textEdit(field, r[field] as string | undefined | null, draft.value[field])
  if (!patch) {
    resetDraft()
    return
  }
  void save(patch)
}

const tags = computed<string[]>(() => detail.value?.record.tags ?? [])

async function addTags(): Promise<void> {
  const add = newTags(tagInput.value, tags.value)
  if (add.length === 0) {
    tagInput.value = ''
    return
  }
  if (await save({ add })) tagInput.value = ''
}

function removeTag(tag: string): void {
  void save({ remove: [tag] })
}

function onTagKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    void addTags()
  } else if (event.key === 'Backspace' && tagInput.value === '' && tags.value.length > 0) {
    removeTag(tags.value[tags.value.length - 1]!)
  }
}

function onLicence(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value && value !== detail.value?.record.licence) void save({ licence: value })
}

// ─── What the drawer shows ───────────────────────────────────────────────

const record = computed(() => detail.value?.record ?? null)

const SHELF_LABELS: Record<string, string> = {
  project: 'project shelf',
  user: 'your shelf',
  house: 'house shelf',
}

const facts = computed<{ label: string; value: string }[]>(() => {
  const r = record.value
  const d = detail.value
  if (!r || !d) return []
  const out: { label: string; value: string }[] = [
    { label: 'Id', value: r.id },
    { label: 'Kind', value: r.media ? `${r.kind} · ${r.media}` : r.kind },
    {
      label: 'Shelf',
      value: [d.shelf, ...d.shelves.slice(1).map((s) => `hides ${s}`)]
        .map((s) => SHELF_LABELS[s] ?? s)
        .join(' · '),
    },
  ]
  if (r.w && r.h) out.push({ label: 'Size', value: `${r.w} × ${r.h}` })
  if (typeof r.sec === 'number') out.push({ label: 'Length', value: `${r.sec.toFixed(2)} s` })
  if (r.family) out.push({ label: 'Family', value: r.family })
  if (typeof r.bytes === 'number') out.push({ label: 'File', value: `${formatBytes(r.bytes)}${r.ext ? ` · ${r.ext}` : ''}` })
  if (r.sha) out.push({ label: 'Sha', value: r.sha.slice(0, 12) })
  if (r.added || r.by) out.push({ label: 'Added', value: [r.added, r.by].filter(Boolean).join(' · ') })
  if (r.made?.tool) out.push({ label: 'Made by', value: [r.made.tool, r.made.at].filter(Boolean).join(' · ') })
  if (d.same.length > 0) {
    out.push({ label: 'Same bytes', value: d.same.map((s) => `${s.id} (${SHELF_LABELS[s.shelf] ?? s.shelf})`).join(', ') })
  }
  return out
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const uses = computed(() =>
  record.value ? recordUses(props.composition, record.value.id, record.value.sha) : []
)

/** A use whose copied credit or licence is not the record's any more. */
function copiedDiffers(u: { credit: string; licence: string }): boolean {
  const r = record.value
  if (!r) return false
  return (u.credit || '') !== (r.credit || '') || (u.licence || '') !== (r.licence || '')
}

const sourceIsLink = computed(() => /^https?:\/\//i.test(record.value?.source ?? ''))

// ─── Preview ────────────────────────────────────────────────────────────

const assetType = computed(() => props.item?.assetType)

const fileUrl = computed(() => {
  const url = props.item?.url
  return typeof url === 'string' && url.startsWith('asset:') ? `/asset-files/${url.slice('asset:'.length)}` : null
})

const thumbUrl = computed(() => {
  const item = props.item
  if (!item || assetType.value === 'audio' || assetType.value === 'font') return null
  const params = new URLSearchParams({ kind: item.kind, id: item.id })
  if (props.generation) params.set('v', String(props.generation))
  return `/api/library/thumbnail?${params.toString()}`
})

const thumbFailed = ref(false)
watch(thumbUrl, () => {
  thumbFailed.value = false
})

// The card registered the font's face under this alias (LibraryCard.vue).
const fontStyle = computed(() =>
  props.item ? { fontFamily: `"dvp-libcard-${props.item.id}", system-ui, sans-serif` } : undefined
)

// ─── Closing ────────────────────────────────────────────────────────────

const panel = ref<HTMLElement | null>(null)

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !props.item) return
  // Only an Escape inside the drawer: the stage and the timeline have their own.
  const t = event.target as HTMLElement | null
  if (!t || !panel.value?.contains(t)) return
  // Escape in a field drops what was typed first; a second one closes.
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
    resetDraft()
    tagInput.value = ''
    t.blur()
    panel.value.focus()
    return
  }
  emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

watch(recordId, async (id) => {
  if (!id) return
  await nextTick()
  panel.value?.focus()
})
</script>

<template>
  <aside
    v-if="item"
    ref="panel"
    class="record-drawer"
    role="dialog"
    :aria-label="`Asset record ${item.id}`"
    tabindex="-1"
    data-testid="record-drawer"
    :data-record-id="item.id"
    :data-saving="saving ? 'true' : null"
  >
    <header class="head">
      <div class="head-text">
        <span class="eyebrow">{{ record?.kind ?? item.assetKind ?? item.kind }} record</span>
        <h3 class="title" :title="record?.name ?? item.name ?? item.id">{{ record?.name ?? item.name ?? item.id }}</h3>
      </div>
      <button
        type="button"
        class="close"
        title="Close (Esc)"
        aria-label="Close record"
        data-testid="record-drawer-close"
        @click="emit('close')"
      >✕</button>
    </header>

    <div class="preview" :data-type="assetType ?? null">
      <div v-if="assetType === 'font'" class="preview-font" :style="fontStyle">
        <span class="font-big">Aa</span>
        <span class="font-line">The quick brown fox jumps</span>
      </div>
      <audio
        v-else-if="assetType === 'audio' && fileUrl"
        :src="fileUrl"
        controls
        preload="none"
        data-testid="record-drawer-audio"
      />
      <video
        v-else-if="assetType === 'video' && fileUrl"
        :src="fileUrl"
        :poster="thumbUrl ?? undefined"
        controls
        muted
        preload="none"
      />
      <img
        v-else-if="thumbUrl && !thumbFailed"
        :src="thumbUrl"
        :alt="`Preview of ${item.id}`"
        @error="thumbFailed = true"
      />
      <span v-else class="dim">no preview</span>
    </div>

    <p v-if="loadError" class="load-error" role="alert">{{ loadError }}</p>
    <p v-else-if="loading && !record" class="loading">Reading the record…</p>

    <form v-if="record" class="fields" @submit.prevent>
      <label class="field">
        <span class="label">Name</span>
        <input
          v-model="draft.name"
          type="text"
          spellcheck="false"
          data-testid="record-drawer-name"
          @change="commitText('name')"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        />
      </label>

      <label class="field">
        <span class="label">Description</span>
        <textarea
          v-model="draft.desc"
          rows="2"
          placeholder="One searchable line: what it shows"
          data-testid="record-drawer-desc"
          @change="commitText('desc')"
          @keydown.enter.exact.prevent="($event.target as HTMLTextAreaElement).blur()"
        />
      </label>

      <div class="field">
        <span class="label">Tags</span>
        <div class="tags" data-testid="record-drawer-tags">
          <span v-for="tag in tags" :key="tag" class="tag" :data-tag="tag">
            {{ tag }}
            <button
              type="button"
              class="tag-x"
              :aria-label="`Remove tag ${tag}`"
              :disabled="saving"
              data-testid="record-drawer-tag-remove"
              @click="removeTag(tag)"
            >×</button>
          </span>
          <input
            v-model="tagInput"
            class="tag-input"
            type="text"
            spellcheck="false"
            :placeholder="tags.length ? 'add…' : 'add a tag…'"
            :disabled="saving"
            data-testid="record-drawer-tag-input"
            @keydown="onTagKeydown"
            @blur="addTags"
          />
        </div>
      </div>

      <div class="row">
        <label class="field licence">
          <span class="label">Licence</span>
          <select
            :value="record.licence ?? 'unknown'"
            :disabled="saving"
            data-testid="record-drawer-licence"
            :data-unknown="record.licence === 'unknown' ? 'true' : null"
            @change="onLicence"
          >
            <option v-for="l in RECORD_LICENCES" :key="l" :value="l">{{ l }}</option>
          </select>
        </label>
        <label class="field grow">
          <span class="label">Credit</span>
          <input
            v-model="draft.credit"
            type="text"
            placeholder="Who to credit"
            data-testid="record-drawer-credit"
            @change="commitText('credit')"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
        </label>
      </div>

      <label class="field">
        <span class="label">
          Source
          <a v-if="sourceIsLink" :href="record.source" target="_blank" rel="noopener" class="open-link">open ↗</a>
        </span>
        <input
          v-model="draft.source"
          type="text"
          spellcheck="false"
          placeholder="Where it came from (a URL)"
          data-testid="record-drawer-source"
          @change="commitText('source')"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        />
      </label>
    </form>

    <section v-if="record" class="section">
      <h4>Record</h4>
      <dl class="facts">
        <template v-for="f in facts" :key="f.label">
          <dt>{{ f.label }}</dt>
          <dd :title="f.value">{{ f.value }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="detail && detail.made.from.length > 0" class="section" data-testid="record-drawer-made-from">
      <h4>Made from</h4>
      <ul class="links">
        <li v-for="f in detail.made.from" :key="f.id">
          <span v-if="'missing' in f" class="missing" title="No shelf holds this record">{{ f.id }} · missing</span>
          <button v-else type="button" class="link" @click="emit('open', f.id)">
            {{ f.id }} <span class="dim">{{ f.kind }} · {{ SHELF_LABELS[f.shelf] ?? f.shelf }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section v-if="detail && detail.made.into.length > 0" class="section" data-testid="record-drawer-made-into">
      <h4>Made from it</h4>
      <ul class="links">
        <li v-for="m in detail.made.into" :key="`${m.shelf}:${m.id}`">
          <button type="button" class="link" @click="emit('open', m.id)">
            {{ m.id }} <span class="dim">{{ m.kind }}{{ m.tool ? ` · ${m.tool}` : '' }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section v-if="record" class="section" data-testid="record-drawer-uses">
      <h4>Used here</h4>
      <p v-if="uses.length === 0" class="dim">Not registered in this composition.</p>
      <ul v-else class="uses">
        <li v-for="u in uses" :key="u.assetId" :data-asset-id="u.assetId">
          <div class="use-head">
            <code>{{ u.assetId }}</code>
            <span v-if="!u.current" class="stale" title="The pin names other bytes than the record's: the render fails with E_ASSET_STALE">stale pin</span>
            <span v-else-if="u.pin" class="dim">@{{ u.pin }}</span>
          </div>
          <p class="dim">
            <template v-if="u.items.length + u.audio.length === 0">registered, not used by any item</template>
            <template v-else>
              {{ [...u.items, ...u.audio.map((a) => `audio ${a}`)].join(', ') }}
            </template>
          </p>
          <p v-if="copiedDiffers(u)" class="copied" data-testid="record-drawer-copied">
            registered with {{ [u.credit, u.licence].filter(Boolean).join(' · ') || 'no credit' }};
            re-register to take the record's
          </p>
        </li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.record-drawer {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 10px 12px 16px;
  background: #121317;
  border-left: 1px solid rgba(91, 124, 250, 0.35);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.45);
  color: #e5e5e5;
  font-size: 12px;
  outline: none;
  animation: slide-in 140ms ease-out;
}

.record-drawer[data-saving='true'] {
  cursor: progress;
}

@keyframes slide-in {
  from {
    transform: translateX(16px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

.head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.head-text {
  flex: 1 1 auto;
  min-width: 0;
}

.eyebrow {
  display: block;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8a8fa3;
}

.title {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.close {
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  color: #a3a3a3;
  width: 24px;
  height: 24px;
  cursor: pointer;
}

.close:hover {
  color: #e5e5e5;
  border-color: rgba(255, 255, 255, 0.2);
}

.preview {
  border-radius: 6px;
  overflow: hidden;
  background:
    repeating-conic-gradient(rgba(255, 255, 255, 0.04) 0% 25%, transparent 0% 50%) 50% / 16px 16px,
    #0b0c0f;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 72px;
  max-height: 200px;
}

.preview img,
.preview video {
  display: block;
  max-width: 100%;
  max-height: 200px;
  object-fit: contain;
}

.preview audio {
  width: 100%;
  margin: 12px;
}

.preview-font {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 8px;
}

.font-big {
  font-size: 40px;
  line-height: 1;
}

.font-line {
  font-size: 14px;
  color: #c9c9c9;
}

.loading,
.load-error {
  margin: 0;
}

.load-error {
  color: #f87171;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.row {
  display: flex;
  gap: 8px;
}

.grow {
  flex: 1 1 auto;
}

.licence {
  flex: 0 0 92px;
}

.label {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8a8fa3;
  display: flex;
  justify-content: space-between;
}

.open-link {
  text-transform: none;
  letter-spacing: 0;
  color: rgba(129, 155, 255, 1);
  text-decoration: none;
}

.field input,
.field textarea,
.field select,
.tags {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  color: #e5e5e5;
  font: inherit;
  padding: 5px 8px;
  outline: none;
  min-width: 0;
}

.field textarea {
  resize: vertical;
  line-height: 1.4;
}

.field input:focus,
.field textarea:focus,
.field select:focus,
.tags:focus-within {
  border-color: rgba(91, 124, 250, 0.7);
}

.field select[data-unknown='true'] {
  color: #fbbf24;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  padding: 4px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: rgba(91, 124, 250, 0.16);
  border: 1px solid rgba(91, 124, 250, 0.35);
  border-radius: 10px;
  padding: 1px 3px 1px 8px;
  font-size: 11px;
}

.tag-x {
  background: transparent;
  border: 0;
  color: #a3a3a3;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 3px;
  border-radius: 8px;
}

.tag-x:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.tag-input {
  flex: 1 1 60px;
  background: transparent !important;
  border: 0 !important;
  padding: 2px 4px !important;
}

.section h4 {
  margin: 0 0 6px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8a8fa3;
  font-weight: 600;
}

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  margin: 0;
}

.facts dt {
  color: #8a8fa3;
}

.facts dd {
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.links,
.uses {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.link {
  background: transparent;
  border: 0;
  padding: 0;
  color: rgba(129, 155, 255, 1);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.link:hover {
  text-decoration: underline;
}

.dim {
  color: #8a8fa3;
  margin: 0;
}

.missing {
  color: #f87171;
}

.uses li {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  padding: 5px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.use-head {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.use-head code {
  font-size: 11px;
}

.stale {
  color: #fbbf24;
  font-size: 11px;
}

.copied {
  margin: 0;
  color: #fbbf24;
  font-size: 11px;
}
</style>
