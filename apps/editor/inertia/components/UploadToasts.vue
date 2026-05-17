<script setup lang="ts">
// UploadToasts — step 18b of the editor build plan.
//
// Renders one floating toast per active upload job. Each toast shows the
// file name, the kind (image/video/audio) once known, a progress bar while
// uploading, and a success / error state when the request completes.
// Mounted once at the editor shell level so LibraryPanel drops and editor-
// shell drops share a single stack.
//
// The toasts auto-dismiss themselves a few seconds after settling — see
// `useAssetUpload`'s `scheduleAutoDismiss`. The × button lets the user
// dismiss them sooner (and aborts the upload if still in-flight).

import { useAssetUpload, type UploadJob } from '~/composables/useAssetUpload'

const uploads = useAssetUpload()

function percent(job: UploadJob): number {
  return Math.round(Math.max(0, Math.min(1, job.progress)) * 100)
}

function asset(job: UploadJob) {
  return job.asset ?? null
}

function dismiss(id: string): void {
  uploads.dismissJob(id)
}
</script>

<template>
  <div
    v-if="uploads.jobs.value.length > 0"
    class="upload-toasts"
    role="region"
    aria-label="Asset uploads"
    data-testid="upload-toasts"
  >
    <article
      v-for="job in uploads.jobs.value"
      :key="job.id"
      class="toast"
      :data-status="job.status"
      :data-testid="`upload-toast-${job.id}`"
    >
      <div class="row">
        <span class="dot" :data-status="job.status" />
        <span class="name" :title="job.fileName">{{ job.fileName }}</span>
        <button type="button" class="close" aria-label="Dismiss" @click="dismiss(job.id)">×</button>
      </div>

      <div v-if="job.status === 'uploading'" class="progress">
        <div class="bar" :style="{ width: `${percent(job)}%` }" />
        <span class="pct">{{ percent(job) }}%</span>
      </div>

      <p v-else-if="job.status === 'success' && asset(job)" class="detail success-detail">
        Added to library · {{ asset(job)!.kind }}
        <template v-if="asset(job)!.width && asset(job)!.height">
          · {{ asset(job)!.width }}×{{ asset(job)!.height }}
        </template>
      </p>

      <p v-else-if="job.status === 'error'" class="detail error-detail">
        {{ job.error?.message ?? 'Upload failed' }}
      </p>
    </article>
  </div>
</template>

<style scoped>
.upload-toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 200;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  max-width: 320px;
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
  min-width: 220px;
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

.toast[data-status='success'] {
  border-color: rgba(91, 220, 130, 0.35);
}

.toast[data-status='error'] {
  border-color: rgba(255, 107, 107, 0.45);
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

.dot[data-status='uploading'] {
  animation: pulse 1.1s ease-in-out infinite;
}

.dot[data-status='success'] {
  background: rgba(91, 220, 130, 0.9);
}

.dot[data-status='error'] {
  background: rgba(255, 107, 107, 0.95);
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

.name {
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
}

.success-detail {
  color: #8bd6a5;
}

.error-detail {
  color: #ff8b8b;
}
</style>
