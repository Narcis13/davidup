<script setup lang="ts">
// HelpOverlay — step 20.21 of the editor polish plan.
//
// Centred modal listing the editor's keyboard shortcuts, drag-and-drop
// affordances, and the MCP tool catalog. Toggled by `?` (registered in
// `useShortcuts`) and by the `davidup:toggle-help` window event that the
// app-bar's help button dispatches.
//
// The list of shortcuts is kept in lock-step with `useShortcuts.ts`. If
// you add a chord there, add a row here — there is no shared registry
// (and inventing one for six entries would be overkill).

import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useEditorPrefs } from '~/composables/useEditorPrefs'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const prefs = useEditorPrefs()

async function reshowOnboarding(): Promise<void> {
  await prefs.resetOnboarding()
  emit('close')
}

const isMac = computed<boolean>(() => {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
})

const modKey = computed<string>(() => (isMac.value ? '⌘' : 'Ctrl'))

interface Shortcut {
  keys: string[]
  label: string
}

const shortcuts = computed<Shortcut[]>(() => [
  { keys: ['Space'], label: 'Play / pause the stage' },
  { keys: ['Backspace'], label: 'Delete the current selection (item — or tween when a Timeline bar is selected)' },
  { keys: [`${modKey.value}`, 'Z'], label: 'Undo the most recent edit' },
  { keys: [`${modKey.value}`, '⇧', 'Z'], label: 'Redo the most recently undone edit' },
  { keys: [`${modKey.value}`, 'G'], label: 'Group selection (2+ items on same layer)' },
  { keys: [`${modKey.value}`, '⇧', 'G'], label: 'Ungroup selected group (flatten children back to the layer)' },
  { keys: [`${modKey.value}`, '0'], label: 'Fit timeline (reset playhead to start)' },
  { keys: [`${modKey.value}`, 'J'], label: 'Toggle reveal-in-source drawer' },
  { keys: [`${modKey.value}`, 'R'], label: 'Render to MP4' },
  { keys: [`${modKey.value}`, 'S'], label: 'Save (force flush)' },
  { keys: ['?'], label: 'Toggle this help overlay' },
  { keys: ['Esc'], label: 'Dismiss overlays / menus / cancel place mode / close animate popover' },
])

interface DragAffordance {
  from: string
  to: string
  result: string
}

const dragAffordances: DragAffordance[] = [
  {
    from: 'Inspector "+ animate" pill on a tweenable field',
    to: 'Same field row',
    result: 'Opens a popover to author a new tween for that property — confirm to dispatch add_tween.',
  },
  {
    from: 'Inspector "Move to" dropdown',
    to: 'Layer choice',
    result: 'Reparents the selected item between layers via move_item_to_layer.',
  },
  {
    from: 'Inspector "Name" field',
    to: 'Selected item',
    result: 'Sets a friendly label that shows up in the Outliner / Layers panel alongside the raw id.',
  },
  {
    from: 'Double-click a Layers panel row label',
    to: 'Same row',
    result: 'Inline-rename the layer — Enter commits, Esc cancels. Saves as a friendly name beside the id.',
  },
  {
    from: 'Recent-color swatch in any Inspector color picker',
    to: 'Same field',
    result: 'Applies the picked color — the strip remembers the last 8 unique hex values you used.',
  },
  {
    from: 'Render button / ⌘R',
    to: 'Editor toolbar',
    result: 'Opens the render dialog so you can pick a preset and filename before kickoff.',
  },
  {
    from: 'Render history checkbox',
    to: 'Past render row',
    result: 'Multi-select renders to bulk-delete; the Rename button retitles a render in place.',
  },
  {
    from: 'Stage toolbar button (Rectangle / Circle / Text / Sprite)',
    to: 'Stage canvas',
    result: 'Click the toolbar button, then click the stage to place the primitive on the topmost layer.',
  },
  {
    from: 'Shift / ⌘ / Ctrl-click on a Stage item',
    to: 'Item on the stage',
    result: 'Adds (or removes) the clicked item from the multi-selection. Pair with ⌘G to wrap two or more selected items in a group.',
  },
  {
    from: 'Library card (template / behavior / scene)',
    to: 'Timeline track',
    result: 'Inserts the item on that track with brand defaults pre-bound.',
  },
  {
    from: 'Library card',
    to: 'Empty area below the last track',
    result: 'Creates a new track and inserts the item there.',
  },
  {
    from: 'Library card',
    to: 'Stage',
    result: 'Adds the item at the cursor position on the active layer.',
  },
  {
    from: 'OS file (image, video, font)',
    to: 'Library panel',
    result: 'Uploads the file to the project assets dir and registers it.',
  },
  {
    from: 'OS file',
    to: 'Anywhere on the editor',
    result: 'Same as dropping on the Library panel — global fallback drop zone.',
  },
  {
    from: 'Timeline bar edge',
    to: 'Left / right',
    result: 'Resizes the tween (start / duration) with snapping to ruler ticks.',
  },
  {
    from: 'Timeline bar body',
    to: 'Horizontally',
    result: 'Slides the tween in time without changing its duration.',
  },
]

