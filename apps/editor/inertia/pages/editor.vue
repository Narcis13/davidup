<script setup lang="ts">
// Editor page — step 10 adds the Timeline to the three-panel shell.
//
// Step 05 mounted the davidup browser driver against a single full-bleed
// canvas. Step 08 moved that canvas into the `stage` slot of the
// three-panel layout. Step 09 added the Inspector to the `inspector` slot.
// Step 10 now fills the `timeline` slot: tweens become semantic, color-
// coded bars (template / behavior / scene / plain), the ruler shows the
// composition's seconds grid, and the playhead is driven by
// `useStage().playhead` so it tracks the engine's real RAF clock.
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
import Library from '~/components/Library.vue'
import Stage from '~/components/Stage.vue'
import Timeline from '~/components/Timeline.vue'

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

// Stage.vue owns the canvas element; we forward its inner ref out via
// `defineExpose` so the engine attach loop still binds to it.
const stageRef = ref<{ canvas: HTMLCanvasElement | null } | null>(null)
const canvas = computed<HTMLCanvasElement | null>(() => stageRef.value?.canvas ?? null)

const stage = useStage({ composition: bus.composition, canvas })
</script>

<template>
  <Head title="Editor" />

  <EditorLayout
    :status="bus.composition.value ? stage.status.value : null"
    :status-error="bus.composition.value ? stage.error.value : null"
    :project-root="project?.root ?? null"
  >
    <template #library>
      <Library />
    </template>

    <template #stage>
      <Stage
        v-if="bus.composition.value"
        ref="stageRef"
        :composition="bus.composition.value"
        :playhead="stage.playhead.value"
        :pick-item-at="stage.pickItemAt"
        @apply="bus.apply"
      />
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

    <template #timeline>
      <Timeline
        :composition="bus.composition.value"
        :playhead="stage.playhead.value"
        :status="bus.composition.value ? stage.status.value : null"
        @seek="(t) => stage.seek(t)"
        @apply="bus.apply"
      />
    </template>
  </EditorLayout>
</template>

<style scoped>
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
