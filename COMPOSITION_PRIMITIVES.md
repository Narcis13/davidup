# Composition Primitives — proposal for scaling beyond a single flat JSON

> **Status:** proposal / pre-RFC. Nothing here is committed to the v0.1 schema
> or the engine. This document is the reference to argue *for* and *against*
> when we sit down to design v0.2+.
> **Audience:** future contributors, future visual-editor authors, future
> versions of us picking this up cold.
> **Date:** 2026-05-08
> **Author seed:** Claude (max-effort pass), narcis75@gmail.com

---

## 1. The problem

`examples/comprehensive-composition.json` is **1330 lines** for a 20-second
clip with 17 items, 7 layers, and 93 tweens. Linearly extrapolated, a
1–2 minute video lands somewhere between **4,000 and 12,000 lines** of JSON
in a single file. That hits three problems:

1. **Human readability collapses.** A reviewer cannot hold the full timeline
   in their head. Diffs become useless. Scrolling becomes navigation.
2. **Authoring becomes copy-paste.** "Pop-in" (opacity + scaleX + scaleY with
   `easeOutBack`) is the same five lines × 3 every time it's used. The
   comprehensive demo already has the same shape repeated for the title,
   triangle, star, orbit group, and footer.
3. **A future visual editor has no anchor.** A 1-file monolith can't be
   edited as panels-of-files; the editor needs a unit of nesting that maps
   to "tab" or "drill-in".

The flat JSON is not wrong — it is the **canonical, deterministic engine
input**, and that property must survive every change here. What's missing is
an **authoring layer** above it that compiles down to the canonical form.

For machines / agents driving via MCP today: the flat form is fine. They
issue ~93 atomic tool calls and don't care about file boundaries. The
proposal below preserves their world while adding a new world for humans
and (eventually) the visual editor.

### Numbers worth keeping in mind (from the current demo)

| Metric | Value |
|---|---|
| Lines | 1330 |
| Items | 17 |
| Layers | 7 |
| Tweens | 93 |
| Asset references | 3 |
| Distinct "motions" if you squint | ~24 (pop-in, fade-out, color cycle, …) |

The tween-to-item ratio (5.5×) is what blows up the file. **Compressing the
motion vocabulary is the highest-leverage win.**

---

## 2. Goals and non-goals

### Goals
- **G1.** Let humans split a long composition across multiple readable files.
- **G2.** Let humans express common motions ("fade in", "pop in", "shake")
  without writing 3-7 individual tweens.
- **G3.** Let humans build *reusable scene units* — title cards, lower
  thirds, bullet-list reveals — that can be parameterized and dropped into
  multiple videos.
- **G4.** Map cleanly onto a future visual editor (After-Effects-style
  pre-comps, drill-in panels, override inspectors).
- **G5.** Preserve **bit-for-bit determinism**. Same authored source → same
  pixels.
- **G6.** Preserve the existing flat-JSON path. Anything written today still
  works tomorrow.
- **G7.** Be useful to AI agents too: fewer tool calls per scene, higher-level
  primitives for common patterns.

### Non-goals (explicitly deferred)
- Real-time collaborative editing.
- Cross-composition asset management (asset library / DAM).
- A scripting language for tween generation. We stay declarative.
- Audio sync (separate v0.2 stream per design-doc §1).
- Variable fonts, multi-line text wrap (out of scope per §1).

---

## 3. Design principles

1. **Two-layer model.** *Authored* JSON above, *canonical* JSON below. The
   engine only ever consumes canonical. A pure compile step bridges them.
2. **Compile, don't interpret.** Every authoring primitive expands to
   things the engine already understands (items, tweens, groups). No new
   runtime concepts. The engine code does not change.
3. **Determinism survives expansion.** The compiler is itself a pure function
   of the authored input. Sorted iteration. Stable id generation. No reads
   from `Date.now()` / random.
4. **Additive, not breaking.** A v0.1 file is a valid v0.2 file. Every new
   feature is opt-in via a top-level key (`scenes`, `templates`, `imports`,
   …) that older files don't use.
5. **Source maps are first-class.** Every compiled item / tween records
   "this came from file X, instance Y, at path Z." The editor and error
   messages depend on these.
6. **MCP gets new tools, not replacements.** `add_tween` still exists.
   New tools (`apply_behavior`, `add_scene_instance`, …) sit alongside.
7. **Validate twice.** Pre-expansion (authoring rules), post-expansion
   (existing §3.5 rules unchanged). Errors point back to the authored
   source via source maps.

---

## 4. Solution overview — five primitives, layered

| # | Primitive | What it solves | New engine code? | Cost to ship |
|---|---|---|---|---|
| P1 | **`$ref` file imports** | Splits monolith JSON across files | None | Small |
| P2 | **Behaviors** (motion macros) | Compresses tween repetition | None | Small |
| P3 | **Templates** (parameterized snippets) | Reusable item+tween bundles with params | None | Medium |
| P4 | **Scenes** (sub-compositions) | Self-contained authored units with own timeline | None* | Medium-large |
| P5 | **Scene instances + overrides** | Drop scene N times with per-instance variations | None* | Medium |

\* *None at the renderer level. The compiler does the work — scenes lower
to existing `group` items + namespaced inner items + tweens shifted into
parent time. The Canvas2D save/restore stack already handles the inherited
transform/opacity for free.*

Each primitive is independently shippable and provides value on its own.
Order them v0.2 → v0.4 (see §10).

---

## 5. Primitive 1 — `$ref` file imports

### 5.1 Shape

At any place where the canonical schema expects an array, object, or scalar,
allow:

```json
{ "$ref": "./scenes/intro.json" }
```

Or with a sub-pointer (RFC-6901 JSON Pointer):

```json
{ "$ref": "./libraries/transitions.json#/wipeLeft" }
```

### 5.2 Two ways to use it

**Inline mode** — the `$ref` is replaced by the imported value at compile
time. No semantic change, just a file split:

```json
{
  "items": {
    "intro-card-bg":   { "$ref": "./fragments/intro-card-bg.json" },
    "intro-card-text": { "$ref": "./fragments/intro-card-text.json" }
  }
}
```

**Spread mode** — for arrays of items / tweens, allow the imported value to
*be* the array, spreading on import:

```json
{
  "tweens": [
    { "$ref": "./tweens/title-pop-in.json" },
    { "$ref": "./tweens/title-pop-out.json" },
    { "id": "tw_inline_one", "...": "..." }
  ]
}
```

If the referenced JSON file is itself a top-level array, spread it inline
in place of the single `$ref` entry.

### 5.3 Resolution rules

- **Working dir** is the file containing the `$ref`. All paths resolve from
  there. (Like ES modules; no global registry.)
- **Cycles** are an error: `E_REF_CYCLE`.
- **Missing files** are `E_REF_MISSING`.
- **Caching** — within one compile pass, each file is parsed once. Repeated
  refs hit the in-memory cache.

### 5.4 What `$ref` is *not*

It's not a runtime feature. The engine never sees `$ref`. By the time
`computeStateAt` runs, every reference has been inlined. This is what
makes `$ref` cheap to ship: it's a JSON pre-processor, not a schema
extension.

### 5.5 Implementation hint