interface McpGroup {
  group: string
  tools: string[]
}

const mcpGroups: McpGroup[] = [
  {
    group: 'Composition',
    tools: [
      'create_composition',
      'get_composition',
      'set_composition_property',
      'validate',
      'reset',
    ],
  },
  { group: 'Assets', tools: ['register_asset', 'list_assets', 'remove_asset'] },
  { group: 'Layers', tools: ['add_layer', 'update_layer', 'remove_layer'] },
  {
    group: 'Items',
    tools: [
      'add_sprite',
      'add_text',
      'add_shape',
      'add_group',
      'update_item',
      'move_item_to_layer',
      'remove_item',
    ],
  },
  {
    group: 'Tweens',
    tools: ['add_tween', 'update_tween', 'remove_tween', 'list_tweens'],
  },
  {
    group: 'Templates & scenes',
    tools: [
      'apply_template',
      'define_user_template',
      'list_templates',
      'apply_behavior',
      'list_behaviors',
      'define_scene',
      'add_scene_instance',
      'update_scene_instance',
      'remove_scene_instance',
      'import_scene',
      'list_scenes',
      'remove_scene',
    ],
  },
  {
    group: 'Render',
    tools: ['render_preview_frame', 'render_thumbnail_strip', 'render_to_video'],
  },
  {
    group: 'Discovery',
    tools: ['list_easings', 'list_fonts', 'list_engine_capabilities'],
  },
]

function close(): void {
  emit('close')
}

function onBackdropClick(event: MouseEvent): void {
  if (!(event.target instanceof HTMLElement)) return
  if (event.target.dataset.helpBackdrop === 'true') close()
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

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown)
  }
})
</script>

<template>
  <div
    v-if="open"
    class="help-backdrop"
    data-help-backdrop="true"
    data-testid="help-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Editor help"
    @mousedown="onBackdropClick"
  >
    <div class="help-dialog">
      <header class="help-header">
        <div class="help-title">
          <span class="help-eyebrow">davidup editor</span>
          <h2>Keyboard, drag-and-drop, and MCP cheat-sheet</h2>
        </div>
        <button
          type="button"
          class="help-close"
          aria-label="Close help"
          data-testid="help-overlay-close"
          @click="close"
        >
          ×
        </button>
      </header>

      <div class="help-body">
        <section class="help-section">
          <h3>Keyboard shortcuts</h3>
          <ul class="shortcut-list">
            <li v-for="(s, idx) in shortcuts" :key="idx" class="shortcut-row">
              <span class="shortcut-keys">
                <kbd v-for="(k, i) in s.keys" :key="i">{{ k }}</kbd>
              </span>
              <span class="shortcut-label">{{ s.label }}</span>
            </li>
          </ul>
        </section>

        <section class="help-section">
          <h3>Drag &amp; drop</h3>
          <ul class="drag-list">
            <li v-for="(d, idx) in dragAffordances" :key="idx" class="drag-row">
              <span class="drag-flow">
                <span class="drag-from">{{ d.from }}</span>
                <span class="drag-arrow" aria-hidden="true">→</span>
                <span class="drag-to">{{ d.to }}</span>
              </span>
              <span class="drag-result">{{ d.result }}</span>
            </li>
          </ul>
        </section>

        <section class="help-section">
          <h3>MCP tools</h3>
          <p class="mcp-blurb">
            Davidup's MCP server exposes the same atomic verbs the editor calls
            internally. Point an MCP client at <code>davidup-mcp</code> (or
            <code>bun run src/mcp/bin.ts</code>) to drive the editor headlessly.
          </p>
          <div class="mcp-grid">
            <div v-for="g in mcpGroups" :key="g.group" class="mcp-group">
              <h4>{{ g.group }}</h4>
              <ul>
                <li v-for="t in g.tools" :key="t"><code>{{ t }}</code></li>
              </ul>
            </div>
          </div>
        </section>

        <section class="help-section">
          <h3>Learn more</h3>
          <ul class="link-list">
            <li>
              <a
                href="https://github.com/narcis13/davidup/blob/main/README.md"
                target="_blank"
                rel="noopener noreferrer"
              >README</a>
              <span class="link-blurb">— install, quickstart, three flavors of hello world.</span>
            </li>
            <li>
              <a
                href="https://github.com/narcis13/davidup/blob/main/design-doc.md"
                target="_blank"
                rel="noopener noreferrer"
              >design-doc.md</a>
              <span class="link-blurb">— the canonical composition spec.</span>
            </li>
            <li>
              <a
                href="https://github.com/narcis13/davidup/blob/main/examples/mcp-demo.md"
                target="_blank"
                rel="noopener noreferrer"
              >examples/mcp-demo.md</a>
              <span class="link-blurb">— end-to-end MCP agent walkthrough.</span>
            </li>
          </ul>
        </section>
      </div>

      <footer class="help-footer">
        <button
          type="button"
          class="reshow-btn"
          data-testid="help-overlay-reshow-onboarding"
          title="Show the get-started overlay again"
          @click="reshowOnboarding"
        >Re-show onboarding</button>
        <span>Press <kbd>?</kbd> or <kbd>Esc</kbd> to close.</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.help-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 6, 14, 0.74);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 250;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  color: #e5e5e5;
}

