<script setup lang="ts">
// Editor page — step 05 of the editor build plan.
// One Vue 3 page, no panels yet: instantiate the davidup browser driver
// against a single full-bleed canvas. Confirms the engine renders inside
// the editor process; layout shell and panels come in later steps.

import { computed, ref } from 'vue'
import { Head } from '@inertiajs/vue3'
import { useStage } from '~/composables/useStage'

type Composition = {
  composition: { width: number; height: number; duration: number; background?: string }
  [k: string]: unknown
}

const props = defineProps<{
  composition: Composition | null
  project: {
    root: string
    compositionPath: string
    libraryIndexPath: string | null
    assetsDir: string | null
    loadedAt: number
  } | null
  error: { code: string; message: string } | null
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const composition = computed(() => props.composition)

const stage = useStage({ composition, canvas })

const canvasWidth = computed(() => props.composition?.composition.width ?? 1280)
const canvasHeight = computed(() => props.composition?.composition.height ?? 720)
const aspect = computed(() => `${canvasWidth.value} / ${canvasHeight.value}`)
</script>

<template>
  <Head title="Editor" />

  <div class="editor-host">
    <div v-if="composition" class="stage-wrap">
      <canvas
        ref="canvas"
        class="stage-canvas"
        :width="canvasWidth"
        :height="canvasHeight"
        :style="{ aspectRatio: aspect }"
      />
      <div class="stage-status" :data-status="stage.status.value">
        <span>{{ stage.status.value }}</span>
        <span v-if="stage.error.value"> · {{ stage.error.value }}</span>
        <span v-if="project" class="stage-status-project">· {{ project.root }}</span>
      </div>
    </div>

    <div v-else class="empty">
      <h1>davidup editor</h1>
      <p v-if="error">{{ error.message }}</p>
      <p v-else>No project loaded.</p>
      <p class="hint">
        Boot the editor with <code>davidup edit &lt;project-dir&gt;</code>.
      </p>
    </div>
  </div>
</template>

<style scoped>
.editor-host {
  position: fixed;
  inset: 0;
  background: #0a0a0a;
  color: #e5e5e5;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.stage-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stage-canvas {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  background: #000;
  image-rendering: auto;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.stage-status {
  position: absolute;
  bottom: 12px;
  left: 12px;
  font-size: 12px;
  color: #a3a3a3;
  background: rgba(0, 0, 0, 0.55);
  padding: 4px 8px;
  border-radius: 4px;
  pointer-events: none;
  font-feature-settings: 'tnum';
}

.stage-status[data-status='error'] {
  color: #ff6b6b;
}

.stage-status-project {
  margin-left: 8px;
  opacity: 0.7;
}

.empty {
  text-align: center;
  max-width: 520px;
  padding: 32px;
}

.empty h1 {
  font-size: 28px;
  margin: 0 0 16px;
  letter-spacing: -0.02em;
}

.empty p {
  margin: 8px 0;
  color: #a3a3a3;
}

.empty .hint code {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.95em;
}
</style>
