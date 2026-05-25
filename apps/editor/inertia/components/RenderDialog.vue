<script setup lang="ts">
// RenderDialog — UX_GAPS §N.
//
// Modal that gathers the per-render knobs before POST /api/renders:
//   • output filename (basename only; renders/ is prepended server-side)
//   • quality preset (Draft / Web / Final → mapped to ffmpeg crf+preset)
//
// Width / height / fps live on the composition (the user already has the
// composition settings dialog for those), so we render them as read-only
// hints — the dialog should never silently mutate the composition just
// because the user clicked Render.
//
// Last preset + filename persist via /api/editor-state so reopening the
// editor remembers the user's previous choice (UX_GAPS §N tail).

import { computed, ref, watch, onMounted } from 'vue'
import type { Composition } from '~/composables/useCommandBus'
import {
  useEditorPrefs,
  presetToRenderOptions,
  type RenderPreset,
} from '~/composables/useEditorPrefs'

const props = defineProps<{
  open: boolean
  composition: Composition | null
  busy?: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'confirm', payload: { filename?: string; renderOptions: ReturnType<typeof presetToRenderOptions> }): void
}>()

const prefs = useEditorPrefs()

const preset = ref<RenderPreset>(prefs.renderPrefs.value.preset)
const filename = ref<string>(prefs.renderPrefs.value.filename)

onMounted(() => {
  void prefs.hydrate().then(() => {
    preset.value = prefs.renderPrefs.value.preset
    filename.value = prefs.renderPrefs.value.filename
  })
})

watch(
  () => props.open,
  (next) => {
    if (!next) return
    // Re-seed the form from saved prefs every time the dialog opens.
    preset.value = prefs.renderPrefs.value.preset
    filename.value = prefs.renderPrefs.value.filename
  },
)

const meta = computed(() => {
  const m = props.composition?.composition
  if (!m) return null
  return {
    width: m.width,
    height: m.height,
    fps: m.fps,
    duration: m.duration,
  }
})

const totalFrames = computed<number | null>(() => {
  const m = meta.value
  if (!m) return null
  return Math.max(1, Math.ceil(m.duration * m.fps))
})

const presetCopy: Record<RenderPreset, { label: string; description: string }> = {
  draft: {
    label: 'Draft',
    description: 'Fast preview · ultrafast preset · crf 30',
  },
  web: {
    label: 'Web',
    description: 'Balanced default · medium preset · crf 23',
  },
  final: {
    label: 'Final',
    description: 'Highest quality · slow preset · crf 18',
  },
}

// Reject names with separators or .. so the server's containment check stays
// the single source of truth — but we surface the warning client-side too.
const filenameError = computed<string | null>(() => {
  const v = filename.value.trim()
  if (!v) return null
  if (v.includes('/') || v.includes('\\')) return 'Filename must be a single basename — no directories.'
  if (v.includes('..')) return 'Filename must not contain "..".'
  return null
})

function close(): void {
  emit('close')
}

function onBackdropClick(event: MouseEvent): void {
  if (!(event.target instanceof HTMLElement)) return
  if (event.target.dataset.renderBackdrop === 'true') close()
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeydown)
  }
})

async function onConfirm(): Promise<void> {
  if (filenameError.value) return
  const trimmed = filename.value.trim()
  await prefs.setRenderPrefs({ preset: preset.value, filename: trimmed })
  emit('confirm', {
    ...(trimmed ? { filename: trimmed } : {}),
    renderOptions: presetToRenderOptions(preset.value),
  })
}
</script>

