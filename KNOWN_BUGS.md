# Known bugs

Found while authoring `examples/comprehensive.ts` (the 20s feature demo).
Each one is currently *worked around* in the example, not fixed in `src/`.

---

## 1. Validator's overlap check is IEEE-754 fragile

**Where:** `src/schema/validator.ts:234`
**Code:** `if (curr.start < prev.end) errors.push({ code: "E_TWEEN_OVERLAP", … })`
where `prev.end = prev.start + prev.duration`.

**Trigger:** any tween chain whose `start + duration` drifts by 1 ULP under
floating-point addition. A user-friendly example:

```
tween A: start=8.0,  duration=0.55  → end = 8.55                     (exact)
tween B: start=8.55, duration=0.55  → end = 9.100000000000001        (drift!)
tween C: start=9.1,  duration=0.55  → flagged: 9.1 < 9.100000000000001
```

The user authored "back-to-back" segments — strictly legal per design-doc §3.5
— but validation rejects them.

**Workaround in the demo:** every touching segment uses exactly `0.5` so
`a + 0.5 = b` is bit-exact. Anything else (0.55, 0.4, 0.3) eventually drifts.

**Fix tips:**
- Compare with an epsilon: `if (curr.start + EPS < prev.end)`. The natural
  scale here is sub-frame: at 120 fps a frame is 8.3 ms, so `EPS = 1e-6`s
  is well below any user-meaningful tolerance.
- Compute `prev.end` once with rounding to e.g. nanoseconds, then compare.
- Add a unit test that explicitly chains durations like 0.55 + 0.55 + 0.55
  and asserts they validate. The current test suite uses round numbers
  (0.5, 1.0, 1.5) and never trips this.
- Consider whether the same epsilon should be applied inside the resolver's
  segment selection (`src/engine/resolver.ts:107`, the `tw.start <= t`
  loop). Currently inconsistent: validator strict, resolver inclusive.

**Risk of fix:** very low. Only changes the rejection criterion at the
boundary; previously-valid compositions stay valid.

---

## 2. Browser driver's RAF loop cannot be restarted

**Where:** `src/drivers/browser/index.ts`, the `tick()` closure and the
`seek()` method on the returned handle.

**Trigger:** once `t > duration`, `tick()` returns without calling `raf(tick)`
again. `seek(seconds)` only mutates `startTime`; it does not re-schedule
a tick. So:

```
attach() → tick runs … reaches t > duration → tick returns, rafId = null.
handle.seek(0)  // does nothing visible.
```

The canvas freezes on whatever was last painted (typically the t=duration
frame, which in our demo is solid black).

**Workaround in the demo:** `examples/comprehensive-browser/main.ts`
calls `attach(comp, canvas, { startAt: t, loader })` again for every Replay/Seek,
reusing the cached `BrowserAssetLoader`.

**Fix tips:**
- Make `seek()` re-prime the loop:
  ```ts
  seek(seconds: number): void {
    startTime = now() - seconds * 1000;
    if (cancelled) return;          // stop() is still terminal
    if (rafId === null) {           // loop has exited; restart it
      rafId = raf(tick);
    }
  },
  ```
  This keeps the existing semantics (a single tick per RAF, no double-scheduling)
  because `tick` clears `rafId = null` before doing work.
- Consider exposing an explicit `play()` so callers can disambiguate
  "resume from current t" vs. "jump to t and play".
- Add a test: attach with `duration: 0.1`, run a few RAF ticks past the
  end, call `seek(0)`, assert that subsequent ticks paint frame 0 again.
  Existing browser tests (`tests/drivers/browser.test.ts`) only cover the
  in-bounds path.

**Risk of fix:** low. The change is additive (only restarts when the loop
has self-stopped). Stop()'s `cancelled = true` guard preserves the
"once stopped, stays stopped" contract.

---

## 3. Sprite `tint` is in the schema but never rendered

**Where:** `src/engine/render.ts:148` (`drawSprite`).

**Trigger:** any sprite with `tint` set, or any tween targeting `tint`.
The schema accepts it (`src/schema/zod.ts:46`), the tweenable table lists
it as a color property (`src/schema/tweenable.ts:28`), the resolver
interpolates it correctly, and the MCP tools expose it. But `drawSprite`
just calls `ctx.drawImage(image, 0, 0, item.width, item.height)` — `tint`
is never read.

