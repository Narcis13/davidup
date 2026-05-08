# Known bugs

All four bugs filed against the v0.1 comprehensive demo are now fixed in `src/`
and exercised by the demo composition rather than worked around. This file is
kept as a postmortem.

---

## 1. Validator's overlap check is IEEE-754 fragile — FIXED

**Where:** `src/schema/validator.ts`
**Fix:** the strict `curr.start < prev.end` comparison is now
`curr.start + OVERLAP_EPS < prev.end` with `OVERLAP_EPS = 1e-6` (1µs). That
sits well below sub-frame tolerance (8.3ms at 120fps) and absorbs the IEEE-754
drift that `start + duration` chains accumulate.

**Demo coverage:** `examples/comprehensive-composition.json` chains
`star.transform.scaleX/scaleY` as 0.4 + 0.3 + 0.3 starting at 5.2 (drifts to
5.8999999999999995 on the second sum) and chains `ball.tint` as 1.3 + 1.3 + 1.4
across 8.0–12.0. Both validate cleanly.

**Regression tests:** `tests/schema/validator.test.ts` —
"accepts back-to-back chains whose start+duration drifts by 1 ULP" and
"still flags real overlap larger than the epsilon".

---

## 2. Browser driver's RAF loop cannot be restarted — FIXED

**Where:** `src/drivers/browser/index.ts`
**Fix:** `seek()` now re-primes the RAF loop when it has self-stopped.

```ts
seek(seconds: number): void {
  startTime = now() - seconds * 1000;
  if (cancelled) return;       // stop() is still terminal
  if (rafId === null) {        // loop has exited; restart it
    rafId = raf(tick);
  }
},
```

`tick()` clears `rafId = null` before doing work, so the null-check guarantees
no double-scheduling, and `cancelled` preserves the "stop() is terminal" contract.

**Demo coverage:** `examples/comprehensive-browser/main.ts` now drives Replay
and the five seek buttons through `handle.seek()` instead of re-attaching for
every jump. After the clip ends, pressing "Seek 0s" resumes painting — pre-fix
this was a no-op.

**Regression tests:** `tests/drivers/browser.test.ts` —
"seek(0) re-primes the RAF loop after it has self-stopped past the end",
"seek() does not double-schedule when the loop is already running",
"seek() after stop() is inert (stop is terminal)".

---

## 3. Sprite `tint` is in the schema but never rendered — FIXED

**Where:** `src/engine/render.ts`
**Fix:** `drawSprite` now paints the tint via source-atop fillRect after
the image draw. This tints only opaque pixels, respects `globalAlpha`, and
works on browser Canvas2D and skia-canvas without per-host code.

```ts
ctx.drawImage(image, 0, 0, item.width, item.height);
if (item.tint !== undefined) {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = item.tint;
  ctx.fillRect(0, 0, item.width, item.height);
  ctx.globalCompositeOperation = prev;
}
```

**Demo coverage:** the bouncing ball in Act 3 carries `tint: "#ffffff"` and
animates through `#26d4ff → #ff3aa0 → #ffffff` while crossing screen.

**Regression tests:** `tests/engine/render.test.ts` —
"renders tint via source-atop fillRect after drawImage",
"does not paint tint when item.tint is unset".

---

## 4. Circle anchor Y is a silent no-op when `shape.height` is unset — FIXED

**Where:** `src/engine/render.ts`
**Fix:** `anchorHeight` now falls back to `width` for circles, since §3.2
treats the circle's `width` as the diameter on both axes:

```ts
function anchorHeight(item: Item): number {
  if (item.type === "sprite") return item.height;
  if (item.type === "shape") {
    if (item.kind === "circle") return item.height ?? item.width ?? 0;
    return item.height ?? 0;
  }
  return 0;
}
```

`anchorWidth` was already correct. The fix preserves the schema (height stays
optional for circles) and uses the explicit height if the author set one.

**Demo coverage:** the Act 2 circle at `transform: { y: H/2 + 40, anchorY: 0.5 }`
now actually centres at y=H/2+40, and the round-trip
`anchorY: 0.5 → 0.3 → 0.5` between t=5.5 and 7.2 visibly bobs the circle.

**Regression tests:** `tests/engine/render.test.ts` —
"anchors a circle on Y using width when height is unset".
