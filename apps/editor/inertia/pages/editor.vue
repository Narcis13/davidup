<script setup lang="ts">
// Editor page — step 09 wires the Inspector into the three-panel shell.
//
// Step 05 mounted the davidup browser driver against a single full-bleed
// canvas. Step 08 moved that canvas into the `stage` slot of the
// three-panel layout. Step 09 now adds the Inspector to the `inspector`
// slot: it reads the selected item via `useSelection`, dispatches typed
// `update_item` commands through `useCommandBus`, and the live response
// flows back into `useStage` which re-attaches at the preserved playhead.
//
// Local composition state lives in `useCommandBus` so command results
// can replace it in-place. The original payload is also retained as a
// baseline so the Inspector can render the orange "overridden" dot.

import { computed, ref } from 'vue'
import { Head } from '@inertiajs/vue3'
import { useStage } from '~/composables/useStage'
import { useCommandBus, type Composition } from '~/composables/useCommandBus'
import { provideSelection } from '~/composables/useSelection'
import EditorLayout from '~/layouts/editor.vue'
import Inspector from '~/components/Inspector.vue'

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

provideSelection(null)

const bus = useCommandBus({ initial: props.composition })

const canvas = ref<HTMLCanvasElement | null>(null)

const stage = useStage({ composition: bus.composition, canvas })

const canvasWidth = computed(() => bus.composition.value?.composition.width ?? 1280)
const canvasHeight = computed(() => bus.composition.value?.composition.height ?? 720)
const aspect = computed(() => `${canvasWidth.value} / ${canvasHeight.value}`)
</script>

<template>
  <Head title="Editor" />

  <EditorLayout
    :status="bus.composition.value ? stage.status.value : null"
    :status-error="bus.composition.value ? stage.error.value : null"
    :project-root="project?.root ?? null"
  >
    <template #stage>
      <div v-if="bus.composition.value" class="stage-wrap">
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

    <template #inspector>
      <Inspector
        :composition="bus.composition.value"
        :baseline="bus.baseline.value"
        :pending="bus.pending.value"
        :error="bus.error.value"
        @apply="bus.apply"
      />
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
