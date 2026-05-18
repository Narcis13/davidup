<script setup lang="ts">
// Toasts — step 20.17 of the editor polish plan.
//
// Replaces the upload-only `UploadToasts.vue`. Renders a single unified
// stack with two sources:
//
//   1. `useToasts()` — ad-hoc notifications pushed by other composables
//      (command failures, render lifecycle, project switch, library
//      refresh errors).
//   2. `useAssetUpload()` — upload jobs, which keep their own per-job
//      progress / abort state and need a richer card than a flat toast.
//
// Both sources reduce to the same visual list, sorted newest-first
// (column-reverse keeps the latest at the bottom near the user's eye).

import { computed } from 'vue'
import { useToasts, type Toast } from '~/composables/useToasts'
import { useAssetUpload, type UploadJob } from '~/composables/useAssetUpload'

const toasts = useToasts()
const uploads = useAssetUpload()

interface UploadEntry {
  kind: 'upload'
  id: string
  job: UploadJob
}

interface ToastEntry {
  kind: 'toast'
  id: string
  toast: Toast
}

type Entry = UploadEntry | ToastEntry

const entries = computed<Entry[]>(() => {
  const merged: Entry[] = []
  for (const job of uploads.jobs.value) {
    merged.push({ kind: 'upload', id: `u:${job.id}`, job })
  }
  for (const t of toasts.toasts.value) {
    merged.push({ kind: 'toast', id: `t:${t.id}`, toast: t })
  }
  return merged
})

function percent(job: UploadJob): number {
  return Math.round(Math.max(0, Math.min(1, job.progress)) * 100)
}

function uploadStatusToLevel(status: UploadJob['status']): Toast['level'] {
  if (status === 'success') return 'success'
  if (status === 'error') return 'error'
  return 'info'
}

function uploadAsset(job: UploadJob) {
  return job.asset ?? null
}

function dismissUpload(id: string): void {
  uploads.dismissJob(id)
}

function dismissToast(id: string): void {
  toasts.dismiss(id)
}
</script>

<template>
  <div
    v-if="entries.length > 0"
    class="toasts"
    role="region"
    aria-label="Notifications"
    data-testid="toasts"
  >
    <template v-for="entry in entries" :key="entry.id">
      <!-- ── Upload job ─────────────────────────────────────────────── -->
      <article
        v-if="entry.kind === 'upload'"
        class="toast"
        :data-level="uploadStatusToLevel(entry.job.status)"
        :data-status="entry.job.status"
        :data-testid="`upload-toast-${entry.job.id}`"
      >
        <div class="row">
          <span class="dot" :data-level="uploadStatusToLevel(entry.job.status)" />
          <span class="title" :title="entry.job.fileName">{{ entry.job.fileName }}</span>
          <button
            type="button"
            class="close"
            aria-label="Dismiss"
            @click="dismissUpload(entry.job.id)"
          >×</button>
        </div>

        <div v-if="entry.job.status === 'uploading'" class="progress">
          <div class="bar" :style="{ width: `${percent(entry.job)}%` }" />
          <span class="pct">{{ percent(entry.job) }}%</span>
        </div>

        <p
          v-else-if="entry.job.status === 'success' && uploadAsset(entry.job)"
          class="detail success-detail"
        >
          Added to library · {{ uploadAsset(entry.job)!.kind }}
          <template v-if="uploadAsset(entry.job)!.width && uploadAsset(entry.job)!.height">
            · {{ uploadAsset(entry.job)!.width }}×{{ uploadAsset(entry.job)!.height }}
          </template>
        </p>

        <p v-else-if="entry.job.status === 'error'" class="detail error-detail">
          {{ entry.job.error?.message ?? 'Upload failed' }}
        </p>
      </article>

      <!-- ── Generic toast ──────────────────────────────────────────── -->
      <article
        v-else
        class="toast"
        :data-level="entry.toast.level"
        :data-testid="`toast-${entry.toast.id}`"
      >
        <div class="row">
          <span class="dot" :data-level="entry.toast.level" />
          <span class="title" :title="entry.toast.title">{{ entry.toast.title }}</span>
          <button
            type="button"
            class="close"
            aria-label="Dismiss"
            @click="dismissToast(entry.toast.id)"
          >×</button>
        </div>

        <p
          v-if="entry.toast.message"
          class="detail"
          :data-level="entry.toast.level"
        >
          {{ entry.toast.message }}
        </p>
      </article>
    </template>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 200;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  max-width: 340px;
  pointer-events: none;
  font-family: 'Instrument Sans', system-ui, sans-serif;
}

.toast {
  pointer-events: auto;
  background: rgba(20, 20, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 8px 10px 10px;
  color: #e5e5e5;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  min-width: 240px;
  backdrop-filter: blur(8px);
  animation: slide-in 140ms ease-out;
}

@keyframes slide-in {
  from {
    transform: translateY(8px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.toast[data-level='success'] {
  border-color: rgba(91, 220, 130, 0.35);
}

.toast[data-level='warning'] {
  border-color: rgba(255, 200, 80, 0.4);
}

.toast[data-level='error'] {
  border-color: rgba(255, 107, 107, 0.45);
}

.toast[data-level='info'] {
  border-color: rgba(91, 124, 250, 0.4);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(91, 124, 250, 0.85);
  flex: 0 0 auto;
}

.dot[data-level='info'] {
  background: rgba(91, 124, 250, 0.9);
}

.dot[data-level='success'] {
  background: rgba(91, 220, 130, 0.9);
}

.dot[data-level='warning'] {
  background: rgba(255, 200, 80, 0.95);
}

.dot[data-level='error'] {
  background: rgba(255, 107, 107, 0.95);
}

.toast[data-status='uploading'] .dot {
  animation: pulse 1.1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.title {
  flex: 1 1 auto;
  font-size: 12px;
  color: #e5e5e5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.close {
  background: transparent;
  border: none;
  color: #909090;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}

.close:hover {
  color: #e5e5e5;
}

.progress {
  position: relative;
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}

.bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, rgba(91, 124, 250, 0.75), rgba(91, 124, 250, 1));
  transition: width 120ms linear;
}

.pct {
  position: absolute;
  right: 4px;
  top: -16px;
  font-size: 10px;
  color: #909090;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.detail {
  margin: 0;
  font-size: 11px;
  line-height: 1.35;
  color: #bdbdbd;
}

.detail[data-level='success'],
.success-detail {
  color: #8bd6a5;
}

.detail[data-level='warning'] {
  color: #f0c971;
}

.detail[data-level='error'],
.error-detail {
  color: #ff8b8b;
}
</style>
