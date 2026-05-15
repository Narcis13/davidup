/*
|--------------------------------------------------------------------------
| Command discriminated union — UI ↔ MCP mutation contracts (per PRD §04, step 06)
|--------------------------------------------------------------------------
|
| Every mutation to the loaded composition — whether driven by a Vue panel,
| a keyboard shortcut, or the MCP-bridged agent — is expressed as a typed
| Command. One variant per *mutating* MCP tool. Read-only tools (validate,
| list_*, get_composition, render_*) are not commands. Registry-management
| tools (define_scene/define_user_template/import_scene/remove_scene) mutate
| global runtime state rather than the composition document and are also
| excluded.
|
| The Zod schema is the single source of truth: TypeScript types are inferred
| from it, and the CommandBus runs the same schema on every inbound payload
| (HTTP body, MCP call, in-process call) so determinism guarantees hold no
| matter where the command originated.
*/

import { z } from 'zod'
import { EASING_NAMES } from 'davidup/easings'

// ──────────────── Reusable fragments ────────────────

const ID = z.string().min(1)
const COMPOSITION_ID = z.string().min(1).optional()
const UNIT = z.number().min(0).max(1)
const NON_NEG = z.number().nonnegative()
const POSITIVE = z.number().positive()
const POINTS = z.array(z.tuple([z.number(), z.number()]))
const TWEEN_VALUE = z.union([z.number(), z.string()])

const TRANSFORM_INPUT = {
  anchorX: z.number().optional(),
  anchorY: z.number().optional(),
  rotation: z.number().optional(),
  opacity: UNIT.optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
} as const

const SCENE_TRANSFORM = z
  .object({
    x: z.number(),
    y: z.number(),
    scaleX: z.number(),
    scaleY: z.number(),
    rotation: z.number(),
    anchorX: z.number(),
    anchorY: z.number(),
    opacity: UNIT,
  })
  .partial()

const TIME_MAPPING = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('identity') }),
  z.object({
    mode: z.literal('clip'),
    fromTime: NON_NEG,
    toTime: POSITIVE,
  }),
  z.object({
    mode: z.literal('loop'),
    count: z.number().int().min(1),
  }),
  z.object({
    mode: z.literal('timeScale'),
    scale: POSITIVE,
  }),
])

const ITEM_PROPS = z
  .object({
    x: z.number(),
    y: z.number(),
    scaleX: z.number(),
    scaleY: z.number(),
    rotation: z.number(),
    anchorX: z.number(),
    anchorY: z.number(),
    opacity: UNIT,
    width: NON_NEG,
    height: NON_NEG,
    asset: ID,
    tint: z.string(),
    text: z.string(),
    font: ID,
    fontSize: POSITIVE,
    color: z.string(),
    align: z.enum(['left', 'center', 'right']),
    fillColor: z.string(),
    strokeColor: z.string(),
    strokeWidth: NON_NEG,
    cornerRadius: NON_NEG,
    points: POINTS,
    items: z.array(ID),
  })
  .partial()

const SOURCE = z.enum(['ui', 'mcp']).default('ui')

// ──────────────── Per-tool payload schemas ────────────────