```ts
// src/compose/imports.ts
export async function resolveImports(
  rootPath: string,
  json: unknown,
): Promise<unknown> {
  const cache = new Map<string, unknown>();
  const inFlight = new Set<string>();  // for cycle detection
  return walk(json, dirname(rootPath));
  async function walk(node: unknown, baseDir: string): Promise<unknown> {
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const child of node) {
        const resolved = await walk(child, baseDir);
        if (isSpreadable(child, resolved)) {
          out.push(...(resolved as unknown[]));  // spread mode
        } else {
          out.push(resolved);
        }
      }
      return out;
    }
    if (isObject(node)) {
      if (typeof node.$ref === "string") return loadRef(node.$ref, baseDir);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = await walk(v, baseDir);
      return out;
    }
    return node;
  }
}
```

---

## 6. Primitive 2 — Behaviors (motion macros)

### 6.1 Motivation

The current comprehensive demo has these patterns repeating:

- **fade-in** (opacity 0→1): 7 occurrences
- **fade-out** (opacity X→0): 6 occurrences
- **pop-in** (opacity + scaleX + scaleY together): 4 occurrences
- **rotate-spin** (rotation 0→2π): 3 occurrences
- **kenburns** (slow x + scale tween): 0 today, but typical for video
- **shake / jitter** (oscillating x): 0 today
- **color-cycle** (color A→B→C): present for ball.tint and bg.fillColor

A **behavior** is a named, parameterized bundle of tweens.

### 6.2 Authoring shape

```json
{
  "tweens": [
    {
      "$behavior": "popIn",
      "target": "title",
      "start": 0.2,
      "duration": 1.4,
      "easing": "easeOutBack",
      "params": { "fromScale": 0.2 }
    },
    {
      "$behavior": "fadeOut",
      "target": "title",
      "start": 19,
      "duration": 1
    },
    {
      "$behavior": "shake",
      "target": "ball",
      "start": 8.5,
      "duration": 0.5,
      "params": { "amplitude": 12, "cycles": 4 }
    }
  ]
}
```

### 6.3 Built-in library (initial set)

| Behavior | Expands to | Required params |
|---|---|---|
| `fadeIn` | 1 tween: `transform.opacity 0→1` | none |
| `fadeOut` | 1 tween: `transform.opacity X→0` (X read from item or override) | none |
| `popIn` | 3 tweens: opacity 0→1, scaleX A→B, scaleY A→B | none |
| `popOut` | 3 tweens: opacity X→0, scaleX X→Y, scaleY X→Y | none |
| `slideIn` | 1 tween on transform.x or .y from offset to current | `from`, `axis` |
| `slideOut` | 1 tween from current to offset | `to`, `axis` |
| `rotateSpin` | 1 tween: rotation 0→2πN | optional `turns` |
| `kenburns` | 2 tweens: x drift + scale drift | `fromScale`, `toScale`, `pan` |
| `shake` | N tweens on .x oscillating | `amplitude`, `cycles` |
| `colorCycle` | N-1 tweens through a color list | `colors[]` |
| `pulse` | 2 mirrored scale tweens (out then in) | `peakScale` |

Each behavior is a pure function `(args) → Tween[]`. Stable, deterministic
ids derived from the parent tween id + behavior step index.

### 6.4 ID generation

```
behavior id "fade1"  →  expands to tweens "fade1__opacity"
behavior id "popIn1" →  expands to "popIn1__opacity", "popIn1__scaleX", "popIn1__scaleY"
```

This is deterministic and human-readable. If a user provides explicit ids,
use them; otherwise derive from `${target}_${behavior}_${start}`.

### 6.5 Validation

- `E_BEHAVIOR_UNKNOWN` — behavior name not in registry
- `E_BEHAVIOR_PARAM_MISSING` — required param absent
- `E_BEHAVIOR_PARAM_TYPE` — wrong type for a param
- After expansion: the existing `E_TWEEN_OVERLAP` check catches collisions
  with manually authored tweens.

### 6.6 User-defined behaviors

Initially: built-ins only. v0.3 adds user behaviors via a registration
file:

```json
{
  "behaviors": {
    "myBoinge": {
      "params": [
        { "name": "amount", "type": "number", "default": 1.2 }
      ],
      "tweens": [
        { "property": "transform.scaleX", "from": 1, "to": "${params.amount}", "duration": 0.2, "easing": "easeOutBack" },
        { "property": "transform.scaleX", "from": "${params.amount}", "to": 1, "start": "${$.start + 0.2}", "duration": 0.2, "easing": "easeInQuad" }
      ]
    }
  }
}
```

The `${params.X}` and `${$.X}` substitution syntax is shared with templates
and scenes (§7, §8).

### 6.7 MCP tooling

New tools (one minimal pair to start):

```ts
apply_behavior({
  target: string,
  behavior: string,
  start: number,
  duration?: number,
  params?: Record<string, unknown>,
  easing?: EasingName,
  id?: string
}) → { tweenIds: string[] }

list_behaviors() → { behaviors: BehaviorDescriptor[] }
```

Replaces ~3-7 `add_tween` calls with one for the common cases. Agents
discover available behaviors via `list_behaviors`.

---

## 7. Primitive 3 — Templates (parameterized snippets)

### 7.1 Motivation

Behaviors handle motion. Templates handle **item + motion bundles** — a
"thing you draw and animate together." Examples:
- A title card with title + subtitle + animation
- A lower-third with name + role + sweep-in
- A bullet-list reveal that staggers N text items

### 7.2 Authoring shape

```json
{
  "items": {
    "myLowerThird": {
      "$template": "lowerThird",
      "params": {
        "name":  "Narcis Brîndușescu",
        "role":  "Engineer",
        "x":     120,
        "y":     900,
        "color": "#ffd166",
        "fontDisplay": "font-display",
        "fontMono": "font-mono"
      },
      "start": 4.5,        // optional: time offset into parent timeline
      "layerId": "lt-layer"
    }
  }
}
```

A template, when expanded, produces:
- 0..N items added under the named layer (or a new layer if `layerId`
  not specified and the template requests one)
- 0..N tweens, all relative-to-`start`, prefixed with the instance id

### 7.3 Template definition file

`templates/lowerThird.json`:

```json
{
  "id": "lowerThird",
  "params": [
    { "name": "name",       "type": "string", "required": true },
    { "name": "role",       "type": "string", "required": true },
    { "name": "x",          "type": "number", "default": 120 },
    { "name": "y",          "type": "number", "default": 900 },
    { "name": "color",      "type": "color",  "default": "#ffd166" },
    { "name": "fontDisplay","type": "string", "required": true },
    { "name": "fontMono",   "type": "string", "required": true }
  ],
  "items": {
    "bar": {
      "type": "shape", "kind": "rect",
      "width": 0, "height": 6,
      "fillColor": "${params.color}",
      "transform": { "x": "${params.x}", "y": "${params.y + 80}", "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 1 }
    },
    "name": {
      "type": "text", "text": "${params.name}",
      "font": "${params.fontDisplay}", "fontSize": 64, "color": "#ffffff",
      "transform": { "x": "${params.x}", "y": "${params.y}", "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 0 }
    },
    "role": {
      "type": "text", "text": "${params.role}",
      "font": "${params.fontMono}", "fontSize": 24, "color": "${params.color}",
      "transform": { "x": "${params.x}", "y": "${params.y + 38}", "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 0 }
    }
  },
  "tweens": [
    { "$behavior": "fadeIn", "target": "name", "start": 0.0, "duration": 0.4, "easing": "easeOutQuad" },
    { "$behavior": "fadeIn", "target": "role", "start": 0.2, "duration": 0.4, "easing": "easeOutQuad" },
    { "target": "bar", "property": "width", "from": 0, "to": 360, "start": 0.0, "duration": 0.6, "easing": "easeOutBack" }
  ]
}
```

