# Editor UX Findings — Point-and-Click ("Mouse User") Pass — 2026-05-25

A hands-on session driving `apps/editor` as a **mouse-only user** who wants to
tweak item properties by clicking on the canvas. Target project:
`examples/davidup-demo-90s` (a 90s, 6-act, 292-tween demo — the heaviest comp we
ship).

Method: launched the editor with the demo preloaded (`DAVIDUP_PROJECT=… node ace
serve`), drove it through Chrome, and verified behaviour both visually
(screenshots, recorded GIF) and deterministically (hashing the stage canvas via
`toDataURL()` and reading code paths). A screen recording of the session was
exported as `davidup-mouse-user-ux-session.gif`.

**Bottom line.** Point-and-click editing of this composition is effectively
impossible today, and it's not one bug — it's a chain of five compounding ones.
A curious mouse user cannot stop the animation, cannot reliably click the thing
they see, cannot trust the paused canvas, cannot type a multi-digit number, and
every edit they *do* land throws them back into playback. The MCP/agent path
sidesteps all of this because it addresses items by id and never depends on the
visual hit-test or the playing clock.

Findings are ordered by how hard they block the core workflow.

---

## 1. There is no clickable Play/Pause — the animation never stops for a mouse user 🔴 BLOCKER

**Symptom.** On load the demo auto-plays and keeps playing forever. There is no
visible play/pause/stop button anywhere in the chrome. The timeline header shows
a **text label** `PLAYING` / `PAUSED` that *looks* like it might be a toggle, but
clicking it does nothing (it's a status readout, not a control). The only way to
pause is the **Space** key — which a mouse-driven, first-time user has no way to
discover.

**Evidence.**
- `find "play pause button or transport control"` returned only the status
  label, no button.
- `grep -niE "play|pause|togglePlay"` across `inertia/components` + `layouts`
  finds **no transport control** — the only "Play" buttons are for opening
  finished MP4s in `RenderHistory.vue`.
- `useShortcuts.ts` wires Space → `togglePlay`; that's the sole entry point.

**Why it blocks everything.** Hit-testing a click happens at the *current*
playhead time (see §2). While the comp is playing in real time, the scene under
the cursor changes every frame, so there is no stable target to click. Without a
mouse-reachable pause, the user can never get the canvas to hold still.

**Affected files.**
- `apps/editor/inertia/components/Timeline.vue` (the `meta-status` label).
- `apps/editor/inertia/layouts/editor.vue` (app bar — natural home for a
  transport button).
- `apps/editor/inertia/composables/useStage.ts` (`togglePlay`, `pause`,
  `resume`, `seek` already exist — only the UI is missing).

**Proposed fix.** Add a real transport cluster (⏯ play/pause, ⏮ to-start, and a
visible time readout) in the timeline header *and/or* app bar, bound to the
existing `stage.togglePlay()` / `stage.seek(0)`. Make the `PLAYING/PAUSED` label
itself a button as the minimum viable fix. Surface the Space shortcut in a
tooltip.

---

## 2. Clicking the canvas selects the wrong item (hit-test runs at the live playhead) 🔴 BLOCKER

**Symptom.** With the comp playing, I clicked directly on the large white
"DAVIDUP" wordmark. The Inspector selected **`a1-accent-bar-r`** — an accent bar
positioned at x=1680 (off to the side), nowhere near where I clicked. Between the
click being issued and landing, the playhead had advanced from 3.19s → 31.06s and
the whole scene had changed.

**Root cause.** `Stage.vue → onCanvasClick` calls `pickItemAt(x, y)` **without an
explicit time `t`**, by design, so the pick matches "whatever the engine just
rendered." That's correct *if the frame is stationary* — but while playing, the
rendered frame is a moving target, so you select whatever happens to be under the
pixel at the random instant the event fires.

```
// Stage.vue:836 — intentionally omits playhead so picks match painted pixels…
const hit = props.pickItemAt(coords.x, coords.y)   // …but "painted pixels" are mid-animation
```

**Impact.** Combined with §1 (can't pause), the first and most basic mouse
gesture — "click the thing to edit it" — selects something arbitrary. This alone
reads as "the editor is broken."

**Proposed fix.** This mostly *dissolves* once §1 lands and the user can pause
before clicking. Belt-and-suspenders: when `status === 'playing'`, treat a canvas
click as "pause-at-this-frame, then pick" so the first click always parks the
playhead instead of selecting a phantom. Consider a subtle "click to pause &
select" affordance while playing.

---

## 3. Paused timeline scrubbing doesn't deterministically land on the playhead's frame 🔴 BLOCKER

**Symptom.** After pausing (Space) I scrubbed the ruler. The playhead *indicator*
and the `PLAYHEAD: NN.NNs` readout move correctly, but the **canvas does not
reliably show the frame at that time**:

- Scrubbing to ruler-x=800 → `PLAYHEAD: 45.00s`, canvas hash `432802481`.
- Scrubbing away to x=400 → `16.29s`.
- Scrubbing **back to x=800 → `45.00s` again**, canvas hash `3606944307`.
- Letting it sit still at 45.00s, it finally settles to a *third* hash
  `2982030064` (stable across repeated reads).

Same playhead time → three different rendered frames. (At rest the canvas *is*
genuinely static — three consecutive hashes were identical — so it's not "still
secretly playing"; it's that a seek doesn't converge to the time-correct frame
promptly.) Earlier in the session, scrubbing to 1.94s and 66.53s both showed the
*outro* frame, reinforcing that scrub-position and rendered-frame are decoupled.

**Likely cause.** Seeking while paused is routed `Timeline @seek → stage.seek(t)
→ handle.seek(t)`, but the paused-seek render path doesn't settle synchronously
on the addressed time (appears to drift/re-resolve over a few frames after the
seek). Worth instrumenting `useStage.seek()` and the browser driver's `seek`
under `status==='paused'`.

**Impact.** Even a user who discovers Space-to-pause cannot navigate to the
moment they want to edit, because the canvas they're looking at may not be the
frame at the playhead. The visual editor's core promise — "what you see is the
frame you're editing" — doesn't hold.

**Affected files.**
- `apps/editor/inertia/composables/useStage.ts` (`seek`, `pause`).
- `src/drivers/browser/index.ts` (engine `seek` semantics while the RAF loop is
  stopped).

**Proposed fix.** Make a paused `seek(t)` render exactly one deterministic frame
at `t` and verify (e.g. assert `hash(seek(t))` is stable and equal on repeat).
Add a regression test that seeks to the same `t` twice with an intervening seek
and asserts identical canvas output.

---

## 4. Numeric Inspector fields drop every digit after the first 🔴 BLOCKER

**Symptom.** Selected `a6-wordmark`, triple-clicked its `x` field (640), typed
`300`, pressed Enter → field shows **`3`**. Repeated with `512` → field shows
**`5`**. Only the first character survives. You cannot type a multi-digit value.

**Root cause.** `inputs/Number.vue` is a **controlled** input (`:value="display
Value"`) that emits `update:modelValue` on **every `input` event** (i.e. per
keystroke):

```
@input="onInput"      // fires on EVERY keystroke
// onInput → emit('update:modelValue', next)  → Inspector dispatches updateItem
```

So the first keystroke immediately fires a command → the composition mutates →
the value prop flows back and **overwrites the input** to the just-committed
single-digit value → the remaining keystrokes are lost (and the engine
re-attaches, see §5). The display ends up as the first digit only.

**Impact.** Combined with §5, the Inspector — the *only* place to type a precise
value — is unusable for any number ≥ 10. This is the single most direct cause of
"editing by point and click is impossible."

**Affected file.** `apps/editor/inertia/components/inputs/Number.vue` (and the
same pattern likely in `Percent.vue`, `Time.vue`, `Color.vue`).

**Proposed fix.** Use a **local editable buffer**: bind the `<input>` to a local
`ref` (uncontrolled while focused), and commit to the command bus only on
`change` / `blur` / `Enter` (and on slider `input`, which is genuinely
continuous). Stop dispatching a command per keystroke. This also fixes the undo
spam (one undo entry per character) and the playback resume (§5).

---

## 5. Every Inspector edit un-pauses the animation 🔴 BLOCKER

**Symptom.** Paused at 45.00s, edited one property → status flipped
**PAUSED → PLAYING** and the playhead leapt forward (…46.67s … 81.94s) and kept
advancing. To make a second edit you must pause *again*, and by then the item has
moved / the scene has changed. Verified twice via the status readout
(`statusAfterSpace: PAUSED` → edit → `statusAfterEdit: PLAYING`).

**Root cause.** `useStage.ts` watches the composition; on any mutation it calls
`start({ resumeAt: playhead })`, and `start()` unconditionally sets
`status.value = 'playing'`. The intent (per the code comment) is to *preserve the
playhead* across edits — but it also *resumes playback*, which is the opposite of
what a user mid-edit wants.

```
// useStage.ts — composition watcher, paused branch:
if (status === 'paused' | 'stopped' | 'ended') start({ resumeAt: playhead.value })
// …and start() always ends with status.value = 'playing'
```

**Impact.** Iterative tweaking (the whole point of a visual editor) is
self-defeating: edit → fly off into playback → re-pause → re-find → edit. Layered
on §4 (can't even type the number) and §3 (paused canvas unreliable), the
workflow collapses.

**Affected file.** `apps/editor/inertia/composables/useStage.ts`.

**Proposed fix.** When re-attaching after a composition mutation, **preserve the
prior play state**: if we were paused, re-attach and immediately render the
frame at `resumeAt` *without* resuming the RAF loop (stay `paused`). Only keep
playing if we were playing. (Pairs naturally with the §4 fix that stops firing a
command per keystroke.)

---

## 6. Floating Outliner + Layers panels cover the canvas you need to click 🟠 MAJOR

**Symptom.** On load, the **Outliner** (78 items) and **Layers** (8) panels float
*on top of* the stage, covering roughly the left third and right third of the
canvas. Expanding an Outliner group pushes it over the left half. The artwork the
user wants to click is largely occluded, and the selection ring (drawn on the
stage) is frequently hidden behind a panel.

**Impact.** Even with §1–§5 fixed, you'd be clicking through gaps between two
opaque overlays. Reinforces the earlier note in `UX_FINDINGS_2026-05-21.md`
("Outliner is a floating panel that overlaps the canvas by default").

**Proposed fix.** Dock the Outliner and Layers panels into the side rails (or make
them collapsible and collapsed-by-default), so the stage is unobstructed. At
minimum, make them draggable/dismissible and remember the state.

---

## 7. The Inspector shows authored *base* values, not the value at the playhead 🟠 MAJOR

**Symptom.** Selected `a6-wordmark` at t=45s. Inspector showed `opacity = 0`
while there was no correspondingly visible/invisible cue I could reconcile on the
(occluded, drifting) canvas. The transform fields display the **authored base
values from `composition.items`**, not the *resolved* value at the current
playhead.

**Evidence.** In `Inspector.vue`, `props.playhead` is used **only** as the
default `start` for newly-authored tweens (the `+ animate` button) — never to
resolve/display the current-frame value. So for any tweened property (which is
~every property in this 292-tween demo), the number shown is the keyframe base,
not what's on screen.

**Impact.** The user sees a number that doesn't match the frame, edits the *base*
(which a tween may immediately override at that time), and concludes nothing
works. Deeply confusing specifically for animation-heavy comps — i.e. exactly the
ones worth editing visually.

**Affected file.** `apps/editor/inertia/components/Inspector.vue`.

**Proposed fix.** Show the **resolved value at the playhead** for each field
(read-only or as the editable value when the property is tweened), with a clear
indicator that the field is animated and that editing the base differs from
editing the keyframe. Reuse the engine's per-frame resolver so the displayed
number always equals the rendered pixel.

---

## 8. Outliner row-click toggles expand instead of selecting 🟡 MINOR

**Symptom.** Clicking a **group** row in the Outliner (e.g. `act6`) expands its
children but does not select it; only clicking a **leaf** row (e.g.
`a6-wordmark`) selects + populates the Inspector. The whole-row click target is
ambiguous: sometimes it discloses, sometimes it selects.

**Impact.** A mouse user trying to select a group/act from the tree gets a
disclosure toggle and no Inspector change — looks unresponsive.

**Proposed fix.** Separate the disclosure triangle (toggle expand) from the row
body (select). Row-click selects; triangle-click expands. Selecting a group is
the canonical tree behaviour.

**Affected files.** `apps/editor/inertia/components/Outliner.vue`,
`OutlinerNode.vue`.

---

## What already works (keep)

- Once a leaf is selected, the **Inspector populates** correctly and the command
  pipeline **does round-trip** (edits persist, undo becomes available, override
  dot appears) — the plumbing is sound; the interaction layer is what's broken.
- **Clicking the ruler scrubs** the playhead and the readout is accurate (it's
  the *canvas-follows-scrub* that's unreliable, §3).
- **Selection sticks** across scrubs and play/pause.
- Resize/rotate handles, marquee multi-select, drag-to-move, shift-click additive
  selection are all implemented in `Stage.vue` (not exercised in depth here
  because §1–§5 block reaching them on this comp — worth a dedicated pass once
  the blockers are fixed).

---

## Suggested fix order (highest leverage first)

1. **§4 Number input** — local buffer, commit on blur/Enter. Tiny change, unblocks
   typing immediately and (with §5) stops the per-keystroke re-attach.
2. **§5 Preserve pause on edit** — re-attach without resuming. Tiny change in
   `useStage`.
3. **§1 Visible Play/Pause** transport. Small, purely additive UI.
4. **§3 Deterministic paused seek** — needs engine/driver investigation; highest
   correctness value.
5. **§6 Dock the panels**; **§7 resolved-value Inspector**; **§2** (largely
   resolves after §1); **§8 Outliner toggle vs select**.

§4, §5, §1 together would take this from "impossible" to "usable" for a mouse
user, and they are all small, localized changes in the editor front-end.

---

## Reproduction notes

- Editor launched: `DAVIDUP_PROJECT=$(pwd)/examples/davidup-demo-90s node ace
  serve --hmr` (from `apps/editor`), opened `http://localhost:3333/editor`.
- Canvas determinism was checked by hashing
  `document.querySelector('[data-testid="stage-canvas"]').toDataURL()`.
- All test edits to the demo were reverted (`git checkout --
  examples/davidup-demo-90s/composition.json`); the demo is pristine.
- Session recording: `davidup-mouse-user-ux-session.gif` (downloaded).