.help-dialog {
  width: min(820px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
  background: #0f1014;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.help-header {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: linear-gradient(180deg, rgba(91, 124, 250, 0.06), transparent);
}

.help-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.help-eyebrow {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #5b7cfa;
  font-weight: 600;
}

.help-title h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #f5f5f7;
}

.help-close {
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  transition: background 120ms ease, border-color 120ms ease;
}

.help-close:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.18);
}

.help-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px 22px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.help-section h3 {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #909090;
}

.shortcut-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 18px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  font-size: 13px;
}

.shortcut-keys {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 92px;
  flex: 0 0 auto;
}

.shortcut-label {
  color: #d4d4d4;
}

kbd {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-bottom-color: rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  padding: 2px 6px;
  color: #f0f0f0;
  min-width: 18px;
  text-align: center;
  line-height: 1;
}

.drag-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drag-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
}

.drag-flow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}

.drag-from,
.drag-to {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: #c8d2ff;
  background: rgba(91, 124, 250, 0.08);
  border: 1px solid rgba(91, 124, 250, 0.25);
  padding: 2px 6px;
  border-radius: 4px;
}

.drag-arrow {
  color: #707070;
}

.drag-result {
  font-size: 12.5px;
  color: #a3a3a3;
  line-height: 1.4;
}

.mcp-blurb {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: #a3a3a3;
  line-height: 1.5;
}

.mcp-blurb code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 5px;
  border-radius: 3px;
  color: #d4d4d4;
}

.mcp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.mcp-group {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 10px 12px;
}

.mcp-group h4 {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #aab7ff;
  font-weight: 600;
}

.mcp-group ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mcp-group li code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: #d4d4d4;
}

.link-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.link-list li {
  font-size: 12.5px;
  color: #a3a3a3;
}

.link-list a {
  color: #aab7ff;
  text-decoration: underline;
  text-underline-offset: 2px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.link-list a:hover {
  color: #c8d2ff;
}

.link-blurb {
  margin-left: 4px;
}

.help-footer {
  flex: 0 0 auto;
  padding: 10px 22px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  font-size: 11.5px;
  color: #909090;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.reshow-btn {
  appearance: none;
  background: rgba(91, 124, 250, 0.1);
  border: 1px solid rgba(91, 124, 250, 0.32);
  color: #c8d2ff;
  font: inherit;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.reshow-btn:hover {
  background: rgba(91, 124, 250, 0.2);
  border-color: rgba(91, 124, 250, 0.5);
  color: #ffffff;
}

.help-footer kbd {
  font-size: 10.5px;
}

@media (max-width: 640px) {
  .shortcut-list {
    grid-template-columns: 1fr;
  }
}
</style>