### 7.4 Param substitution

- Strings of the form `${params.X}` are replaced by the param value.
- Arithmetic: `${params.x + 80}` requires an expression evaluator. **For
  v0.3, ship literal substitution only.** Authors compute offsets in their
  app before passing params, or duplicate the value. The expression
  evaluator can come later (§16-O1).

### 7.5 ID rewriting on expansion

Each item id inside the template is prefixed by the instance id at expansion
time. So `"name"` inside the template becomes `"myLowerThird__name"` in the
canonical output. Same for tween targets: `"name"` → `"myLowerThird__name"`.

This gives us a guarantee: **two instances of the same template never
collide on item ids or tween (target, property) buckets.**

### 7.6 Time mapping

Tweens declared inside a template have `start` in **template-local time**
(0 = the moment the instance starts). On expansion, the global `start` is
`instance.start + local.start`.

### 7.7 Validation

- `E_TEMPLATE_UNKNOWN`
- `E_TEMPLATE_PARAM_MISSING`
- `E_TEMPLATE_PARAM_TYPE`
- After expansion: existing rules apply.

### 7.8 MCP tooling

```ts
apply_template({
  templateId: string,
  layerId: string,
  start?: number,
  params: Record<string, unknown>,
  id?: string,
  compositionId?: string
}) → { instanceId: string, items: string[], tweens: string[] }
```

Returns the expanded ids so the agent can target them with subsequent
`update_item` / `add_tween` calls if needed.

---

## 8. Primitive 4 — Scenes (sub-compositions / pre-comps)

### 8.1 Motivation

Templates are good for *small* reusable units. **Scenes** are the unit for
large self-contained chunks: "intro," "section 1," "outro." A 2-minute
video might be 4–6 scenes of 15–30 seconds each.

A scene is essentially a **mini-composition**: own duration, own items,
own tweens. The parent video sequences scene instances on its timeline.
This is the After Effects pre-comp model.

### 8.2 Scene definition

```json
{
  "id": "introCard",
  "duration": 12,
  "size": { "width": 1920, "height": 1080 },
  "background": "transparent",
  "params": [
    { "name": "title",        "type": "string", "required": true },
    { "name": "subtitle",     "type": "string", "default": "" },
    { "name": "primaryColor", "type": "color",  "default": "#ff6b35" }
  ],
  "assets": [
    { "id": "font-display", "type": "font", "src": "../fonts/Bebas.ttf", "family": "Bebas" }
  ],
  "items": { /* sprites/text/shapes/groups, scoped to this scene */ },
  "tweens": [ /* tweens in scene-local time */ ]
}
```

Notes:
- `duration` is the scene's own length (independent of parent duration).
- `size` is informational. The scene paints into the parent's coordinate
  system at runtime; `size` is used for anchor fallback and for the future
  visual editor's per-scene canvas.
- `background: "transparent"` means "don't paint a bg." If a hex color is
  provided, the scene paints a full-bleed bg rect at z=-∞ when instanced.
- `assets` declared here are merged into the root `assets` at compile time.
  Conflict on id with different `src` → `E_ASSET_CONFLICT`.
- `params` follows the same shape as templates.

### 8.3 Scene instance

A new item type, `"scene"`, references a scene by id and places it in the
parent timeline.

```json
{
  "items": {
    "intro": {
      "type": "scene",
      "scene": "introCard",
      "params": { "title": "MotionForge", "subtitle": "v0.2 demo" },
      "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 1 }
    }
  },
  "layers": [
    { "id": "main", "z": 0, "opacity": 1, "blendMode": "normal", "items": ["intro"] }
  ],
  "tweens": [
    { "target": "intro", "property": "transform.opacity", "from": 0, "to": 1, "start": 0.0, "duration": 0.5 },
    { "target": "intro", "property": "transform.opacity", "from": 1, "to": 0, "start": 11.5, "duration": 0.5 }
  ]
}
```

Tweens on the instance's transform animate the *entire* scene as a unit —
same way you'd cross-fade between two pre-comps in After Effects.

### 8.4 Compilation rule (the key trick)

A scene instance with id `intro`, scene `introCard`, parent-time `start = 0`:

1. The instance becomes a **`group` item** with id `intro`, transform =
   instance.transform, items = `[introCard's prefixed items]`.
2. Each item from the scene is cloned, id prefixed `intro__X`, and added
   to the root `items` map.
3. Each tween from the scene is cloned, target prefixed `intro__X`, and
   `start` shifted by `instance.start`. Added to root `tweens`.
4. Scene's `assets` merged into root `assets` (de-dup by id; conflict on
   src → error).
