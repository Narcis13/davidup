# `$repeat` + bounded param expressions

**Status:** design only — v1.1 candidate (`DAVIDUP_V1_REVIEW.md` §6 item 23,
`v1_implementation_plan.md` Session 30). **No schema or compose code changes
land with this document.**

**Companion doc:** `TEXT_V2_DESIGN.md` (§6 item 22). Independent features;
text reveal deliberately does not build on `$repeat`.

---

## 1. Problem

Three compounding gaps, all rooted in the same missing capability
(evaluating a tiny amount of arithmetic inside authored JSON):

1. **Agents hand-unroll repetition.** Five staggered bullets = 5 `add_text`
   + 5 `apply_behavior` calls with hand-computed starts (`0.2, 0.32,
   0.44, …`). The review's live drives show this is where agents burn tokens
   *and* make the arithmetic mistakes that produce broken timings. One
   repeated structure should be one authored node / one tool call.
2. **Placeholders can't compute.** `src/compose/params.ts` substitutes
   whole-string `${params.X}` / `${$.X}` literally — no arithmetic
   (COMPOSITION_PRIMITIVES.md §7.4, deferred per §16-O1). The built-in
   `bulletList` template is the fossil record: it is *fixed at three
   bullets* and ships a `stagger2` param documented as "compute as
   2\*stagger — placeholders don't do arithmetic in v0.3"
   (`src/compose/builtInTemplates.ts:328-440`).
3. **User-defined behaviors are stubs.** §6.6 already specs a registration
   shape whose tween list uses `"${params.amount}"` and `"${$.start + 0.2}"`
   — but without an evaluator it can't be expanded, so
   `define_user_behavior` is descriptor-only and `apply_behavior` throws
   `E_BEHAVIOR_UNKNOWN` for user names (`src/compose/behaviors.ts:179-185`,
   `src/mcp/store.ts:431-435`, `src/mcp/tools.ts:1446-1485`).

This design resolves §16-O1 from "no, defer" to **"yes, bounded"** — the
open question explicitly reserved the right to revisit "if usage demands
it", and item 23 is that demand.

## 2. Goals / non-goals

**Goals**

- G1: A bounded, deterministic, non-Turing expression grammar inside the
  existing `${…}` placeholder syntax — arithmetic over params and context,
  nothing else.
- G2: `{"$repeat": {count, stagger, item}}` — declarative repetition of
  items and tweens, expanded at compile time, source-mapped.
- G3: User-defined behaviors become executable (§6.6 shape), retiring the
  descriptor-only stub.
- G4: MCP ergonomics that collapse the N-call cliff: `add_tween` gains a
  `repeat` block; `apply_behavior` works for user behaviors.
- G5: Backward compatibility: every currently-valid composition compiles to
  byte-identical canonical output.

**Non-goals**

- No JS sandbox, no function calls (v1), no string manipulation beyond
  interpolation, no conditionals/comparisons, no user variables, no loops
  other than `$repeat`, no randomness (seeding stays §16-O10 territory).

## 3. Expression language

### 3.1 Grammar

Placeholders keep the exact same outer syntax `${…}`; what changes is that
the *interior* is parsed as an expression instead of matched against a
fixed reference regex.

```
expr    := term  (('+' | '-') term)*
term    := factor (('*' | '/' | '%') factor)*
factor  := NUMBER | ref | '(' expr ')' | '-' factor
ref     := ('params' | '$') '.' IDENT ('.' IDENT)*
NUMBER  := JSON-number syntax
IDENT   := [A-Za-z_$][A-Za-z0-9_$]*
```

Hand-rolled recursive-descent parser (~150 lines), zero dependencies —
per COMPOSITION_PRIMITIVES.md §19.7's own advice ("a tiny custom parser;
AVOID full JS sandbox"). No `eval`, no `Function`, no prototype access
(refs resolve via own-property lookup only, as `params.ts` already does
with `hasOwn`).

### 3.2 Typing rules

- **Bare-reference passthrough (compatibility rule):** an expression that
  is exactly one `ref` (`${params.color}`, `${$.start}`) returns the
  referenced value *unchanged, any JSON type* — precisely today's
  `PLACEHOLDER_RE` semantics. Existing templates/scenes compile
  byte-identically (G5).
