<script setup lang="ts">
// Three-panel editor shell — step 08 of the editor build plan.
//
// CSS-grid layout matching the v1.0 mockup:
//
//   ┌──────────┬─────────────────────┬──────────┐
//   │ Library  │       Stage         │Inspector │
//   │ (left)   │     (center)        │ (right)  │
//   ├──────────┴─────────────────────┴──────────┤
//   │                Timeline (bottom)          │
//   └───────────────────────────────────────────┘
//
// Sizing comes from `usePanelLayout()`, which hydrates from and persists to
// `~/.davidup/state.json` via `/api/editor-state`. Resize handles are
// pointer-driven; no external dependency.
//
// The shell renders four named slots (`library`, `stage`, `inspector`,
// `timeline`) and ships with placeholder copy in each. Real panel content
// arrives in steps 09 (Inspector), 10 (Timeline), 13 (Library); the stage
// canvas mounts in step 05's existing page using the `stage` slot.

import { usePanelLayout, type PanelKey } from '~/composables/usePanelLayout'

defineProps<{ status?: string | null; statusError?: string | null; projectRoot?: string | null }>()

const panel = usePanelLayout()

function startDrag(event: PointerEvent, p: PanelKey) {
  panel.beginDrag({ event, panel: p })
}
</script>

<template>
  <div
    class="editor-shell"
    :data-dragging="panel.isDragging.value ? 'true' : 'false'"
    :style="{
      gridTemplateColumns: panel.gridTemplateColumns.value,
      gridTemplateRows: panel.gridTemplateRows.value,
    }"
  >
    <aside class="panel panel-library" data-panel="library">
      <header class="panel-header">Library</header>
      <div class="panel-body">
        <slot name="library">
          <p class="placeholder">Library panel — templates, behaviors, scenes, assets.</p>
        </slot>
      </div>
    </aside>

    <div
      class="resize-handle resize-handle-vertical"
      data-handle="left"
      title="Drag to resize the Library panel"
      @pointerdown="(e) => startDrag(e, 'leftWidth')"
    />

    <main class="panel panel-stage" data-panel="stage">
      <slot name="stage">
        <p class="placeholder">Stage</p>
      </slot>
      <div v-if="status" class="stage-status" :data-status="status">
        <span>{{ status }}</span>
        <span v-if="statusError"> · {{ statusError }}</span>
        <span v-if="projectRoot" class="stage-status-project">· {{ projectRoot }}</span>
      </div>
    </main>

    <div
      class="resize-handle resize-handle-vertical"
      data-handle="right"
      title="Drag to resize the Inspector panel"
      @pointerdown="(e) => startDrag(e, 'rightWidth')"
    />

    <aside class="panel panel-inspector" data-panel="inspector">
      <header class="panel-header">Inspector</header>
      <div class="panel-body">
        <slot name="inspector">
          <p class="placeholder">Inspector panel — typed parameters for the selected item.</p>
        </slot>
      </div>
    </aside>

    <div
      class="resize-handle resize-handle-horizontal"
      data-handle="bottom"
      title="Drag to resize the Timeline panel"
      @pointerdown="(e) => startDrag(e, 'bottomHeight')"
    />

    <section class="panel panel-timeline" data-panel="timeline">
      <header class="panel-header">Timeline</header>
      <div class="panel-body">
        <slot name="timeline">
          <p class="placeholder">Timeline panel — tween bars, ruler, playhead.</p>
        </slot>
      </div>
    </section>
  </div>
</template>

<style scoped>
.editor-shell {
  position: fixed;
  inset: 0;
  display: grid;
  background: #0a0a0a;
  color: #e5e5e5;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  /* Columns: library | handle | stage | handle | inspector
     Rows:    [stage row] | handle | timeline                                  */
  grid-template-areas:
    'library handle-left stage handle-right inspector'
    'handle-bottom handle-bottom handle-bottom handle-bottom handle-bottom'
    'timeline timeline timeline timeline timeline';
  grid-template-columns: 280px 6px 1fr 6px 320px;
  grid-template-rows: 1fr 6px 220px;
  overflow: hidden;
}

.editor-shell[data-dragging='true'] {
  cursor: grabbing;
}

.panel {
  background: #111;
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.panel-library {
  grid-area: library;
}
.panel-stage {
  grid-area: stage;
  background: #0a0a0a;
  position: relative;
  align-items: center;
  justify-content: center;
}
.panel-inspector {
  grid-area: inspector;
}
.panel-timeline {
  grid-area: timeline;
}

.panel-header {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a3a3a3;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  flex: 0 0 auto;
}

.panel-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 12px;
}

.placeholder {
  color: #707070;
  font-size: 13px;
  margin: 0;
}

.resize-handle {
  background: transparent;
  position: relative;
  z-index: 2;
}

.resize-handle::after {
  content: '';
  position: absolute;
  background: rgba(255, 255, 255, 0.04);
  transition: background 120ms ease;
}

.resize-handle:hover::after,
.editor-shell[data-dragging='true'] .resize-handle::after {
  background: rgba(91, 124, 250, 0.45);
}

.resize-handle-vertical {
  cursor: col-resize;
}

.resize-handle-vertical[data-handle='left'] {
  grid-area: handle-left;
}

.resize-handle-vertical[data-handle='right'] {
  grid-area: handle-right;
}

.resize-handle-vertical::after {
  inset: 0 2px;
}

.resize-handle-horizontal {
  grid-area: handle-bottom;
  cursor: row-resize;
}

.resize-handle-horizontal::after {
  inset: 2px 0;
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
</style>