<template>
  <div
    v-if="open"
    class="render-backdrop"
    data-render-backdrop="true"
    data-testid="render-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Render settings"
    @mousedown="onBackdropClick"
  >
    <div class="render-dialog">
      <header class="dialog-header">
        <div>
          <span class="dialog-eyebrow">davidup render</span>
          <h2>Export composition to MP4</h2>
        </div>
        <button
          type="button"
          class="close-btn"
          aria-label="Close render dialog"
          data-testid="render-dialog-close"
          @click="close"
        >×</button>
      </header>

      <section class="info-grid" v-if="meta">
        <div class="info-cell">
          <span class="info-label">Dimensions</span>
          <span class="info-value">{{ meta.width }} × {{ meta.height }}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">FPS</span>
          <span class="info-value">{{ meta.fps }}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Duration</span>
          <span class="info-value">{{ meta.duration.toFixed(2) }}s</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Frames</span>
          <span class="info-value">{{ totalFrames }}</span>
        </div>
      </section>

      <p class="info-hint">
        Change these via the composition settings (⚙) before rendering — the dialog itself
        is render-only and won't mutate the project.
      </p>

      <fieldset class="preset-fieldset">
        <legend>Quality preset</legend>
        <label
          v-for="(copy, key) in presetCopy"
          :key="key"
          class="preset-option"
          :class="{ active: preset === key }"
          :data-testid="`render-dialog-preset-${key}`"
        >
          <input
            type="radio"
            :value="key"
            v-model="preset"
            name="render-preset"
          />
          <span class="preset-label">{{ copy.label }}</span>
          <span class="preset-description">{{ copy.description }}</span>
        </label>
      </fieldset>

      <label class="filename-row">
        <span class="filename-label">Filename</span>
        <input
          v-model="filename"
          type="text"
          spellcheck="false"
          placeholder="auto-stamped if blank"
          class="filename-input"
          data-testid="render-dialog-filename"
        />
      </label>
      <p
        v-if="filenameError"
        class="filename-error"
        data-testid="render-dialog-filename-error"
      >{{ filenameError }}</p>
      <p v-else class="filename-hint">
        Saved under <code>renders/</code>. Leave blank for a UTC-stamped basename.
      </p>

      <footer class="dialog-footer">
        <button
          type="button"
          class="footer-btn ghost"
          data-testid="render-dialog-cancel"
          @click="close"
        >Cancel</button>
        <button
          type="button"
          class="footer-btn primary"
          data-testid="render-dialog-confirm"
          :disabled="busy || filenameError !== null"
          @click="onConfirm"
        >{{ busy ? 'Rendering…' : 'Start render' }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.render-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 14, 0.74);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 240;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  color: #e5e5e5;
}

.render-dialog {
  width: min(520px, calc(100vw - 48px));
  background: #0f1014;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 22px 12px;
  gap: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: linear-gradient(180deg, rgba(255, 132, 71, 0.06), transparent);
}

.dialog-eyebrow {
  display: block;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #ff9a6d;
  font-weight: 600;
}

.dialog-header h2 {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #f5f5f7;
}

.close-btn {
  appearance: none;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #d4d4d4;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.18);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 14px 22px 4px;
}

.info-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 6px 8px;
}

.info-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #909090;
}

.info-value {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #f0f0f0;
  font-feature-settings: 'tnum';
}

.info-hint {
  margin: 8px 22px 0;
  font-size: 11.5px;
  color: #909090;
}

.preset-fieldset {
  margin: 14px 22px 4px;
  padding: 0;
  border: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preset-fieldset legend {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #a3a3a3;
  margin-bottom: 4px;
  padding: 0;
}

.preset-option {
  display: grid;
  grid-template-columns: 16px 80px 1fr;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.preset-option:hover {
  background: rgba(91, 124, 250, 0.06);
  border-color: rgba(91, 124, 250, 0.2);
}

.preset-option.active {
  background: rgba(91, 124, 250, 0.12);
  border-color: rgba(91, 124, 250, 0.5);
}

.preset-option input[type='radio'] {
  margin: 0;
  cursor: pointer;
}

.preset-label {
  font-weight: 600;
  color: #f0f0f0;
}

.preset-description {
  color: #a3a3a3;
  font-size: 11.5px;
}

.filename-row {
  display: grid;
  grid-template-columns: 90px 1fr;
  align-items: center;
  gap: 10px;
  margin: 12px 22px 0;
}

.filename-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a3a3a3;
}

.filename-input {
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  padding: 6px 8px;
  border-radius: 4px;
}

.filename-input:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.filename-hint,
.filename-error {
  margin: 6px 22px 0;
  font-size: 11px;
  color: #909090;
}

.filename-hint code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 5px;
  border-radius: 3px;
}

.filename-error {
  color: #ff8a8a;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 22px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin-top: 16px;
  background: rgba(255, 255, 255, 0.02);
}

.footer-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: #d4d4d4;
  padding: 6px 14px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.footer-btn.primary {
  background: linear-gradient(180deg, rgba(255, 132, 71, 0.22), rgba(255, 132, 71, 0.1));
  border-color: rgba(255, 132, 71, 0.55);
  color: #ffd5bb;
}

.footer-btn.primary:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(255, 132, 71, 0.32), rgba(255, 132, 71, 0.18));
}

.footer-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