- **Anything else is numeric:** every operand must be a finite number;
  the result must be finite. A string param in `${params.x + 1}`, a
  division by zero, or a NaN/Infinity result is an error — never a silent
  `NaN` propagating into a tween.
- Whole-string placeholders substitute to the raw result value (number
  stays a number); embedded placeholders (§3.4) stringify it.

### 3.3 Bounds (the "bounded" in the title)

| Limit | Value | Error |
|---|---|---|
| Expression source length | ≤ 256 chars | `E_EXPR_LIMIT` |
| Token count | ≤ 64 | `E_EXPR_LIMIT` |
| Paren/unary nesting depth | ≤ 16 | `E_EXPR_LIMIT` |
| Non-finite operand or result | — | `E_EXPR_TYPE` |
| Parse failure | — | `E_EXPR_PARSE` (with caret position) |
| Unknown ref | — | `E_TEMPLATE_PARAM_MISSING` (reused — same failure class agents already handle) |

New codes register in `src/engine/errors.ts`. Evaluation is O(tokens),
allocation-light, and trivially total — there is no way to express
recursion or iteration.

### 3.4 Embedded interpolation — scoped to `$repeat` bodies

The §17 risk table pins substitution to whole-string placeholders so
content strings ("cost is ${price}") can't be corrupted. That pin stays —
**except inside a `$repeat.item` subtree**, where repetition forces string
*construction* (ids, targets):

```json
"target": "bullet__${$.i}"
```

Inside a repeat body, any string containing a well-formed `${…}` is
segment-interpolated (each embedded expression evaluates, stringifies, and
splices). `$${` escapes a literal `${`. Everywhere else, the v0.3 rule is
unchanged: mid-string `${…}` passes through untouched.

Number-to-string formatting is locale-free and deterministic: integers as
integers, non-integers via the shortest-round-trip representation
(`String(n)` semantics, which node and browsers share for doubles).

## 4. `$repeat`

### 4.1 Shape

```jsonc
{ "$repeat": {
    "count": 5,            // int ≥ 0, or an expression: "${params.n}"
    "stagger": 0.12,       // seconds between iterations (default 0)
    "item": { ... }        // the repeated node (one item, or one tween /
                           // $behavior block, per position — §4.2)
}}
```

Inside `item`, the `$` namespace binds per iteration:

| Ref | Value |
|---|---|
| `$.i` | 0-based iteration index |
| `$.count` | total count |
| `$.stagger` | the stagger value |
| `$.offset` | `i · stagger`, precomputed (see §4.5) |

plus whatever `$` keys the enclosing context already provides (e.g.
`$.start` in behavior bodies per §6.6; template contexts expose their
instance start the same way, consistent with §7.6's time mapping).

### 4.2 Where it may appear

1. **As an entry in any `tweens` array** (root composition, template
   definition, scene definition). Expands to `count` copies of `item`
   (which may itself be a `$behavior` block — behaviors expand in a later
   pass, per the §10 ordering). Each copy's `start` is **automatically
   shifted by `$.offset`** — stagger-of-time is the whole point, so it is
   not opt-in arithmetic.
2. **As the value of an `items` record entry** (root, template, scene).
   The record key is the base id; iteration ids are `${baseId}__${i}`
   (zero-padded to the count's width, matching the behavior `pad()`
   convention). No automatic time shift (items have no `start`); `enter`/
   `exit`/anything else stagger via explicit expressions:
   `"enter": "${$.offset + 1.0}"`.

A `$repeat` directly inside another `$repeat` is allowed (grid layouts:
outer rows, inner columns; inner sees both indices via shadowing —
`$.i` is the innermost, `$.outer.i` is **not** provided in v1; nest via a
param-computed expression instead, recorded as open question Q3).

### 4.3 Expansion budget

- `count` must resolve (post-substitution) to an integer `0 ≤ n ≤ 500`,
  else `E_REPEAT_COUNT`. `count: 0` is legal and expands to nothing
  (parametric templates want this).
- Total nodes produced by all `$repeat`s in one compile ≤ 2000, else
  `E_REPEAT_BUDGET`. Keeps a typo (`count: 50000`) from OOMing the MCP
  server — same philosophy as the R-18 preview `count` cap.

### 4.4 Pipeline position

`$repeat` expansion is not a fifth standalone pass — it runs **wherever
substitution runs**, immediately after params bind, because `count` may be
`${params.n}`:

```
resolveImports
  → expandRepeats(root)          // root scope: no params; $ = {i,count,…} only
  → expandTemplates              // substitute() + repeat-expand per instance
  → expandSceneInstances         // ditto
  → expandBehaviors              // sees only literal tweens + $behavior blocks
```

Concretely: `substitute()` in `params.ts` grows a sibling
`expandRepeatsInTree(tree, ctx)` used by the root pass and by the
template/scene expanders right after their existing `substitute()` calls.
Ordering inside a repeat body: bind `$.i` etc. → substitute/interpolate →
recurse into nested repeats. `expandBehaviors` stays last and unchanged —
by the time it runs, repeats have already multiplied any `$behavior`
blocks into ordinary per-iteration blocks.

### 4.5 Determinism and the overlap validator

- Every iteration's `start` is computed as `base + i · stagger` (single
  multiply per iteration, never a chained sum) — the same
  fp-noise-avoidance rule as `segmentBreakpoints`
  (`src/compose/behaviors.ts:270-290`), so abutting staggered tweens
  bit-match and the epsilon-tolerant overlap check (R-25) sees exact
  arithmetic.
