<script setup lang="ts">
// Editor page — step 08 wires the engine into the three-panel shell.
//
// Step 05 mounted the davidup browser driver against a single full-bleed
// canvas. Step 08 keeps that responsibility but moves the canvas into the
// `stage` slot of `layouts/editor.vue`, so the Library / Inspector /
// Timeline panels surround it. Panel sizes are persisted via
// `usePanelLayout()` to `~/.davidup/state.json`.

import { computed, ref } from 'vue'
import { Head } from '@inertiajs/vue3'
import { useStage } from '~/composables/useStage'
import EditorLayout from '~/layouts/editor.vue'

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

  <EditorLayout
    :status="composition ? stage.status.value : null"
    :status-error="composition ? stage.error.value : null"
    :project-root="project?.root ?? null"
  >
    <template #stage>
      <div v-if="composition" class="stage-wrap">
        <canvas
          ref="canvas"
          class="stage-canvas"
          :width="canvasWidth"
          :height="canvasHeight"
          :style="{ aspectRatio: aspect }"
        />
      </div>
      <div v-else class="empty">
        <h1>davidup editor</h1>
        <p v-if="error">{{ error.message }}</p>
        <p v-else>No project loaded.</p>
        <p class="hint">
          Boot the editor with <code>davidup edit &lt;project-dir&gt;</code>.
        </p>
      </div>
    </template>
  </EditorLayout>
</template>

<style scoped>
.stage-wrap {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
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

.empty {
  text-align: center;
  max-width: 520px;
  padding: 32px;
  color: #e5e5e5;
  font-family: 'Instrument Sans', system-ui, sans-serif;
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
