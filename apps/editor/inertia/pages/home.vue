<script setup lang="ts">
// Project picker — replaces the AdonisJS starter splash.
//
// Two CTAs, both server-validated:
//  - "Open existing": POST /api/project with `{ directory }`. Server runs the
//    same path-traversal guard the rest of the editor uses; on success we
//    navigate to /editor.
//  - "Create new": POST /api/projects with `{ directory, name, template }`.
//    Scaffolds + loads in one trip.
//
// Below: recent projects list. Click = re-open (POST /api/project); the small
// X button = forget (DELETE /api/projects/recent/:idx) — does NOT delete the
// directory from disk.

import { Head, router } from '@inertiajs/vue3'
import { computed, ref } from 'vue'

interface RecentProject {
  path: string
  name: string
  lastOpenedAt: number
  lastModifiedAt: number
}

const props = defineProps<{
  projects: RecentProject[]
  templates: string[]
}>()

const recents = ref<RecentProject[]>([...props.projects])
const templates = computed(() => props.templates)

const openPath = ref('')
const openError = ref<string | null>(null)
const openBusy = ref(false)

const createName = ref('')
const createParent = ref('')
const createTemplate = ref<string>(props.templates[0] ?? 'basic')
const createError = ref<string | null>(null)
const createBusy = ref(false)

function joinPath(parent: string, name: string): string {
  if (!parent) return name
  const trimmed = parent.replace(/[\/\\]+$/, '')
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return `${trimmed}${sep}${name}`
}

function formatRelative(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: { code?: string; message?: string } }> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-inertia': 'false' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { ok: false, status: 0, error: { message: (err as Error).message } }
  }
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  if (!res.ok) {
    const err = (parsed as { error?: { code?: string; message?: string } })?.error
    return { ok: false, status: res.status, error: err ?? { message: text || res.statusText } }
  }
  return { ok: true, data: parsed as T }
}

async function submitOpen() {
  openError.value = null
  const dir = openPath.value.trim()
  if (!dir) {
    openError.value = 'Filesystem path is required'
    return
  }
  openBusy.value = true
  const res = await postJson<{ root: string }>('/api/project', { directory: dir })
  openBusy.value = false
  if (!res.ok) {
    openError.value = res.error?.message ?? `Failed (HTTP ${res.status})`
    return
  }
  router.visit('/editor')
}

async function submitCreate() {
  createError.value = null
  const name = createName.value.trim()
  const parent = createParent.value.trim()
  if (!name) {
    createError.value = 'Project name is required'
    return
  }
  if (!parent) {
    createError.value = 'Parent directory is required'
    return
  }
  const directory = joinPath(parent, name)
  createBusy.value = true
  const res = await postJson<{ root: string }>('/api/projects', {
    directory,
    name,
    template: createTemplate.value || undefined,
  })
  createBusy.value = false
  if (!res.ok) {
    createError.value = res.error?.message ?? `Failed (HTTP ${res.status})`
    return
  }
  router.visit('/editor')
}

async function openRecent(project: RecentProject) {
  openError.value = null
  openBusy.value = true
  const res = await postJson<{ root: string }>('/api/project', { directory: project.path })
  openBusy.value = false
  if (!res.ok) {
    openError.value = `Could not open ${project.name}: ${res.error?.message ?? `HTTP ${res.status}`}`
    return
  }
  router.visit('/editor')
}

async function forgetRecent(idx: number, ev: MouseEvent) {
  ev.stopPropagation()
  let res: Response
  try {
    res = await fetch(`/api/projects/recent/${idx}`, {
      method: 'DELETE',
      headers: { 'x-inertia': 'false' },
    })
  } catch (err) {
    openError.value = (err as Error).message
    return
  }
  if (!res.ok) {
    openError.value = `Forget failed: HTTP ${res.status}`
    return
  }
  const body = (await res.json().catch(() => null)) as { projects?: RecentProject[] } | null
  if (body?.projects) recents.value = body.projects
}
</script>