- Expansion is pure and order-stable; the determinism harness (Session 23)
  gets a golden with nested repeats + expressions.
- Post-expansion output is ordinary canonical JSON: `E_TWEEN_OVERLAP`,
  tweenable checks, lifespan lint — everything applies unchanged. If a
  repeat staggers same-target-same-property tweens with
  `stagger < duration`, the existing overlap error fires and the source
  map points at the authored `$repeat` node.

### 4.6 IDs and source map

- Tween-position iterations: explicit `"id": "intro_${$.i}"` via
  interpolation, else the derived-id rule applies per expanded entry
  (behaviors already derive `${target}_${behavior}_${start}` — unique
  because target or start varies per iteration; a repeat whose iterations
  derive identical ids is caught by the existing duplicate-id checks).
- Item-position iterations: `${baseId}__${i}` as §4.2.
- Source map: new `originKind: "repeat"` in the `OriginKind` union
  (`src/engine/types.ts:146-152`); all expanded entries map to the authored
  `$repeat` location via the same `__source` sidecar + prefix-matching
  machinery `precompile.ts` already uses for templates/behaviors. Editor
  "reveal in source" jumps to the repeat node.

## 5. User-defined behaviors become real

### 5.1 Registration (the §6.6 shape, verbatim)

`define_user_behavior` gains an optional `tweens` array; a definition that
has one is *executable*, not descriptor-only:

```jsonc
{
  "name": "myBoinge",
  "params": [ { "name": "amount", "type": "number", "default": 1.2 } ],
  "tweens": [
    { "property": "transform.scaleX", "from": 1, "to": "${params.amount}",
      "duration": 0.2, "easing": "easeOutBack", "suffix": "out" },
    { "property": "transform.scaleX", "from": "${params.amount}", "to": 1,
      "start": "${$.start + 0.2}", "duration": 0.2, "easing": "easeInQuad",
      "suffix": "in" }
  ]
}
```

### 5.2 Expansion semantics

Follows §6.6 exactly, with the gaps it left unspecified filled in:

- **Context (`$`)**: `$.start`, `$.duration`, `$.end` (= start+duration),
  `$.target` from the `BehaviorBlock`. Per §6.6, tween `start` values are
  **absolute** expressions (`${$.start + 0.2}`); an omitted `start`
  defaults to `$.start`. (A relative-time alternative was considered and
  rejected for v1: it would silently diverge from the published spec that
  library authors may already be writing against.)
- **Params**: validated against the descriptors before expansion —
  required/typed/defaulted via the existing `E_BEHAVIOR_PARAM_MISSING` /
  `E_BEHAVIOR_PARAM_TYPE` paths. `default` values participate in
  expressions like any literal.
- **`target`** defaults to the block's target; a tween may interpolate its
  own (rare, but needed for behaviors that animate `${$.target}__glow`
  companions — works because behaviors expand after repeats/templates, when
  such ids exist; if the id doesn't exist the standard `E_ITEM_MISSING`
  fires).
