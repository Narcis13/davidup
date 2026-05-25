<script setup lang="ts">
// OnboardingOverlay — UX_GAPS §S.
//
// Lightweight "Get started" overlay that appears once per user (state
// persists in ~/.davidup/state.json via /api/editor-state). Surfaces the
// three primary entry points for a fresh project so newcomers don't stare
// at a single orange badge wondering what to do:
//
//   • Add a shape from the toolbar
//   • Browse the Library Templates tab
//   • Drop files anywhere to import assets
//
// Closing the overlay dismisses it permanently. Re-show it by calling
// `useEditorPrefs().resetOnboarding()` from the Help overlay (T) or via
// the MCP debug client.

import { computed, onMounted } from 'vue'
import { useEditorPrefs } from '~/composables/useEditorPrefs'

const props = defineProps<{
  /** Force-show even if the user dismissed it (e.g. opened from Help). */
  forceShow?: boolean
}>()

const emit = defineEmits<{ (event: 'close'): void }>()

const prefs = useEditorPrefs()

onMounted(() => {
  void prefs.hydrate()
})

const visible = computed<boolean>(() => {
  if (props.forceShow) return true
  if (!prefs.hydrated.value) return false
  return !prefs.onboarding.value.dismissed
})

async function dismiss(): Promise<void> {
  await prefs.dismissOnboarding()
  emit('close')
}

function focusLibraryTemplates(): void {
  // Dispatch a window event the Library panel listens for. Keeps coupling
  // light — the overlay doesn't import the Library composable.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('davidup:focus-library-tab', { detail: { tab: 'template' } }),
    )
  }
  void dismiss()
}

function focusDropZone(): void {
  // Visual cue — flash the dedicated dropzone overlay. We piggyback on the
  // editor's existing file-drag veil styling by toggling the event.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('davidup:flash-drop-zone'))
  }
  void dismiss()
}

function focusToolbarShape(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('davidup:focus-toolbar-button', { detail: { kind: 'rect' } }),
    )
  }
  void dismiss()
}
</script>

<template>
  <div
    v-if="visible"
    class="onboarding-backdrop"
    data-testid="onboarding-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Get started"
  >
    <div class="onboarding-dialog">
      <header class="dialog-header">
        <span class="eyebrow">welcome to davidup</span>
        <h2>Three ways to get something on stage</h2>
        <button
          type="button"
          class="close-btn"
          aria-label="Close"
          data-testid="onboarding-close"
          @click="dismiss"
        >×</button>
      </header>

      <div class="cta-grid">
        <button
          type="button"
          class="cta"
          data-testid="onboarding-add-shape"
          @click="focusToolbarShape"
        >
          <span class="cta-glyph" aria-hidden="true">▭</span>
          <span class="cta-title">Add a shape</span>
          <span class="cta-body">
            Click <kbd>▭</kbd> in the stage toolbar, then click on the canvas
            to place a rectangle, circle, or polygon.
          </span>
        </button>

        <button
          type="button"
          class="cta"
          data-testid="onboarding-browse-templates"
          @click="focusLibraryTemplates"
        >
          <span class="cta-glyph" aria-hidden="true">✦</span>
          <span class="cta-title">Browse templates</span>
          <span class="cta-body">
            Drag a Library template onto the stage to apply it with default
            params. Open the dialog to customize before dropping.
          </span>
        </button>

        <button
          type="button"
          class="cta"
          data-testid="onboarding-drop-assets"
          @click="focusDropZone"
        >
          <span class="cta-glyph" aria-hidden="true">⬇</span>
          <span class="cta-title">Drop files</span>
          <span class="cta-body">
            Drag images, fonts, or videos anywhere on the editor — davidup
            uploads and registers them as composition assets.
          </span>
        </button>
      </div>

      <footer class="dialog-footer">
        <span class="footer-hint">Press <kbd>?</kbd> any time for the full keyboard cheat-sheet.</span>
        <button
          type="button"
          class="footer-btn"
          data-testid="onboarding-dismiss"
          @click="dismiss"
        >Got it</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.onboarding-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 14, 0.78);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 220;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  color: #e5e5e5;
}

.onboarding-dialog {
  width: min(720px, calc(100vw - 48px));
  background: #0f1014;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  padding: 20px 24px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  background: linear-gradient(180deg, rgba(91, 124, 250, 0.08), transparent);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.eyebrow {
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #5b7cfa;
  font-weight: 600;
}

.dialog-header h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #f5f5f7;
}

.close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
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

.cta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 20px 24px;
}

.cta {
  appearance: none;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #d4d4d4;
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
  font: inherit;
}

.cta:hover {
  background: rgba(91, 124, 250, 0.1);
  border-color: rgba(91, 124, 250, 0.45);
  transform: translateY(-1px);
}

.cta-glyph {
  font-size: 22px;
  color: #aab7ff;
}

.cta-title {
  font-size: 14px;
  font-weight: 600;
  color: #f0f0f0;
}

.cta-body {
  font-size: 12.5px;
  color: #a3a3a3;
  line-height: 1.45;
}

.cta-body kbd {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 3px;
  padding: 1px 5px;
  color: #f0f0f0;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.footer-hint {
  font-size: 12px;
  color: #909090;
}

.footer-hint kbd {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 3px;
  padding: 1px 5px;
  color: #f0f0f0;
}

.footer-btn {
  appearance: none;
  background: rgba(91, 124, 250, 0.22);
  border: 1px solid rgba(91, 124, 250, 0.55);
  color: #ffffff;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.footer-btn:hover {
  background: rgba(91, 124, 250, 0.34);
}

@media (max-width: 720px) {
  .cta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
