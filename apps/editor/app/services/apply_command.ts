/*
|--------------------------------------------------------------------------
| applyCommand — pure (input → next) mutator on a Composition (step 06)
|--------------------------------------------------------------------------
|
| The CommandBus calls this. Tests call this. Property-based tests in CI
| compare UI command sequences against the equivalent MCP sequences (D4
| invariant in the PRD) by funnelling both through this function.
|
| Strategy: rehydrate the input composition into a fresh CompositionStore,
| run the matching MCP tool handler against it, then serialise back to JSON.
| Reusing the existing tool handlers is what keeps UI and MCP bytewise-
| identical — the rule the D4 gate enforces.
|
| Purity: the function does not mutate `composition` (input is deep-cloned
| before hydration via JSON round-trip), does not touch the shared MCP
| singleton store, and produces no side effects observable outside its
| return value. Two calls with byte-equal inputs return byte-equal outputs.
*/

import { CompositionStore, dispatchTool, TOOLS, type ToolDef } from 'davidup/mcp'
import type { Composition, Asset, Layer, Item, Tween } from 'davidup/schema'
import { z } from 'zod'

import { COMMAND_TO_TOOL, type Command } from '#types/commands'

// Index TOOLS by name once; the registry is frozen at import time.
const TOOL_BY_NAME: ReadonlyMap<string, ToolDef<z.ZodRawShape>> = new Map(
  TOOLS.map((t) => [t.name, t])
)

const HYDRATION_ID = '__editor_session__'

export class ApplyCommandError extends Error {
  readonly code: string
  readonly hint: string | undefined
  constructor(code: string, message: string, hint?: string) {
    super(message)
    this.name = 'ApplyCommandError'
    this.code = code
    this.hint = hint
  }
}

/**
 * Apply a typed command against a Composition and return the next state.
 *
 * Throws `ApplyCommandError` on:
 *  - unknown command kind (compile-time guarded by COMMAND_TO_TOOL but the
 *    dynamic Zod parse means runtime mismatches are still possible if the
 *    schema and the dispatch table drift),
 *  - tool-level rejection (E_NOT_FOUND, E_TWEEN_OVERLAP, etc.),
 *  - hydration failure (composition fed in does not load cleanly into a
 *    CompositionStore — usually means the composition is structurally
 *    invalid, in which case the caller should not have been mutating it).
 */
export async function applyCommand(
  composition: Composition,
  command: Command
): Promise<Composition> {
  const { next } = await applyCommandWithResult(composition, command)
  return next
}

/**
 * Same as `applyCommand` but also returns the underlying MCP tool's payload
 * (e.g. `{ itemId }`, `{ tweenId }`). The MCP bridge needs that so it can
 * return what a direct MCP call would have returned — `applyCommand`'s
 * Composition-only return is the right shape for the property-based tests
 * that compare byte-identical states between UI and MCP edit sequences.
 */
export async function applyCommandWithResult(
  composition: Composition,
  command: Command
): Promise<{ next: Composition; toolResult: unknown }> {
  const store = new CompositionStore()
  hydrateStore(store, composition, HYDRATION_ID)

  const toolName = COMMAND_TO_TOOL[command.kind]
  const tool = TOOL_BY_NAME.get(toolName)
  if (!tool) {
    throw new ApplyCommandError(
      'E_UNKNOWN_COMMAND',
      `No MCP tool "${toolName}" mapped to command "${command.kind}".`
    )
  }

  // Force the hydrated composition id into the payload so the tool always
  // targets the fresh store instance — never relies on a global default.
  const args = { ...(command.payload as Record<string, unknown>), compositionId: HYDRATION_ID }

  const result = await dispatchTool(tool, args, { store })
  if (!result.ok) {
    throw new ApplyCommandError(result.error.code, result.error.message, result.error.hint)
  }

  return { next: store.toJSON(HYDRATION_ID), toolResult: result.result }
}

// ──────────────── Hydration ────────────────
//
// Rehydrate a Composition JSON into a fresh CompositionStore. Used both by
// applyCommand on every call and by tests that drive the store directly.
//
// Order matters:
//   1. createComposition — sets meta + reserves the id.
//   2. assets — sprites/text reference these.
//   3. layers — items are placed into them by id.
//   4. items in declaration order, per layer.items[]. Items belonging to a
//      group but not listed in any layer (group children) are added as
//      "sub items" with no layer affiliation, matching how scene/template
//      expansion treats them.
//   5. tweens — added via addRawTween, which re-runs the overlap check.
//      A composition that came off disk should already be overlap-free,
//      so this is purely a guardrail.
export function hydrateStore(
  store: CompositionStore,
  composition: Composition,
  compositionId: string
): void {
  const meta = composition.composition
  store.createComposition({
    id: compositionId,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    duration: meta.duration,
    ...(meta.background !== undefined ? { background: meta.background } : {}),
  })

  for (const asset of composition.assets as ReadonlyArray<Asset>) {
    store.registerAssetUnchecked(asset, compositionId)
  }

  for (const layer of composition.layers as ReadonlyArray<Layer>) {
    store.addLayer(
      {
        id: layer.id,
        z: layer.z,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
      },
      compositionId
    )
  }

  const placed = new Set<string>()
  for (const layer of composition.layers as ReadonlyArray<Layer>) {
    for (const itemId of layer.items) {
      const item = (composition.items as Record<string, Item>)[itemId]
      if (item === undefined) {
        throw new ApplyCommandError(
          'E_HYDRATION',
          `Layer "${layer.id}" references missing item "${itemId}".`
        )
      }
      store.addRawItem({ id: itemId, layerId: layer.id, item }, compositionId)
      placed.add(itemId)
    }
  }

  for (const [itemId, item] of Object.entries(composition.items as Record<string, Item>)) {
    if (placed.has(itemId)) continue
    store.addRawSubItem({ id: itemId, item }, compositionId)
  }

  for (const tween of composition.tweens as ReadonlyArray<Tween>) {
    store.addRawTween(tween, compositionId)
  }
}