- **Ids**: `${parentId}__${suffix}`; `suffix` explicit per tween (as
  above), else the tween's index, zero-padded. `produces` is now *derived*
  from the tween list (the descriptor field becomes read-only output in
  `list_behaviors`, closing today's honor-system gap where a user-supplied
  `produces` is unverifiable).
- **`$repeat` inside the tween list is allowed** — this is what makes
  echo/stagger behaviors (`shake`-alikes) expressible in pure JSON without
  TS.
- **Easing**: per-tween easing pins win; else the block's easing; same rule
  as built-ins (`src/compose/behaviors.ts:219`).

### 5.3 Registry and store mechanics

- `compose.registerBehavior` accepts an optional tween-list and synthesizes
  the `expand` function (a closure over `substitute` + repeat expansion) —
  the `entry.expand === undefined` stub check at `behaviors.ts:179` then
  only fires for genuinely descriptor-only registrations (library catalog
  metadata without bodies), whose error hint gets rewritten to say so.
- Session scoping is already solved: `store.userBehaviors` shadows globals
  (M4/SaaS isolation); it stores the definition instead of just the
  descriptor. `expandBehaviors` (compile pass) continues to see only the
  process-global registry; MCP-session behaviors apply via `apply_behavior`
  — same split as today, no new leak surface.
- Versioning: user behaviors are the trigger for §16-O9's `name@version`
  lean; v1.1 ships without it but the definition shape reserves an optional
  `version` field so libraries can start stamping.

## 6. MCP surface

1. **`apply_behavior`** — user-defined behaviors with bodies now expand;
   the "descriptor-only" caveat is deleted from the `define_user_behavior`
   and `list_behaviors` descriptions (`src/mcp/tools.ts:1426,1451`). The
   30-calls→1 headline case: define once, apply N times (or once under a
   repeat).
2. **`add_tween`** gains an optional block:
   `repeat: { count, stagger, indexParam? }` — server-side expansion into
   `count` tweens (`start += i·stagger`), returning `tweenIds[]`, atomic
   with rollback like `apply_behavior`'s existing loop
   (`src/mcp/tools.ts:1407-1417`). Covers the ad-hoc case with zero new
   JSON syntax for the agent; `from`/`to` may reference `${$.i}` when the
   agent wants per-iteration variation.
3. **`define_user_template` / `define_scene` / `import_scene`** — bodies
   accept `$repeat` + expressions automatically (they route through
   `substitute`). `bulletList`'s `stagger2` fossil gets deprecated in place:
   the built-in keeps accepting it for compatibility, computes it when
   omitted, and its description drops the apology.
4. **`list_engine_capabilities`** — advertise
   `expressions: { version: 1, ops: ["+","-","*","/","%"], maxLength: 256 }`
   and `repeat: { maxCount: 500, budget: 2000 }` for feature detection.
5. **Manifest sync** — server.json + README + mcp-demo (manifest.test
   trap) for every description change above.

## 7. Validation & error summary

| Code | New? | Fires when |
|---|---|---|
| `E_EXPR_PARSE` | new | interior of `${…}` fails the §3.1 grammar |
| `E_EXPR_TYPE` | new | non-numeric operand / non-finite result |
| `E_EXPR_LIMIT` | new | §3.3 length/token/depth caps |
| `E_TEMPLATE_PARAM_MISSING` | reuse | unknown `params.X` / `$.X` ref |
| `E_REPEAT_COUNT` | new | count not an int in `[0, 500]` |
| `E_REPEAT_BUDGET` | new | > 2000 expanded nodes per compile |
| `E_BEHAVIOR_PARAM_*` | reuse | user-behavior param validation |
| `E_TWEEN_OVERLAP`, `E_ITEM_MISSING`, dup-id | reuse | post-expansion, unchanged |

