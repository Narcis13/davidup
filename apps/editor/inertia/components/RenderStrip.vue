<script setup lang="ts">
// RenderStrip — step 19 of the editor build plan.
//
// Mounts at the top of the editor shell (next to the stage controls). Shows
// a "Render ▸" button when idle; a progress bar + frame counter + ETA while
// running; and a clickable link to the finished MP4 when done.
//
// Progress data flows through `useRender`, a module-singleton composable that
// owns the SSE subscription. The strip is a pure consumer — clicking Render
// kicks off a job, the bar reflects whatever the server emits.

import { computed } from 'vue'
import { useRender } from '~/composables/useRender'

const render = useRender()

const percent = computed<number>(() => {
  const cur = render.current.value
  if (!cur || cur.totalFrames === 0) return 0
  const frac = cur.frame / cur.totalFrames
  if (!Number.isFinite(frac)) return 0
  return Math.round(Math.max(0, Math.min(1, frac)) * 100)
})

const fpsEstimate = computed<number | null>(() => {
  const cur = render.current.value
  if (!cur || cur.frame === 0 || cur.elapsedMs === 0) return null
  return (cur.frame / cur.elapsedMs) * 1000
})

const etaSeconds = computed<number | null>(() => {
  const cur = render.current.value
  if (!cur) return null
  const fps = fpsEstimate.value
  if (!fps || fps <= 0) return null
  const remaining = cur.totalFrames - cur.frame
  if (remaining <= 0) return 0
  return remaining / fps
})

const buttonLabel = computed<string>(() => {
  const cur = render.current.value
  if (!cur) return 'Render ▸'
  if (cur.status === 'pending') return 'Starting…'
  if (cur.status === 'running') return `Rendering · ${percent.value}%`
  if (cur.status === 'done') return 'Render ▸'
  if (cur.status === 'error') return 'Render ▸'
  return 'Render ▸'
})

const isBusy = render.isBusy

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 1) return '<1s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m${String(s).padStart(2, '0')}s`
}

function fileBasename(path: string | null): string {
  if (!path) return ''
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

async function onClickRender(): Promise<void> {
  await render.startRender()
}

function onDismiss(): void {
  render.dismissCurrent()
}
</script>

<template>
  <div class="render-strip" data-testid="render-strip">
    <button
      type="button"
      class="render-btn"
      :disabled="isBusy"
      :data-status="render.current.value?.status ?? 'idle'"
      data-testid="render-button"
      @click="onClickRender"
    >
      {{ buttonLabel }}
    </button>

    <div
      v-if="render.current.value && render.current.value.status !== 'done' && render.current.value.status !== 'error'"
      class="progress-track"
      data-testid="render-progress"
      :aria-label="`${percent}% rendered`"
    >
      <div class="progress-fill" :style="{ width: `${percent}%` }" />
      <span class="progress-stats">
        <span class="frames" data-testid="render-frames">
          {{ render.current.value.frame }} / {{ render.current.value.totalFrames }}
        </span>
        <span class="dot">·</span>
        <span class="eta" data-testid="render-eta">ETA {{ formatDuration(etaSeconds) }}</span>
        <span v-if="fpsEstimate" class="fps" data-testid="render-fps">
          · {{ fpsEstimate.toFixed(1) }} fps
        </span>
      </span>
    </div>

    <div
      v-else-if="render.current.value && render.current.value.status === 'done'"
      class="render-done"
      data-testid="render-done"
    >
      <span class="check" aria-hidden="true">✓</span>
      <a
        :href="`/project-renders/${fileBasename(render.current.value.relativeOutputPath)}`"
        target="_blank"
        rel="noopener"
        class="render-link"
        data-testid="render-output-link"
      >
        {{ render.current.value.relativeOutputPath }}
      </a>
      <span class="duration" data-testid="render-server-duration">
        ({{ formatDuration(render.current.value.serverDurationMs ? render.current.value.serverDurationMs / 1000 : null) }})
      </span>
      <button
        type="button"
        class="dismiss"
        aria-label="Dismiss"
        data-testid="render-dismiss"
        @click="onDismiss"
      >
        ×
      </button>
    </div>

    <div
      v-else-if="render.current.value && render.current.value.status === 'error'"
      class="render-error"
      data-testid="render-error"
    >
      <span class="cross" aria-hidden="true">✗</span>
      <span class="error-msg" :title="render.current.value.error ?? ''">
        {{ render.current.value.error ?? 'Render failed' }}
      </span>
      <button
        type="button"
        class="dismiss"
        aria-label="Dismiss"
        data-testid="render-dismiss"
        @click="onDismiss"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.render-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  font-size: 12px;
  color: #e5e5e5;
  flex: 1 1 auto;
  min-width: 0;
}

.render-btn {
  appearance: none;
  border: 1px solid rgba(255, 132, 71, 0.55);
  background: linear-gradient(180deg, rgba(255, 132, 71, 0.18), rgba(255, 132, 71, 0.08));
  color: #ffd5bb;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 120ms ease, border-color 120ms ease;
  font-family: inherit;
}

.render-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(255, 132, 71, 0.28), rgba(255, 132, 71, 0.16));
  border-color: rgba(255, 132, 71, 0.75);
}

.render-btn:disabled {
  cursor: progress;
  opacity: 0.78;
}

.render-btn[data-status='error'] {
  border-color: rgba(255, 107, 107, 0.65);
  background: linear-gradient(180deg, rgba(255, 107, 107, 0.18), rgba(255, 107, 107, 0.08));
  color: #ffd0d0;
}

.progress-track {
  position: relative;
  flex: 1 1 auto;
  min-width: 120px;
  max-width: 360px;
  height: 18px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, rgba(91, 220, 130, 0.5), rgba(91, 220, 130, 0.85));
  transition: width 100ms linear;
}

.progress-stats {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
  height: 100%;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #f0f0f0;
  font-feature-settings: 'tnum';
  mix-blend-mode: difference;
}

.dot {
  opacity: 0.6;
}

.render-done {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(91, 220, 130, 0.12);
  border: 1px solid rgba(91, 220, 130, 0.4);
  padding: 4px 8px;
  border-radius: 6px;
  color: #c8f3d2;
}

.render-done .check {
  color: #8bd6a5;
  font-weight: 700;
}

.render-link {
  color: #c8f3d2;
  text-decoration: underline;
  text-decoration-color: rgba(91, 220, 130, 0.5);
  text-underline-offset: 2px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.render-link:hover {
  color: #e7fbe9;
  text-decoration-color: rgba(91, 220, 130, 0.9);
}

.duration {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #a3a3a3;
  font-size: 11px;
}

.render-error {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.4);
  padding: 4px 8px;
  border-radius: 6px;
  color: #ffd0d0;
  max-width: 400px;
}

.render-error .cross {
  color: #ff6b6b;
  font-weight: 700;
}

.error-msg {
  flex: 1 1 auto;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dismiss {
  background: transparent;
  border: none;
  color: inherit;
  opacity: 0.75;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}

.dismiss:hover {
  opacity: 1;
}
</style>