5. If the scene declares a `background`, prepend a bg rect item at `z=-1`
   inside the synthetic group (so it sits behind the scene's contents but
   above the parent's underlying layers).
6. Param substitution happens *before* id rewriting so refs resolve cleanly.

**That's it.** The result is canonical Composition v0.1 JSON. The engine
runs unchanged. `drawItem`'s existing group recursion handles the nested
transform inheritance via Canvas2D `save/restore`.

### 8.5 Time mapping options

For v0.4 ship only the simplest mode: **identity time** (1:1).

| Mode | What it does | Ship in |
|---|---|---|
| `identity` (default) | scene-local `t=0` plays at parent `instance.start` | v0.4 |
| `clip` | trim to `[fromTime, toTime]` of scene-local time | v0.5 |
| `loop` | repeat scene N times (or until parent end) | v0.5 |
| `timeScale` | play scene at K× speed (K∈ℝ+) | v0.5 |
| `reverse` | play scene backwards | v0.6 |

`identity` covers the 80% case and is easy to reason about. The exotic
modes need careful spec to be deterministic and to interact with tween
overlap rules — defer them.

### 8.6 Sequencing scenes (the common shape for 1-min videos)

```json
{
  "version": "0.2",
  "composition": { "width": 1920, "height": 1080, "fps": 30, "duration": 60, "background": "#000000" },
  "imports": [
    "./scenes/intro.json",
    "./scenes/section-pricing.json",
    "./scenes/section-features.json",
    "./scenes/outro.json"
  ],
  "items": {
    "intro":     { "type": "scene", "scene": "introCard",     "params": {"title": "MotionForge"}, "transform": {...} },
    "pricing":   { "type": "scene", "scene": "sectionPricing","params": {"plans": [...]},          "transform": {...} },
    "features":  { "type": "scene", "scene": "sectionFeatures","params": {"items": [...]},         "transform": {...} },
    "outro":     { "type": "scene", "scene": "outroCard",     "params": {"cta": "Try it"},         "transform": {...} }
  },
  "layers": [ { "id": "main", "z": 0, "items": ["intro","pricing","features","outro"] } ],
  "tweens": [
    { "target": "intro",    "property": "transform.opacity", "from": 0, "to": 1, "start": 0,    "duration": 0.5 },
    { "target": "intro",    "property": "transform.opacity", "from": 1, "to": 0, "start": 11.5, "duration": 0.5 },
    { "target": "pricing",  "property": "transform.opacity", "from": 0, "to": 1, "start": 12,   "duration": 0.5 },
    { "target": "pricing",  "property": "transform.opacity", "from": 1, "to": 0, "start": 27.5, "duration": 0.5 },
    { "target": "features", "property": "transform.opacity", "from": 0, "to": 1, "start": 28,   "duration": 0.5 },
    { "target": "features", "property": "transform.opacity", "from": 1, "to": 0, "start": 47.5, "duration": 0.5 },
    { "target": "outro",    "property": "transform.opacity", "from": 0, "to": 1, "start": 48,   "duration": 0.5 }
  ]
}
```

This root file is **~50 lines** and tells you the whole shape of the video
at a glance. Each scene file is its own ~150-300 line unit.

### 8.7 Sealed-instance principle

Tweens in the **parent** can only target the instance's root transform
(opacity, x, y, scale, rotation, anchor). They cannot reach inside and
re-animate, say, `intro__title.transform.scaleX`.

This is a deliberate constraint:
- Keeps scenes **encapsulated**. The author of `introCard` controls its
  motion. The user just places it.
- Avoids scope creep on the schema (no special "deep" property paths).
- If the user *needs* per-instance variation, they pass it as a `param`
  (color, text, position offset) — that's what params are for.

A future "expose internal targets" mechanism is feasible (define a scene's
*public motion API*) but defer.

### 8.8 Validation

- `E_SCENE_UNKNOWN` — instance references a non-existent scene id
- `E_SCENE_PARAM_MISSING` — required param not provided
- `E_SCENE_PARAM_TYPE`
- `E_SCENE_RECURSION` — a scene instances itself, directly or via a chain.
- `E_ASSET_CONFLICT` — same asset id, different src, across merge
- `E_SCENE_INSTANCE_DEEP_TARGET` — parent tween targets an item inside an
  instance (rejected, per §8.7)
- After expansion: existing rules apply, including tween overlap on the
  expanded targets (which catches scenes whose internal tweens collide
  after time-shift, though id namespacing makes this unlikely).

### 8.9 MCP tooling

```ts
define_scene({
  id: string,
  duration: number,
  params?: ParamDef[],
  size?: { width: number, height: number },
  background?: string
}) → { sceneId: string }

// Then use add_sprite/add_text/etc. with `sceneId` to populate.
// Or one-shot import:
import_scene_from_file({ path: string }) → { sceneId: string }

add_scene_instance({
  layerId: string,
  sceneId: string,
  params?: Record<string, unknown>,
  start?: number,         // parent time
  transform?: Partial<Transform>,
  id?: string,
  compositionId?: string
}) → { instanceId: string }

update_scene_instance({
  instanceId: string,
  params?: Record<string, unknown>,
  transform?: Partial<Transform>,
  start?: number
}) → { ok: true }

list_scenes({ compositionId?: string }) → { scenes: SceneSummary[] }

remove_scene({ sceneId: string, cascade?: boolean }) → { ok: true }
```

Sufficient for an agent to compose long videos by sequencing scenes,
without ever touching individual tweens at the section level.

---

## 9. Primitive 5 — Instance overrides (variant control)

Already partially covered: scene instances accept `params` (§8.3) which
parameterize the scene definition. This section is the *contract* for how
overrides flow.

### 9.1 What can vary per instance
- **Params** — declared by the scene; substituted into items/tweens.
- **Root transform** — instance.transform sits on the synthetic group
  wrapper. Animations on it cross-fade / move / scale the whole scene.
- **Start time** — `instance.start` shifts the whole scene timeline.
- **Layer assignment** — instance is an item; it goes in some layer.

### 9.2 What cannot vary per instance (in v0.4)
- Internal item structure (no "remove this item from the instance")
- Internal motion (no "swap easing for this internal tween")
- Internal asset choice unless the scene exposes it as a param

If the user needs more flexibility, they author a *different* scene. This
is the same trade-off React Components make: one scene = one motion
template, params parameterize it.

### 9.3 Override semantics for params

- Scalar params: replace
- Array params: replace (no merging)
- Object params: shallow merge with the scene's `default` object, then
  param substitution operates on the merged result

Stick to **replace** for v0.4. Merging gets surprising fast.

---

## 10. Compilation pipeline

```
authoredJSON (any Composition v0.2 file, possibly with $ref / behaviors / templates / scenes)
    │
    ▼
┌───────────────────────────────────────────────┐
│ 1. resolveImports                             │  $ref → inlined values
│    cycles → E_REF_CYCLE                        │
└───────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────┐
│ 2. expandTemplates                            │  $template instances → items + tweens
│    param substitution + id rewriting           │
└───────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────┐
│ 3. expandSceneInstances                       │  scene-typed items → group + namespaced
│    item id prefixing, time shifting,           │  inner items + shifted tweens
│    asset merging                               │
└───────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────┐
│ 4. expandBehaviors                            │  $behavior tweens → individual tweens
└───────────────────────────────────────────────┘
    │
    ▼
canonical Composition v0.1 JSON
    │
    ▼
┌───────────────────────────────────────────────┐
│ 5. validate (existing §3.5 rules unchanged)   │
└───────────────────────────────────────────────┘
    │
    ▼
engine (renderFrame, computeStateAt — unchanged)
```

### 10.1 Source maps

Each transform records what it produced and where it came from:

```ts
type SourceMap = {
  // For each compiled item, where in the source tree it came from
  items: Map<string /* compiled id */, ItemSource>;
  tweens: Map<string /* compiled id */, TweenSource>;
};

type ItemSource =
  | { kind: "literal"; file: string; jsonPointer: string }
  | { kind: "template"; instance: string; templateId: string; localId: string; file: string }
  | { kind: "scene-instance"; instance: string; sceneId: string; localId: string; file: string };
```

The compiler attaches a `__sourceMap` extension to its output (or returns
it separately to keep canonical JSON pure — recommended). The visual editor
uses it to "open in source" when the user clicks a node.

### 10.2 Determinism

The compiler must be a pure function of the authored input. Practically:
- Iterate `Object.entries` after `Object.keys(...).sort()` everywhere.
- Generate ids via deterministic concatenation, never via counters that
  depend on traversal order.
- Cache `$ref` results with normalized absolute paths to prevent path
  variation from yielding different content.

### 10.3 Where compilation runs

- **CLI** — `motionforge compile authored.json --out canonical.json` for
  one-shot generation (great for git diffs of "what does this expand to?").
- **Server driver** — auto-runs before `renderToFile`.
- **Browser driver** — auto-runs before `attach`.
- **MCP server** — keeps both forms in the store; agents can read either
  via `get_composition({ form: "authored" | "canonical" })`.
- **Tests** — golden tests of authored → canonical for each primitive.

---

## 11. Backward compatibility

| File | v0.1 | v0.2+ |
|---|---|---|
| `version` | `"0.1"` | `"0.2"` |
| `composition` | required | required, unchanged |
| `assets` | required | required (may also receive merged assets from scenes) |
| `layers` | required | required |
| `items` | required | required (gains `"scene"` type) |
| `tweens` | required | required (entries may be `$behavior` blocks) |
| `imports` | — | optional, array of strings or `$ref` |
| `scenes` | — | optional, scene definitions |
| `templates` | — | optional, template definitions |
| `behaviors` | — | optional, user-defined behavior definitions |

Every v0.1 file is a valid v0.2 file with no changes. The compiler short-
circuits if no v0.2 keys are present.

The canonical post-compile output is **always v0.1 shape**. The validator
need not learn anything new at the canonical layer.

---

## 12. Cross-clip libraries — reuse across projects

This is the most-asked follow-up question, so it gets its own section
even though architecturally it's a natural consequence of §5–9 rather
than a new primitive. The TL;DR: **a library is a JSON fragment with
`behaviors`, `templates`, and/or `scenes` keys, that any composition can
import.** Same mechanism as splitting one clip across files (§5).

### 12.1 The mental model

A **library** is a file (or a directory containing one entry-point file)
that exports any combination of `behaviors`, `templates`, `scenes`, plus
optional `assets` those definitions depend on. It has no `composition` /
`layers` / `items` block of its own — a library is *not* a renderable
composition, it's a bag of reusable definitions.

```json
// ~/motionforge/libs/narcis-brand-pack/library.json
{
  "kind": "library",
  "id": "@narcis/brand-pack",
  "version": "1.2.0",
  "assets": [
    { "id": "brand-display", "type": "font", "src": "./assets/Inter-Bold.ttf", "family": "Inter" },
    { "id": "brand-mono",    "type": "font", "src": "./assets/JetBrains.ttf",  "family": "JetBrainsMono" }
  ],
  "behaviors": {
    "brandSnap":   { "params": [...], "tweens": [...] },
    "brandFadeIn": { "params": [...], "tweens": [...] }
  },
  "templates": {
    "brandTitleCard":  { "params": [...], "items": {...}, "tweens": [...] },
    "brandLowerThird": { "params": [...], "items": {...}, "tweens": [...] }
  },
  "scenes": {
    "brandIntro": { "duration": 4, "items": {...}, "tweens": [...] },
    "brandOutro": { "duration": 3, "items": {...}, "tweens": [...] }
  }
}
```

The compiler treats this identically to inline definitions in a
composition's own `behaviors`/`templates`/`scenes`. The only differences
are *physical location* and *resolution rules* (§12.2–12.3).

### 12.2 Importing a library

Two forms — pick one per import:

```json
{
  "imports": [
    "./scenes/local-section.json",                                  // bare path: compose-fragment import (§5)
    { "library": "~/motionforge/libs/narcis-brand-pack" },          // library import (this section)
    { "library": "../shared/transitions", "as": "tr" },             // aliased library import
    { "library": "@motionforge/effects-classic", "version": "^1.0" } // future: registry-resolved
  ]
}
```

Resolution order:
1. Bare strings → fragment imports per §5 (same file gets inlined).
2. `{ library }` objects → library imports. Path resolves like Node's
   `require.resolve`: absolute, `~/`-relative, file-relative, or
   eventually package-name-relative (registry, see §12.8).
3. Each library's `behaviors` / `templates` / `scenes` / `assets` are
   merged into the composition's compile-time registry.

### 12.3 Naming and namespacing

When two imported libraries both define `popIn`, what wins?

**Default: hard error** (`E_LIBRARY_NAME_COLLISION`). The author must
disambiguate via aliasing:

```json
{
  "imports": [
    { "library": "@motionforge/classic",   "as": "classic" },
    { "library": "@narcis/brand-pack",     "as": "brand" }
  ],
  "tweens": [
    { "$behavior": "classic::popIn",  "target": "title", "start": 0, "duration": 1 },
    { "$behavior": "brand::popIn",    "target": "logo",  "start": 0, "duration": 1 },
    { "$behavior": "fadeIn",          "target": "subtitle", "start": 0, "duration": 1 }  // built-in, no prefix needed
  ]
}
```

Rules:
- **Aliased imports** (`as: "X"`) put their exports under the `X::`
  namespace. Unprefixed names from that library are *not* available.
- **Unaliased imports** put exports into the global namespace. Two
  unaliased libraries with overlapping names → `E_LIBRARY_NAME_COLLISION`.
- **Built-in behaviors / templates** always win unprefixed unless an
  imported library explicitly opts to shadow with `force: true` in its
  definition (rare).
- A user can always force the built-in via `core::popIn`. The `core::`
  alias is reserved.

### 12.4 Asset paths inside libraries

Library JSON files may declare assets with paths relative to the
library file itself:

```
~/motionforge/libs/narcis-brand-pack/
  library.json
  assets/
    Inter-Bold.ttf
    JetBrains.ttf
    logo.png
```

At compile time, the compiler rewrites those asset `src` paths to
absolute paths so the engine receives a flat composition with no
library-relative path semantics. Asset ids from the library are merged
into the composition's `assets` array; collisions on `id` with
**different** `src` (after normalization) → `E_ASSET_CONFLICT`. Same id
+ same content (path or hash) is fine and dedupes.

### 12.5 Library composition (transitive imports)

A library may itself import other libraries. The compiler resolves
transitively, with cycle detection:

```json
// ~/motionforge/libs/brand-bundle/library.json
{
  "kind": "library",
  "id": "@narcis/brand-bundle",
  "imports": [
    { "library": "@narcis/brand-pack" },
    { "library": "@motionforge/effects-classic", "as": "classic" }
  ],
  "scenes": {
    "fullSection": {
      "items": {
        "title": { "$template": "brandTitleCard", "params": {...} },
        "wipe":  { "$template": "classic::wipeLeft" }
      },
      "tweens": [...]
    }
  }
}
```

Cycle → `E_LIBRARY_CYCLE`. Aliasing is local to the importing file: if
`brand-bundle` aliases `effects-classic` as `classic`, downstream
consumers of `brand-bundle` don't inherit that alias — they import
`effects-classic` themselves if they want it directly.

### 12.6 Determinism across machines

This is the only place library support touches the determinism
guarantee. File paths in `imports` are environment-dependent. To
preserve "same source → same pixels" across machines:

**Phase A (v0.3-v0.4) — bring-your-own-pinning.** Authors commit
libraries into their project (or use a vendored `libs/` folder).
Absolute `~/`-paths are discouraged for shared projects.

**Phase B (v0.5+) — lock file.** A `motionforge.lock.json` records the
content hash of every resolved library file. The compiler refuses to
proceed if a library's resolved content doesn't match the lock. Authors
update locks intentionally with `motionforge update`.

```json
// motionforge.lock.json
{
  "libraries": {
    "@narcis/brand-pack@1.2.0": {
      "resolved": "/Users/narcis/motionforge/libs/narcis-brand-pack/library.json",
      "contentHash": "sha256:a3b1...",
      "files": {
        "library.json":            "sha256:a3b1...",
        "assets/Inter-Bold.ttf":   "sha256:c9e2...",
        "assets/JetBrains.ttf":    "sha256:f12a..."
      }
    }
  }
}
```

The lock file makes library-using compositions reproducible — a CI
machine, a teammate's laptop, and a six-months-from-now you all produce
byte-identical canonical JSON given the same source + lock.

### 12.7 Versioning

Library declares its `version` (semver). Importer can pin via
`{ library: "...", version: "^1.0" }`. For v0.3-v0.4: version field is
*advisory only* — used in error messages and lock keys, not enforced.
For v0.5+, formal version resolution (with a registry) becomes possible.

Breaking-change discipline:
- **Patch** — bug fix in a behavior's expansion that produces visually
  identical output (e.g., id rename).
- **Minor** — new behaviors/templates/scenes, new optional params with
  defaults.
- **Major** — changed default values, removed exports, changed param
  shapes, motion changes that visibly differ.

Older clips depending on `^1.0` keep working; major bumps require
opt-in.

### 12.8 Distribution

Three tiers, in order of "cost to ship":

1. **Local files / git submodules** — works today with v0.2 once
   `imports` accepts library objects. Zero infrastructure.
2. **Git URL imports** — `{ library: "git+https://github.com/foo/bar#v1.2.0" }`.
   The compiler clones to a cache dir on first resolve.
3. **A registry** — `motionforge` CLI subcommand `motionforge add @org/pack`
   pulls from a curated index (npm registry with `motionforge-library`
   keyword is the cheapest implementation). Adds the import + updates
   the lock.

Recommendation: ship tier 1 with v0.3, tier 2 (cache + git URLs) with
v0.5, tier 3 only if there's pull from real users.

### 12.9 MCP tooling

```ts
import_library({
  library: string,             // path or registry-style id
  as?: string,                 // alias namespace
  version?: string,            // semver pin (advisory in v0.3)
  compositionId?: string
}) → { libraryId: string, exports: { behaviors: string[], templates: string[], scenes: string[], assets: string[] } }

list_libraries({ compositionId?: string }) → {
  libraries: Array<{ id: string, version: string, alias?: string, exports: {...} }>
}

list_library_contents({ libraryId: string }) → {
  behaviors: BehaviorDescriptor[],
  templates: TemplateDescriptor[],
  scenes: SceneSummary[]
}

remove_library_import({ libraryId: string, compositionId?: string }) → { ok: true }
```

Discovery flow for an agent:
1. `list_libraries` to see what's already imported.
2. `list_library_contents` on each to find a behavior / template / scene
   matching the user's intent.
3. `apply_behavior` / `apply_template` / `add_scene_instance` with the
   namespaced name.

### 12.10 Recommended folder layout

For users actively building a library workflow:

```
~/motionforge/
  libs/
    narcis-brand-pack/
      library.json
      assets/
        Inter-Bold.ttf
        logo.png
      README.md
    transitions-classic/
      library.json
    lower-thirds-pack/
      library.json
  projects/
    product-launch-2026/
      composition.json
      scenes/
      motionforge.lock.json
    conference-talk/
      composition.json
      ...
```

Libraries live outside any one project. Projects pin them via the lock
file. Authors can develop a library in-place (relative `imports`) and
"publish" later just by moving the directory and adjusting paths.

### 12.11 Phasing for library support

| Capability | Ships with |
|---|---|
| `imports` accepts `{ library: path }` objects | v0.3 (with templates) |
| Aliasing (`as`) and `lib::name` syntax | v0.3 |
| Asset path rewriting from libraries | v0.3 |
| Built-in `core::` alias reserved | v0.3 |
| Transitive library imports + cycle detection | v0.4 |
| Lock file (`motionforge.lock.json`) | v0.5 |
| Git-URL library imports | v0.5 |
| Registry / CLI `motionforge add` | post-v1.0, demand-driven |

The cheap-and-essential parts (file imports, aliasing, asset rewriting)
land alongside templates. Determinism-grade pinning (lock file) waits
until libraries are actually shared between people, since it has real
implementation cost.

### 12.12 Why not "just npm packages"?

Tempting — npm already solves distribution, versioning, locking. But:
- A `motionforge-library` is *data*, not code. Half of npm's machinery
  (transitive code-level deps, `node_modules` flattening,
  `package-lock.json` inside `node_modules`) is overhead with no value.
- We want libraries usable from a browser-only context too (visual
  editor in v1.0). That means `fetch`-able, not `require`-able.
- The lock-file approach in §12.6 is content-addressed, which is
  stronger than npm's tag-based pinning anyway.

So: **leverage npm as transport** (you can `npm install
@motionforge/effects-classic` and the package's `library.json` lives at
its root), but **don't build on npm semantics**. The compiler resolves
library JSON files; npm is just one of several ways to get them onto
disk.

---

## 13. Implementation phases

### v0.2 — File splitting + behaviors (~1.5 weeks)
- `$ref` import resolver with cycle detection, JSON pointer support
- 8-10 built-in behaviors (the table in §6.3)
- Compiler skeleton (`src/compose/`): `resolveImports`, `expandBehaviors`
- Pre-compile auto-runs in browser/node drivers
- New MCP tools: `apply_behavior`, `list_behaviors`
- Test: rewrite `examples/comprehensive-composition.json` into 6 split
  files using `$ref` + behaviors. Assert byte-for-byte canonical output
  matches the original.

### v0.3 — Templates (~1 week)
- `$template` expansion with param substitution
- 3-5 built-in templates (titleCard, lowerThird, captionBurst,
  bulletList, kenburnsImage)
- User template registration
- New MCP tools: `apply_template`, `list_templates`,
  `define_user_template`
- Test: ship a 30-second demo built from 2 templates and prove the source
  is <100 lines.

### v0.4 — Scenes (~2 weeks)
- Scene definitions
- `"scene"` item type
- Scene instances with sealed-internal-tweens rule
- Asset merging with conflict detection
- Source maps end-to-end
- New MCP tools: `define_scene`, `add_scene_instance`, `import_scene`,
  `list_scenes`, `update_scene_instance`, `remove_scene`
- Test: build a 1-minute clip from 4 scenes (intro / 2 sections / outro).
- Test: mid-instance scene-internal tween + parent transform.opacity tween
  multiply correctly (golden frame).

### v0.5 — Time mapping (~1 week, optional)
- `clip`, `loop`, `timeScale` for scene instances
- Validator updates for overlap rules under non-identity time

### v1.0 — Visual editor (separate stream)
- Operates on the v0.4 source format
- Per-scene tab UI
- Library panel (templates / scenes / behaviors)
- Override inspector
- Source-map-driven "Reveal in source" for any compiled element

### What we don't ship
- Computed expressions in param substitution (`${params.x + 80}`).
  Defer until users complain.
- User-defined scenes via fluent JS API. Scenes are JSON files.
- Multi-tenant scene libraries / DAM. Local files only for v1.0.

---

## 14. Worked example — comprehensive-composition refactor

### Today (v0.1, 1330 lines, 1 file)

See `examples/comprehensive-composition.json`.

### After v0.2 (`$ref` + behaviors)

```
examples/comprehensive/
  comprehensive.json                    ← root, ~80 lines
  meta/
    composition.json                    ← width/height/fps/duration/bg
    assets.json                         ← 3 asset entries
    layers.json                         ← 7 layer definitions
  acts/
    act-1-title.json                    ← 200 lines (title + subtitle + card)
    act-2-shapes.json                   ← 180 lines (circle, triangle, star)
    act-3-ball-bounce.json              ← 200 lines (ball + bounce sequence)
    act-4-orbit.json                    ← 180 lines (orbit group + spin)
    act-5-glow.json                     ← 100 lines
    act-6-outro.json                    ← 90 lines
```

`comprehensive.json`:
```json
{
  "version": "0.2",
  "composition": { "$ref": "./meta/composition.json" },
  "assets":      { "$ref": "./meta/assets.json" },
  "layers":      { "$ref": "./meta/layers.json" },
  "items":       { "$ref": "./acts/all-items.json" },
  "tweens": [
    { "$ref": "./acts/act-1-title.json#/tweens" },
    { "$ref": "./acts/act-2-shapes.json#/tweens" },
    { "$ref": "./acts/act-3-ball-bounce.json#/tweens" },
    { "$ref": "./acts/act-4-orbit.json#/tweens" },
    { "$ref": "./acts/act-5-glow.json#/tweens" },
    { "$ref": "./acts/act-6-outro.json#/tweens" }
  ]
}
```

Tween count drops from 93 to ~50 (behaviors fold the popIn / fadeIn /
fadeOut / colorCycle bundles). Total LoC across files: ~750-900, but every
file is human-scale and the root reads top-to-bottom as a table of
contents.

### After v0.4 (scenes)

```
examples/comprehensive/
  comprehensive.json                    ← ~50 lines
  scenes/
    title-card.json                     ← reusable
    shapes-showcase.json
    ball-bounce.json                    ← reusable
    orbit-spin.json
    glow-flash.json
    outro-card.json                     ← reusable
```

`comprehensive.json`:
```json
{
  "version": "0.2",
  "composition": { "width": 1280, "height": 720, "fps": 60, "duration": 20, "background": "#000000" },
  "imports": [
    "./scenes/title-card.json",
    "./scenes/shapes-showcase.json",
    "./scenes/ball-bounce.json",
    "./scenes/orbit-spin.json",
    "./scenes/glow-flash.json",
    "./scenes/outro-card.json"
  ],
  "items": {
    "act1": { "type": "scene", "scene": "titleCard",      "params": { "title": "MotionForge", "subtitle": "Comprehensive Feature Demo" }, "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 1 } },
    "act2": { "type": "scene", "scene": "shapesShowcase", "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 1 } },
    "act3": { "type": "scene", "scene": "ballBounce",     "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 1 } },
    "act4": { "type": "scene", "scene": "orbitSpin",      "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 1 } },
    "act5": { "type": "scene", "scene": "glowFlash",      "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 1 } },
    "act6": { "type": "scene", "scene": "outroCard",      "params": { "footer": "20s · 1280x720 · 60fps" }, "transform": { "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0, "anchorY": 0, "opacity": 1 } }
  },
  "layers": [
    { "id": "main", "z": 0, "opacity": 1, "blendMode": "normal", "items": ["act1","act2","act3","act4","act5","act6"] }
  ],
  "tweens": [
    { "target": "act1", "property": "transform.opacity", "from": 0, "to": 1, "start": 0,    "duration": 0.4 },
    { "target": "act1", "property": "transform.opacity", "from": 1, "to": 0, "start": 3.6,  "duration": 0.4 },
    { "target": "act2", "property": "transform.opacity", "from": 0, "to": 1, "start": 4,    "duration": 0.4 },
    { "target": "act2", "property": "transform.opacity", "from": 1, "to": 0, "start": 7.6,  "duration": 0.4 },
    { "target": "act3", "property": "transform.opacity", "from": 0, "to": 1, "start": 8,    "duration": 0.4 },
    { "target": "act3", "property": "transform.opacity", "from": 1, "to": 0, "start": 11.6, "duration": 0.4 },
    { "target": "act4", "property": "transform.opacity", "from": 0, "to": 1, "start": 12,   "duration": 0.4 },
    { "target": "act4", "property": "transform.opacity", "from": 1, "to": 0, "start": 15.6, "duration": 0.4 },
    { "target": "act5", "property": "transform.opacity", "from": 0, "to": 1, "start": 13,   "duration": 0.4 },
    { "target": "act5", "property": "transform.opacity", "from": 1, "to": 0, "start": 16,   "duration": 0.4 },
    { "target": "act6", "property": "transform.opacity", "from": 0, "to": 1, "start": 17.6, "duration": 0.4 }
  ]
}
```

The root file is now the **whole video at a glance**. Each scene file
covers its own ~150-250 lines independently. `titleCard` and `outroCard`
become reusable across other videos.

### After v1.0 (visual editor)

The same files, opened in a tab-per-scene UI. Drag the timeline strip in
`comprehensive.json` to rearrange acts. Open `titleCard.json` in another
tab to tweak its internals. The editor is just a different lens over the
same v0.2 source.

---

## 15. AI agent angle

A 1330-line composition is comfortable for an LLM today (context-wise) but
the **per-tool-call** cost is real: 93 `add_tween` calls is 93 round trips.

| Today | After v0.2 | After v0.3 | After v0.4 |
|---|---|---|---|
| ~93 `add_tween` | ~50 `add_tween` + ~10 `apply_behavior` | ~20 `add_tween` + ~5 `apply_template` | ~10 `add_scene_instance` + parent tweens |

That's a **10× reduction in tool calls** for the comprehensive demo, with
no loss of expressive power. Agents using MCP get faster and cheaper as a
side effect.

The agent also gets richer **discovery**:
- `list_behaviors` — what motion macros exist
- `list_templates` — what reusable bundles exist
- `list_scenes` — what sub-compositions exist in this project

Agents can ship a video as "intro card with these params + 3 sections + outro"
and never write a single tween if the scene library covers the shapes.

---

## 16. Open questions

| # | Question | My current lean |
|---|---|---|
| O1 | Should expressions (`${params.x + 80}`) be supported in param substitution? | **No, defer.** Compute in caller. Revisit if usage demands it. |
| O2 | Should scenes have their own `assets` registry, merged into root, or always go through root? | **Per-scene assets, merged at compile.** Conflict on id with different src is an error. Same id + same src is fine. |
| O3 | Should parent tweens be allowed to target items inside a scene instance? | **No.** Sealed instances. Use params for variation. |
| O4 | Scene `background` — paint inside or expose as param? | **Paint inside, behind scene content. Default `transparent`.** |
| O5 | Should `compose` produce a separate canonical file on disk, or stream in-memory? | **In-memory by default.** Optional `--emit-compiled` flag for debugging. |
| O6 | Should the engine learn the v0.2 schema, or always require pre-compile? | **Always require pre-compile.** Engine stays minimal. The driver / MCP server runs `compose` automatically. |
| O7 | Multiple roots / playlists (one project, multiple deliverables)? | **Defer to a `projects.json` concept later.** v0.4 = one root. |
| O8 | How does the visual editor edit the *expanded* form? It can't — it must edit source. What if the agent edits the expanded form? | **Both forms exist in MCP store. Agent's edits to expanded form propagate as overrides on the closest scene-instance / template-instance via reverse-source-map lookup. Best-effort, may downgrade to "flatten and edit" if the edit doesn't fit a known instance.** This is hard. Probably v1.1 territory. |
| O9 | Should we version-stamp behaviors and templates? | **Yes — name@version once we have user-defined ones.** Built-ins are tied to the engine version. |
| O10 | What about *seeding* (random offsets in `shake` / `jitter`)? | **Behaviors take a `seed: number` param; shake expansion is a deterministic pseudo-random based on it.** Aligns with design-doc Q10 (PRNG). |
| O11 | Tween ID collisions across split files via `$ref` spread mode? | **Pre-expansion validation: every authored tween id must be globally unique across all spread `$ref`s.** |
| O12 | Should we support a `delay` field on behaviors so authors don't hand-compute `start`? | **Yes — `delay` is sugar for "start = previous behavior's end + delay". But scope-bound, only relative to siblings in the same item.** Useful for staggered reveals. |
| O13 | Should libraries declare a `peerDependencies` style "this library expects these built-ins to behave a certain way" contract? | **Defer.** Pin to engine version via lock. Real cross-lib coupling is rare in practice for video assets. |
| O14 | When two libraries are both aliased and a tween references the same behavior name unprefixed, do we error or pick built-in? | **Error.** Aliased imports never expose unprefixed names. Built-in only resolves bare. Anything ambiguous is `E_AMBIGUOUS_NAME`. |
| O15 | Should a library be able to depend on a *specific composition* (e.g. it animates assets that exist in only one project)? | **No.** Libraries are reusable by definition. If a behavior depends on a specific item id, it should take that id as a `target` parameter. |
| O16 | How should we ship the engine's own built-in behaviors / templates — as code, as JSON, or as a built-in library? | **Hybrid.** Behavior expansion is code (TS) for performance + type safety. Templates are JSON living in `src/compose/built-in/templates/` and loaded at compile time. The visual editor in v1.0 reads templates as JSON; behaviors expose a metadata file describing their params. |

---

## 17. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Compiler has a determinism bug (different output on different machines) | Medium | Snapshot tests of compiled JSON across CI runs and platforms. Sorted iteration policy. |
| Source maps go stale or are wrong | Medium | Visual editor surfaces "source map missing" warnings. Tests assert source maps for all built-in templates. |
| Scenes encourage too-deep nesting → confusing | Low | No engine limit, but lint at compile: warn at depth > 4. |
| Asset id collisions across many scenes | Medium | Strict conflict error. Encourage namespacing in scene authoring (e.g. `intro::font-display`). |
| Param substitution is a string find-and-replace and breaks on unusual content | Low | Substitute only on values that match `^${(params|$)..*}$` exactly — no partial substitution into longer strings unless `format: "string-template"`. |
| Tween overlap rules behave surprisingly after time-shifts | Medium | Compile, then run existing validator. Errors point at *original* tween id via source map. |
| Agents cannot edit the expanded form anymore (lose granular control) | Low | Both forms remain available. Agents can keep using flat-JSON tools indefinitely. |
| Performance regression on compile of large projects | Low | Compile is O(n) over authored size; runs once per render. Cache between renders if input unchanged. |
| Scope creep: feature requests for variable fonts, conditionals, loops in templates | High | Strict moratorium until v0.5. New primitives go through this same kind of doc. |
| Library `imports` resolve differently across machines (broken determinism) | High **before** lock file; Low **after** | Ship lock file (§12.6) before encouraging cross-team library use. Until then, vendor libraries into the project repo. |
| Library author makes a "cosmetic" change that's actually visually different (motion drift) | Medium | Snapshot-test libraries against their own example clip. Encourage `version` discipline (§12.7). The lock file's content hash catches *any* change, intentional or not, so reproducibility is preserved even when discipline isn't. |
| Library asset bloat — every clip pulls in fonts/images it doesn't use | Medium | Tree-shake at compile: only assets transitively referenced by used items / templates / scenes get merged. Unused library assets stay on disk but never enter the canonical output. |

---

## 18. Glossary

- **Authored JSON** — source format containing v0.2 primitives.
- **Canonical JSON** — flat v0.1-shape JSON the engine consumes.
- **Compile** — pure function: authored → canonical.
- **Behavior** — a named, parameterized tween bundle (motion macro).
- **Template** — a named, parameterized item+tween bundle.
- **Scene** — a self-contained authored unit with own duration, items, tweens, params.
- **Scene instance** — a placement of a scene in a parent timeline, with params and root transform.
- **Sealed instance** — parent cannot tween scene-internal items.
- **Source map** — table mapping compiled item/tween ids back to authored locations.
- **Identity time** — scene plays 1:1 in parent time, no scaling/looping.
- **Library** — JSON file (or directory containing one) exporting reusable `behaviors` / `templates` / `scenes` / `assets` for use across multiple compositions. Has no `composition` block of its own.
- **Library import** — entry in a composition's `imports` array referencing a library by path, optionally aliased.
- **Namespace alias** — local short name (`as: "brand"`) under which a library's exports are addressed (`brand::popIn`).
- **Lock file** — `motionforge.lock.json` recording the content hash of every resolved library and asset, ensuring same-source-different-machine determinism.
- **Tree-shaking (compile-time)** — dropping library assets/definitions that no `items` / `tweens` actually reference, before producing the canonical JSON.

---

## 19. What to do next (concrete next steps)

When the team picks this up:

1. **Pick what to ship first.** Recommendation: v0.2 (file splits + behaviors). Cheapest, highest immediate value.
2. **Add `src/compose/`** — a new module with `resolveImports`, `expandBehaviors`, etc. Each pure function with golden tests.
3. **Update `IMPLEMENTATION_PLAN.md`** with v0.2 phase breakdown matching §12 above.
4. **Update `design-doc.md` §3** — add v0.2 schema additions inline (per the convention in §9 of the design doc: changes go in design-doc *first*).
5. **Build the rewrite of `comprehensive-composition.json`** as an end-to-end test: 6 split files + behaviors → byte-identical canonical output. If determinism breaks, ship-blocker.
6. **Write the MCP tool tests** for `apply_behavior` and `list_behaviors` first (the smallest new tool surface).
7. **Decide on §16-O1** (expression evaluator). If "no," lock it in. If "yes," budget for it and pick a syntax (probably `expr-eval` or a tiny custom parser; AVOID full JS sandbox).

Reading order for someone new picking this up cold:
- `design-doc.md` §1-§5 (existing) — what the engine is
- This document §1-§4 — what's wrong with monolithic JSON
- This document §10 (compilation pipeline) — the architectural shape
- This document §12 (libraries) and §14 (worked example) — what files actually look like

---

## 20. Appendix — sketch of the compiler module structure

```
src/compose/
  index.ts                  // compile(authoredJSON, opts) → { canonical, sourceMap, warnings }
  imports.ts                // resolveImports — $ref handling, JSON Pointer, cycle detection
  behaviors.ts              // expandBehaviors + the built-in registry
  templates.ts              // expandTemplates + built-in registry
  scenes.ts                 // expandSceneInstances — the bulk of v0.4
  params.ts                 // shared param-substitution engine for templates and scenes
  ids.ts                    // deterministic id derivation
  source-map.ts             // SourceMap type and helpers
  errors.ts                 // E_REF_*, E_BEHAVIOR_*, E_TEMPLATE_*, E_SCENE_*

src/compose/built-in/
  behaviors/
    fadeIn.ts
    fadeOut.ts
    popIn.ts
    popOut.ts
    slideIn.ts
    slideOut.ts
    rotateSpin.ts
    kenburns.ts
    shake.ts
    colorCycle.ts
    pulse.ts
  templates/
    titleCard.ts
    lowerThird.ts
    captionBurst.ts
    bulletList.ts
    kenburnsImage.ts
```

Each built-in is a `{ name, params, expand(args, target, start, duration) }`
object. The registry is a flat `Map<string, BuiltIn>`. v0.3 adds a
parallel `userBehaviors` / `userTemplates` map populated from the
authored JSON's `behaviors` / `templates` keys.

The compiler ordering in §10 (imports → templates → scenes → behaviors)
matters. Templates can contain `$behavior` calls (must run after
templates). Scenes can contain templates and behaviors (must run after).
Imports come first because everything else operates on the inlined tree.

---

*End of proposal.*