All new codes join `src/engine/errors.ts` and carry hints (agents patch by
error code; the review's live drives showed hint quality is load-bearing).

## 8. Rejected alternatives

- **Full JS / sandboxed eval** (QuickJS, `Function`): rejected by the
  spec's own §19 item 7 guidance ("AVOID full JS sandbox"). The spec's
  other candidate, the `expr-eval` npm package, would work but loses to a
  hand-rolled parser on different grounds: determinism, security audit
  surface (SaaS multi-tenant MCP is the roadmap), and zero-dependency
  policy all favor ~150 lines we own outright.
- **Function whitelist (`min`, `max`, `floor`…) in v1**: deferred (Q1).
  Every motivating case in the review (stagger arithmetic, offset sums,
  bullet grids) needs only `+ - * / %`. Adding functions later is purely
  additive to the grammar.
- **`$repeat` as a fifth standalone compile pass**: can't see template/scene
  params, so `count: "${params.n}"` — the parametric case that makes
  templates like `bulletList` variable-length — would be impossible. Hence
  §4.4's substitute-time expansion.
- **Global mid-string interpolation**: rejected for v1.1; keeps the §17
  content-string safety pin outside repeat bodies (§3.4).
- **Auto-stagger for item-position repeats** (shifting `enter`): rejected —
  items have no uniform time field; implicit magic on `enter` would be
  wrong for the (common) case of items that exist from t=0 and stagger only
  their *tweens*.

## 9. Test plan (for the future implementation session)

1. Parser unit tests: precedence, unary minus, parens, every error code,
   the 256/64/16 caps, division by zero, string-operand rejection,
   bare-ref passthrough of non-number types (G5 pin).
2. Golden compiles: bulletList-N rewritten with `$repeat` (variable count);
   nested repeat grid; repeat-of-`$behavior`; user behavior `myBoinge`
   verbatim from §6.6 — snapshot canonical output, then assert
   determinism across two runs (Session 23 harness).
3. Compatibility sweep: every existing example/authored fixture compiles
   byte-identically with the new engine (G5 gate — this is the ship
   blocker).
4. Overlap interaction: staggered repeat with `stagger < duration` on one
   target errors and the source map points at the `$repeat` node.
5. MCP: `add_tween` with `repeat` returns N ids and rolls back atomically
   on mid-loop failure; `apply_behavior` on a body-carrying user behavior;
   descriptor-only behavior still errors with the rewritten hint.
6. Eval-harness brief (Session 27): "5 staggered bullets + CTA" — success
   criterion: authored in ≤ 4 tool calls (today's baseline: ~13).

## 10. Open questions

| # | Question | Lean |
|---|---|---|
| Q1 | Function whitelist (`floor`, `min`, `max`, `abs`)? | Defer; add as grammar v2 when a brief actually needs them. |
| Q2 | Should `add_tween.repeat` accept expressions in `from`/`to` even without a `$repeat` body? | Yes — it's the same evaluator; costs nothing. |
| Q3 | Outer-index access in nested repeats (`$.outer.i`)? | Defer; route via template params when needed. |
| Q4 | `name@version` for user behaviors (§16-O9)? | Reserve the field now, enforce at library-lock time. |
| Q5 | Should root-scope `$` expose composition meta (`$.fps`, `$.duration`)? | Attractive (`count: "${$.duration / 0.5}"`), but defer — read-your-own-composition coupling needs thought. |

## 11. Spec cross-check (COMPOSITION_PRIMITIVES.md)

- **§6.6** — the registration shape, `${params.X}` / `${$.start + 0.2}`
  syntax, and "shared with templates and scenes" substitution are adopted
  verbatim; this doc fills in the unspecified parts (absolute-time rule,
  suffix/ids, derived `produces`, `$` context keys).
- **§7.4** — the "ship literal substitution only, evaluator can come later
  (§16-O1)" deferral is exactly what this doc closes; the bare-ref
  passthrough rule keeps §7.4's literal semantics as a strict subset.
- **§16-O1** — resolved: **yes, bounded** (usage demanded it: review item
  23, the `stagger2` fossil, the descriptor-only stub).
- **§16-O10 / design-doc Q10 (seeding)** — untouched; the grammar has no
  randomness, so behavior seeds remain a separate, orthogonal design.
- **§16-O12 (`delay` sugar)** — subsumed for the stagger case by
  `$repeat.stagger`; standalone `delay` remains open and unaffected.
- **§17 risk pin (whole-string substitution)** — preserved globally;
  relaxed only inside `$repeat.item` with an escape hatch (§3.4), which is
  the `format: "string-template"` opt-in the risk table itself anticipated,
  scoped structurally instead of per-field.
- **§10 pipeline ordering** — imports → templates → scenes → behaviors is
  preserved; repeats piggyback on substitution rather than adding a pass
  (§4.4), keeping "behaviors last" true.
- **§19.7** — "tiny custom parser, AVOID full JS sandbox": followed.