const setCompositionProperty = z.object({
  kind: z.literal('set_composition_property'),
  payload: z.object({
    property: z.enum(['width', 'height', 'fps', 'duration', 'background']),
    value: z.union([z.number(), z.string()]),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const registerAsset = z.object({
  kind: z.literal('register_asset'),
  payload: z.object({
    id: ID,
    type: z.enum(['image', 'font']),
    src: z.string().min(1),
    family: z.string().min(1).optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const removeAsset = z.object({
  kind: z.literal('remove_asset'),
  payload: z.object({
    id: ID,
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const addLayer = z.object({
  kind: z.literal('add_layer'),
  payload: z.object({
    id: ID.optional(),
    z: z.number(),
    opacity: UNIT.optional(),
    blendMode: z.string().optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const updateLayer = z.object({
  kind: z.literal('update_layer'),
  payload: z.object({
    id: ID,
    props: z.object({
      z: z.number().optional(),
      opacity: UNIT.optional(),
      blendMode: z.string().optional(),
    }),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const removeLayer = z.object({
  kind: z.literal('remove_layer'),
  payload: z.object({
    id: ID,
    cascade: z.boolean().optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const addSprite = z.object({
  kind: z.literal('add_sprite'),
  payload: z.object({
    layerId: ID,
    asset: ID,
    x: z.number(),
    y: z.number(),
    width: NON_NEG,
    height: NON_NEG,
    ...TRANSFORM_INPUT,
    tint: z.string().optional(),
    id: ID.optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const addText = z.object({
  kind: z.literal('add_text'),
  payload: z.object({
    layerId: ID,
    text: z.string(),
    font: ID,
    fontSize: POSITIVE,
    color: z.string(),
    x: z.number(),
    y: z.number(),
    anchorX: z.number().optional(),
    anchorY: z.number().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    rotation: z.number().optional(),
    opacity: UNIT.optional(),
    id: ID.optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const addShape = z.object({
  kind: z.literal('add_shape'),
  payload: z.object({
    layerId: ID,
    kind: z.enum(['rect', 'circle', 'polygon']),
    x: z.number(),
    y: z.number(),
    width: NON_NEG.optional(),
    height: NON_NEG.optional(),
    points: POINTS.optional(),
    fillColor: z.string().optional(),
    strokeColor: z.string().optional(),
    strokeWidth: NON_NEG.optional(),
    cornerRadius: NON_NEG.optional(),
    rotation: z.number().optional(),
    opacity: UNIT.optional(),
    id: ID.optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const addGroup = z.object({
  kind: z.literal('add_group'),
  payload: z.object({
    layerId: ID,
    x: z.number(),
    y: z.number(),
    childItemIds: z.array(ID).optional(),
    id: ID.optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const updateItem = z.object({
  kind: z.literal('update_item'),
  payload: z.object({
    id: ID,
    props: ITEM_PROPS,
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const moveItemToLayer = z.object({
  kind: z.literal('move_item_to_layer'),
  payload: z.object({
    itemId: ID,
    targetLayerId: ID,
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const removeItem = z.object({
  kind: z.literal('remove_item'),
  payload: z.object({
    id: ID,
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const addTween = z.object({
  kind: z.literal('add_tween'),
  payload: z.object({
    target: ID,
    property: ID,
    from: TWEEN_VALUE,
    to: TWEEN_VALUE,
    start: NON_NEG,
    duration: POSITIVE,
    easing: z.enum(EASING_NAMES).optional(),
    id: ID.optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const updateTween = z.object({
  kind: z.literal('update_tween'),
  payload: z.object({
    id: ID,
    props: z
      .object({
        target: ID,
        property: ID,
        from: TWEEN_VALUE,
        to: TWEEN_VALUE,
        start: NON_NEG,
        duration: POSITIVE,
        easing: z.enum(EASING_NAMES),
      })
      .partial(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const removeTween = z.object({
  kind: z.literal('remove_tween'),
  payload: z.object({
    id: ID,
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const applyBehavior = z.object({
  kind: z.literal('apply_behavior'),
  payload: z.object({
    target: ID,
    behavior: ID,
    start: NON_NEG,
    duration: POSITIVE,
    params: z.record(z.string(), z.unknown()).optional(),
    easing: z.enum(EASING_NAMES).optional(),
    id: ID.optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const applyTemplate = z.object({
  kind: z.literal('apply_template'),
  payload: z.object({
    templateId: ID,
    layerId: ID,
    start: NON_NEG.optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    id: ID.optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const addSceneInstance = z.object({
  kind: z.literal('add_scene_instance'),
  payload: z.object({
    sceneId: ID,
    layerId: ID,
    start: NON_NEG.optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    transform: SCENE_TRANSFORM.optional(),
    time: TIME_MAPPING.optional(),
    id: ID.optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const updateSceneInstance = z.object({
  kind: z.literal('update_scene_instance'),
  payload: z.object({
    instanceId: ID,
    params: z.record(z.string(), z.unknown()).optional(),
    transform: SCENE_TRANSFORM.optional(),
    start: NON_NEG.optional(),
    time: TIME_MAPPING.optional(),
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

const removeSceneInstance = z.object({
  kind: z.literal('remove_scene_instance'),
  payload: z.object({
    instanceId: ID,
    compositionId: COMPOSITION_ID,
  }),
  source: SOURCE,
})

// ──────────────── Discriminated union ────────────────

export const CommandSchema = z.discriminatedUnion('kind', [
  setCompositionProperty,
  registerAsset,
  removeAsset,
  addLayer,
  updateLayer,
  removeLayer,
  addSprite,
  addText,
  addShape,
  addGroup,
  updateItem,
  moveItemToLayer,
  removeItem,
  addTween,
  updateTween,
  removeTween,
  applyBehavior,
  applyTemplate,
  addSceneInstance,
  updateSceneInstance,
  removeSceneInstance,
])

export type Command = z.infer<typeof CommandSchema>
export type CommandKind = Command['kind']
export type CommandSource = z.infer<typeof SOURCE>

// Compile-time exhaustiveness anchor — every CommandKind must map to an MCP
// tool name. The Record forces the union to stay in sync with the dispatch
// table in apply_command.ts; missing or extra keys are a TS error.
export const COMMAND_TO_TOOL: { readonly [K in CommandKind]: string } = {
  set_composition_property: 'set_composition_property',
  register_asset: 'register_asset',
  remove_asset: 'remove_asset',
  add_layer: 'add_layer',
  update_layer: 'update_layer',
  remove_layer: 'remove_layer',
  add_sprite: 'add_sprite',
  add_text: 'add_text',
  add_shape: 'add_shape',
  add_group: 'add_group',
  update_item: 'update_item',
  move_item_to_layer: 'move_item_to_layer',
  remove_item: 'remove_item',
  add_tween: 'add_tween',
  update_tween: 'update_tween',
  remove_tween: 'remove_tween',
  apply_behavior: 'apply_behavior',
  apply_template: 'apply_template',
  add_scene_instance: 'add_scene_instance',
  update_scene_instance: 'update_scene_instance',
  remove_scene_instance: 'remove_scene_instance',
}

export const COMMAND_KINDS: ReadonlyArray<CommandKind> = Object.keys(
  COMMAND_TO_TOOL
) as CommandKind[]