**Result:** silent no-op. A user can set `tint: "#ff0000"`, validate, render,
and get an untinted sprite with no error or warning.

**Workaround in the demo:** I dropped tint tweens from the comprehensive
demo and noted in the result message that tint is exposed but unrendered.

**Fix tips:**
- Decide on semantics first. Two reasonable interpretations:
  - **Multiply tint:** `globalCompositeOperation = "multiply"` over the
    sprite, then composite back. Simple but tints transparent pixels too.
  - **Source-atop tint:** draw the image, then `fillRect` in tint colour
    with `globalCompositeOperation = "source-atop"`. Tints only opaque
    pixels. Most "tint a PNG" implementations use this.
  - Cross-check with `design-doc.md` — the spec may already prefer one.
- Implementation sketch (source-atop, simplest path):
  ```ts
  function drawSprite(ctx, item, assets) {
    const image = assets?.getImage(item.asset);
    if (image === undefined) return;
    ctx.drawImage(image, 0, 0, item.width, item.height);
    if (item.tint !== undefined) {
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = item.tint;
      ctx.fillRect(0, 0, item.width, item.height);
      ctx.globalCompositeOperation = prev;
    }
  }
  ```
  This works on both browser Canvas2D and skia-canvas without per-host code.
- Add a tint test in `tests/engine/` that compares a tinted vs. untinted
  pixel sample. Browser and node should agree (deterministic per spec).
- Beware: tinting interacts with `transform.opacity` (already applied via
  `globalAlpha` before this draw). Source-atop respects globalAlpha, so
  the tint will fade with opacity — likely the desired behaviour.

**Risk of fix:** medium. Behaviour change visible in any composition that
already uses tint (silently). Consider a `version` bump or a feature flag
if any production composition relies on the current no-op.

---

## 4. Circle anchor Y is a silent no-op when `shape.height` is unset

**Where:** `src/engine/render.ts:142` (`anchorHeight`) plus the call in
`drawItem` at `src/engine/render.ts:84`.

**Trigger:** `kind: "circle"` items where `width` is the diameter and
`height` is left undefined (the natural way to author a circle, since the
renderer at `render.ts:188` derives the diameter from `width` alone).
`anchorHeight` returns `item.height ?? 0`, so the Y-anchor offset
`-anchorY * h` evaluates to 0 regardless of `anchorY`.

**Effect:** for a circle item with `transform.y = 400, anchorY = 0.5,
width = 220`, the user expects the circle's *centre* at y=400. They
actually get the circle's *top edge* at y=400 (centre at y=510). X
behaviour is correct because `width` is set, so the asymmetry can fool
you — the circle looks "almost right".

**Workaround in the demo:** none — I just placed circles where they
*looked* OK. The demo is wrong about Y-anchor for every circle, but the
positions still happen to be on screen and read well.

**Fix tips:**
- Treat circle `width` as both diameter dimensions. Either:
  - In `anchorHeight`: special-case circle to return `item.width ?? 0`.
  - Or normalise at validation time: copy `width` into `height` for circles
    so the rest of the pipeline sees a square.
- The first option keeps the schema honest (height intentionally optional
  for circles) and is a one-line fix:
  ```ts
  function anchorHeight(item: Item): number {
    if (item.type === "sprite") return item.height;
    if (item.type === "shape") {
      if (item.kind === "circle") return item.width ?? 0;
      return item.height ?? 0;
    }
    return 0;
  }
  ```
- Apply the symmetric thought to polygons: `anchorWidth`/`anchorHeight`
  both return 0 for polygons because `points` are absolute. That is
  arguably correct (polygons have no implicit bounding box) but it means
  `anchorX/Y` on a polygon does nothing. Either document or compute the
  bbox from `points`.
- Add a regression test: render a circle at canvas centre with
  `anchorX = anchorY = 0.5`, sample the centre pixel, assert it matches
  the fill colour.

**Risk of fix:** medium. Any composition that *worked around* the bug by
shifting Y manually will move when this is fixed. Probably fine — most
authors set anchor to 0.5 and move on — but worth checking
`examples/hello-world.json` and any production scenes for offsets that
were compensating.