<template>
  <Head title="davidup — open a project" />

  <div class="picker">
    <div class="picker-inner">
      <header class="picker-hero">
        <div class="picker-brand">davidup</div>
        <h1 class="picker-title">Open a project</h1>
        <p class="picker-sub">
          Point the editor at an existing project directory, or scaffold a new one. The server
          validates filesystem paths before loading.
        </p>
      </header>

      <div class="picker-grid">
        <!-- Open existing -->
        <section class="cta">
          <div class="cta-head">
            <div class="cta-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
              </svg>
            </div>
            <div>
              <h2 class="cta-title">Open existing</h2>
              <p class="cta-sub">Load a project from a folder on this machine.</p>
            </div>
          </div>
          <form class="cta-body" @submit.prevent="submitOpen">
            <label class="field">
              <span class="field-label">Project directory</span>
              <input
                v-model="openPath"
                class="field-input"
                type="text"
                placeholder="/Users/you/projects/my-video"
                autocomplete="off"
                spellcheck="false"
                :disabled="openBusy"
                @keydown.enter.prevent="submitOpen"
              />
            </label>
            <p v-if="openError" class="field-error" role="alert">{{ openError }}</p>
            <div class="cta-foot">
              <button type="submit" class="btn btn-primary" :disabled="openBusy">
                {{ openBusy ? 'Opening…' : 'Open project' }}
              </button>
            </div>
          </form>
        </section>

        <!-- Create new -->
        <section class="cta">
          <div class="cta-head">
            <div class="cta-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <div>
              <h2 class="cta-title">Create new</h2>
              <p class="cta-sub">Scaffold a fresh project from a template.</p>
            </div>
          </div>
          <form class="cta-body" @submit.prevent="submitCreate">
            <label class="field">
              <span class="field-label">Project name</span>
              <input
                v-model="createName"
                class="field-input"
                type="text"
                placeholder="my-video"
                autocomplete="off"
                spellcheck="false"
                :disabled="createBusy"
              />
            </label>
            <label class="field">
              <span class="field-label">Parent directory</span>
              <input
                v-model="createParent"
                class="field-input"
                type="text"
                placeholder="/Users/you/projects"
                autocomplete="off"
                spellcheck="false"
                :disabled="createBusy"
              />
            </label>
            <label class="field">
              <span class="field-label">Template</span>
              <select v-model="createTemplate" class="field-input" :disabled="createBusy">
                <option v-for="t in templates" :key="t" :value="t">{{ t }}</option>
              </select>
            </label>
            <p v-if="createError" class="field-error" role="alert">{{ createError }}</p>
            <div class="cta-foot">
              <button type="submit" class="btn btn-primary" :disabled="createBusy">
                {{ createBusy ? 'Creating…' : 'Create & open' }}
              </button>
            </div>
          </form>
        </section>
      </div>

      <!-- Recent projects -->
      <section class="recents" data-testid="recents">
        <header class="recents-head">
          <h3 class="recents-title">Recent projects</h3>
          <span class="recents-count">{{ recents.length }}</span>
        </header>

        <ul v-if="recents.length > 0" class="recents-list">
          <li
            v-for="(p, idx) in recents"
            :key="p.path"
            class="recent-row"
            role="button"
            tabindex="0"
            :data-testid="`recent-${idx}`"
            @click="openRecent(p)"
            @keydown.enter.prevent="openRecent(p)"
            @keydown.space.prevent="openRecent(p)"
          >
            <div class="recent-main">
              <div class="recent-name">{{ p.name }}</div>
              <div class="recent-path">{{ p.path }}</div>
            </div>
            <div class="recent-meta">
              <span>{{ formatRelative(p.lastOpenedAt) }}</span>
            </div>
            <button
              type="button"
              class="recent-forget"
              title="Forget this project (does not delete from disk)"
              :aria-label="`Forget ${p.name}`"
              :data-testid="`forget-${idx}`"
              @click="(e) => forgetRecent(idx, e)"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </li>
        </ul>

        <p v-else class="recents-empty">
          No recent projects yet. Open or create one above.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.picker {
  min-height: 100vh;
  width: 100%;
  background: radial-gradient(1200px 600px at 50% -200px, rgba(91, 124, 250, 0.18), transparent 60%),
    #0a0a0a;
  color: #e5e5e5;
  font-family: 'Instrument Sans', system-ui, -apple-system, sans-serif;
  padding: 48px 20px 80px;
  box-sizing: border-box;
}

.picker-inner {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 36px;
}

.picker-hero {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.picker-brand {
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #5b7cfa;
  font-weight: 600;
}

.picker-title {
  font-size: 36px;
  line-height: 1.1;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.02em;
}

.picker-sub {
  font-size: 15px;
  color: #a3a3a3;
  max-width: 560px;
  margin: 0;
  line-height: 1.5;
}

.picker-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 720px) {
  .picker-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.cta {
  background: #111;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: border-color 160ms ease, transform 160ms ease;
}

.cta:hover {
  border-color: rgba(91, 124, 250, 0.4);
}

.cta-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.cta-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(91, 124, 250, 0.14);
  color: #97aaff;
  display: grid;
  place-items: center;
  flex: 0 0 36px;
}

.cta-icon svg {
  width: 20px;
  height: 20px;
}

.cta-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0;
}

.cta-sub {
  font-size: 13px;
  color: #909090;
  margin: 2px 0 0;
}

.cta-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cta-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: #a3a3a3;
  letter-spacing: 0.02em;
}

.field-input {
  width: 100%;
  box-sizing: border-box;
  background: #0a0a0a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e5e5e5;
  font: inherit;
  font-size: 13px;
  padding: 9px 11px;
  border-radius: 6px;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

.field-input:focus {
  border-color: rgba(91, 124, 250, 0.7);
  box-shadow: 0 0 0 3px rgba(91, 124, 250, 0.18);
}

.field-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

select.field-input {
  font-family: 'Instrument Sans', system-ui, sans-serif;
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, #909090 50%),
    linear-gradient(135deg, #909090 50%, transparent 50%);
  background-position: calc(100% - 16px) 50%, calc(100% - 11px) 50%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 28px;
}

.field-error {
  color: #ff6b6b;
  font-size: 12px;
  margin: 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 6px;
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

.recents {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #0d0d0d;
  border-radius: 12px;
  padding: 16px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recents-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 4px;
}

.recents-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a3a3a3;
  margin: 0;
  font-weight: 600;
}

.recents-count {
  font-size: 11px;
  color: #707070;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 7px;
  border-radius: 999px;
}

.recents-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.recent-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 120ms ease;
}

.recent-row:hover,
.recent-row:focus-visible {
  background: rgba(91, 124, 250, 0.08);
  outline: none;
}

.recent-main {
  min-width: 0;
}

.recent-name {
  font-size: 14px;
  font-weight: 500;
  color: #e5e5e5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-path {
  font-size: 11px;
  color: #707070;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

.recent-meta {
  font-size: 11px;
  color: #909090;
  white-space: nowrap;
}

.recent-forget {
  background: transparent;
  border: 1px solid transparent;
  color: #707070;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.recent-forget:hover {
  background: rgba(255, 107, 107, 0.12);
  color: #ff6b6b;
  border-color: rgba(255, 107, 107, 0.3);
}

.recents-empty {
  color: #707070;
  font-size: 13px;
  text-align: center;
  padding: 16px 12px 12px;
  margin: 0;
}
</style>
