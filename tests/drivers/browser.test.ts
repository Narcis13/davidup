import { describe, expect, it, vi } from "vitest";

import { attach } from "../../src/drivers/browser/index.js";
import type { AssetLoader } from "../../src/assets/index.js";
import type { Canvas2DContext } from "../../src/engine/types.js";
import type { Composition } from "../../src/schema/types.js";
import type { Asset } from "../../src/schema/types.js";
import { FakeContext } from "../engine/fakeContext.js";

function tinyComp(overrides: Partial<Composition["composition"]> = {}): Composition {
  return {
    version: "0.1",
    composition: {
      width: 32,
      height: 32,
      fps: 60,
      duration: 1.0,
      background: "#101010",
      ...overrides,
    },
    assets: [],
    layers: [
      { id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["s"] },
    ],
    items: {
      s: {
        type: "shape",
        kind: "rect",
        width: 10,
        height: 10,
        fillColor: "#ff0000",
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [],
  };
}

class FakeCanvas {
  ctx = new FakeContext();
  getContextCalls = 0;
  getContext(_kind: "2d"): Canvas2DContext | null {
    this.getContextCalls++;
    return this.ctx;
  }
}

interface FakeRaf {
  schedule: (cb: (t: number) => void) => number;
  cancel: (id: number) => void;
  flushOne: () => boolean;
  pending: () => number;
  cancelled: number[];
}

function makeFakeRaf(): FakeRaf {
  let nextId = 1;
  const queue = new Map<number, (t: number) => void>();
  const cancelled: number[] = [];
  return {
    schedule(cb) {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancel(id) {
      queue.delete(id);
      cancelled.push(id);
    },
    flushOne() {
      const next = queue.entries().next();
      if (next.done) return false;
      const [id, cb] = next.value;
      queue.delete(id);
      cb(0);
      return true;
    },
    pending() {
      return queue.size;
    },
    cancelled,
  };
}

class FakeClock {
  constructor(private t: number = 0) {}
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

function noopLoader(): AssetLoader {
  return {
    async load() {},
    async preloadAll(_assets: ReadonlyArray<Asset>) {},
    has() {
      return false;
    },
    clear() {},
    getImage() {
      return undefined;
    },
    getFontFamily() {
      return undefined;
    },
  };
}

function fillRectCount(ctx: FakeContext): number {
  return ctx.calls.filter((c) => c.op === "fillRect").length;
}

describe("attach", () => {
  it("renders the first frame synchronously after preload and schedules the next via RAF", async () => {
    const comp = tinyComp({ duration: 1 });
    const canvas = new FakeCanvas();
    const clock = new FakeClock(1000);
    const raf = makeFakeRaf();

    const handle = await attach(comp, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    // First paint already happened synchronously: background fill + shape fill.
    expect(canvas.getContextCalls).toBe(1);
    const beforeNext = fillRectCount(canvas.ctx);
    expect(beforeNext).toBeGreaterThanOrEqual(1);
    expect(raf.pending()).toBe(1);

    // Advance the clock and let the next RAF fire — another frame paints.
    clock.advance(16);
    raf.flushOne();
    expect(fillRectCount(canvas.ctx)).toBeGreaterThan(beforeNext);
    expect(raf.pending()).toBe(1);

    handle.stop();
  });

  it("preloads assets before the first render", async () => {
    const preloadOrder: string[] = [];
    const loader: AssetLoader = {
      async load() {},
      async preloadAll(assets) {
        preloadOrder.push(`preload(${assets.length})`);
      },
      has() {
        return false;
      },
      clear() {},
      getImage() {
        return undefined;
      },
      getFontFamily() {
        return undefined;
      },
    };
    const comp: Composition = {
      ...tinyComp(),
      assets: [{ id: "a", type: "image", src: "x.png" }],
    };
    const canvas = new FakeCanvas();
    const raf = makeFakeRaf();
    const clock = new FakeClock(0);

    const preloadSpy = vi.spyOn(loader, "preloadAll");
    const handle = await attach(comp, canvas, {
      loader,
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    expect(preloadSpy).toHaveBeenCalledTimes(1);
    expect(preloadSpy).toHaveBeenCalledWith(comp.assets);
    expect(preloadOrder).toEqual(["preload(1)"]);
    handle.stop();
  });

  it("paints the clamped final frame once t > duration, then self-terminates", async () => {
    const comp = tinyComp({ duration: 0.1 }); // 100ms
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(comp, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    // Initial paint at t=0 happened, one RAF queued.
    expect(raf.pending()).toBe(1);
    const initialFills = fillRectCount(canvas.ctx);

    // Advance past duration and let the queued tick fire.
    clock.advance(150);
    raf.flushOne();

    // No new RAF queued because t > duration short-circuited.
    expect(raf.pending()).toBe(0);
    // The final tick clamps t to duration and paints that frame (renderAt in
    // src/drivers/browser/index.ts) so the canvas ends on the last frame
    // instead of whatever was there before.
    expect(fillRectCount(canvas.ctx)).toBeGreaterThan(initialFills);
    handle.stop();
  });

  it("stop() cancels the pending RAF and prevents further renders", async () => {
    const comp = tinyComp({ duration: 10 });
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(comp, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    expect(raf.pending()).toBe(1);
    const fillsBeforeStop = fillRectCount(canvas.ctx);

    handle.stop();

    expect(raf.cancelled).toHaveLength(1);
    expect(raf.pending()).toBe(0);

    // Even if a stale callback somehow fires, no further rendering occurs.
    // (The queue is empty so this is a no-op, but the cancelled flag makes
    // it safe regardless.)
    clock.advance(100);
    expect(fillRectCount(canvas.ctx)).toBe(fillsBeforeStop);

    // stop() is idempotent.
    handle.stop();
    expect(raf.cancelled).toHaveLength(1);
  });

  it("seek(s) shifts the start time so subsequent ticks compute t = s + elapsed", async () => {
    const comp = tinyComp({ duration: 10 });
    const canvas = new FakeCanvas();
    const clock = new FakeClock(5000);
    const raf = makeFakeRaf();

    const handle = await attach(comp, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    // Seek to 3.0s — startTime should become now() - 3000.
    handle.seek(3.0);

    // Advance the clock 100ms and let the next tick fire. t should be ~3.1s.
    // We can't read t directly, but the loop should still be running and
    // queue another RAF since 3.1 < 10.
    clock.advance(100);
    raf.flushOne();
    expect(raf.pending()).toBe(1);

    // Seek past the end and verify the next tick stops.
    handle.seek(11);
    raf.flushOne();
    expect(raf.pending()).toBe(0);

    handle.stop();
  });

  it("seek(0) re-primes the RAF loop after it has self-stopped past the end", async () => {
    const comp = tinyComp({ duration: 0.1 });
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(comp, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    // Run past the duration — loop self-terminates, no pending RAF.
    clock.advance(150);
    raf.flushOne();
    expect(raf.pending()).toBe(0);
    const fillsAtEnd = fillRectCount(canvas.ctx);

    // Seek back to the start. Loop must restart.
    handle.seek(0);
    expect(raf.pending()).toBe(1);

    // Subsequent ticks should paint frame 0 again.
    raf.flushOne();
    expect(fillRectCount(canvas.ctx)).toBeGreaterThan(fillsAtEnd);

    handle.stop();
  });

  it("seek() does not double-schedule when the loop is already running", async () => {
    const comp = tinyComp({ duration: 10 });
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(comp, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    expect(raf.pending()).toBe(1); // Initial RAF queued.
    handle.seek(2.0);
    expect(raf.pending()).toBe(1); // Still exactly one — no double-schedule.

    handle.stop();
  });

  it("seek() after stop() is inert (stop is terminal)", async () => {
    const comp = tinyComp({ duration: 1 });
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(comp, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    handle.stop();
    expect(raf.pending()).toBe(0);

    handle.seek(0);
    expect(raf.pending()).toBe(0); // Nothing scheduled after stop.
  });

  it("startAt initializes the clock offset before the first frame", async () => {
    const comp = tinyComp({ duration: 5 });
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    // startAt: 6 seconds — past duration (5s). The first tick clamps to the
    // end and paints the final frame, but must not schedule another frame.
    const handle = await attach(comp, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
      startAt: 6,
    });

    expect(raf.pending()).toBe(0);
    expect(fillRectCount(canvas.ctx)).toBeGreaterThanOrEqual(1);

    handle.stop();
  });

  it("throws if canvas.getContext('2d') returns null", async () => {
    const canvas: { getContext(_: "2d"): null } = {
      getContext: () => null,
    };
    await expect(
      attach(tinyComp(), canvas, { loader: noopLoader() }),
    ).rejects.toThrow(/getContext\('2d'\) returned null/);
  });

  // --- v0.2 pre-compile auto-run (COMPOSITION_PRIMITIVES.md §10.3) ---

  it("auto-expands $behavior tweens before the first paint (no sourcePath needed)", async () => {
    // Authored input: opacity is animated via a fadeIn behavior block that
    // would crash the engine if not expanded (engine only knows raw tweens).
    const authored = {
      ...tinyComp({ duration: 1 }),
      tweens: [
        { $behavior: "fadeIn", target: "s", start: 0, duration: 0.5 },
      ],
    } as unknown as Composition;
    const canvas = new FakeCanvas();
    const clock = new FakeClock(1000);
    const raf = makeFakeRaf();

    const handle = await attach(authored, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    // First paint must complete without throwing — proves the engine saw a
    // canonical tween, not an unexpanded `$behavior` block.
    expect(fillRectCount(canvas.ctx)).toBeGreaterThanOrEqual(1);
    handle.stop();
  });

  it("resolves $ref via the supplied readFile and proceeds to paint", async () => {
    // The whole `tweens` array is imported from a virtual file. The compiler
    // spreads the resolved array in place of the `$ref` entry, then expands
    // the behavior. End result: the loop must paint successfully.
    const fakeFiles: Record<string, string> = {
      "/proj/tweens.json": JSON.stringify([
        { $behavior: "fadeIn", target: "s", start: 0, duration: 0.4 },
      ]),
    };
    const readFile = async (absPath: string): Promise<string> => {
      const v = fakeFiles[absPath];
      if (v === undefined) throw new Error(`no such virtual file: ${absPath}`);
      return v;
    };

    const authored = {
      ...tinyComp({ duration: 1 }),
      tweens: [{ $ref: "./tweens.json" }],
    } as unknown as Composition;
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(authored, canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
      sourcePath: "/proj/root.json",
      readFile,
    });

    expect(fillRectCount(canvas.ctx)).toBeGreaterThanOrEqual(1);
    handle.stop();
  });

  it("rejects authored compositions with $ref but no sourcePath", async () => {
    const authored = {
      ...tinyComp(),
      tweens: [{ $ref: "./tweens.json" }],
    } as unknown as Composition;
    const canvas = new FakeCanvas();
    await expect(
      attach(authored, canvas, { loader: noopLoader() }),
    ).rejects.toThrow(/\$ref.*sourcePath/);
  });

  // ──────────────── Paused-seek determinism (UX_FINDINGS §3) ────────────────
  //
  // Regression coverage for the editor's "scrub while paused" workflow.
  // Before the fix, `pause()` tore the engine handle down and a subsequent
  // `seek(t)` was a no-op against the canvas — the playhead readout moved
  // but the canvas stayed on the pre-pause frame (or, worse, drifted to
  // arbitrary in-flight frames over a few RAF ticks).
  //
  // The contract now: while paused, `seek(t)` paints exactly one
  // deterministic frame at `t` in the same call, and two seeks to the same
  // `t` are pixel-identical regardless of intervening seeks.

  // Composition with one opacity tween so different `t` values produce
  // visibly different draw outputs (the shape's fillRect alpha varies
  // linearly with t). Opacity is a cleaner signal than transform.x — the
  // anchor-adjust translate the renderer emits for shapes can mask
  // position changes with a trailing translate(-0, -0).
  function compWithTween(): Composition {
    const base = tinyComp({ duration: 10 });
    return {
      ...base,
      tweens: [
        {
          id: "fade",
          target: "s",
          property: "transform.opacity",
          from: 0,
          to: 1,
          start: 0,
          duration: 10,
          easing: "linear",
        },
      ],
    } as unknown as Composition;
  }

  // The shape's fillStyle is "#ff0000" (tinyComp); the background uses
  // "#101010". Grabs the alpha the engine ended up applying to the shape's
  // draw — the resolved t * 0.1 of the linear opacity tween.
  function lastShapeAlpha(ctx: FakeContext): number | null {
    for (let i = ctx.calls.length - 1; i >= 0; i--) {
      const c = ctx.calls[i]!;
      if (
        (c.op === "fillRect" || c.op === "fill") &&
        c.fillStyle === "#ff0000"
      ) {
        return c.alpha;
      }
    }
    return null;
  }

  it("seek(t) paints a frame synchronously, even while paused", async () => {
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(compWithTween(), canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    handle.pause();
    expect(raf.pending()).toBe(0); // pause() cancels the queued RAF.

    canvas.ctx.calls.length = 0;
    handle.seek(5); // t=5 of 10 → opacity = 0.5
    // The seek itself must have repainted; no RAF flush, no clock advance.
    expect(fillRectCount(canvas.ctx)).toBeGreaterThanOrEqual(1);
    expect(lastShapeAlpha(canvas.ctx)).toBeCloseTo(0.5, 5);
    // And it must not have re-primed the loop — the engine stays frozen.
    expect(raf.pending()).toBe(0);

    handle.stop();
  });

  it("two paused seeks to the same t produce identical draw output", async () => {
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(compWithTween(), canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });
    handle.pause();

    // First seek to t=4 (opacity=0.4) — capture the draw stream this produces.
    canvas.ctx.calls.length = 0;
    handle.seek(4);
    const first = JSON.stringify(canvas.ctx.calls);
    expect(lastShapeAlpha(canvas.ctx)).toBeCloseTo(0.4, 5);

    // Seek away to a different time so the engine has to actually re-resolve
    // when we come back. Also advance the wall clock — the bug from the
    // report was that the canvas would resolve against (now - startTime)
    // instead of the addressed time, so this exposes that path.
    canvas.ctx.calls.length = 0;
    handle.seek(2);
    expect(lastShapeAlpha(canvas.ctx)).toBeCloseTo(0.2, 5);
    clock.advance(2500);

    // Seek back to t=4. Draw stream must be byte-identical to `first` —
    // same translates, same fills, same order.
    canvas.ctx.calls.length = 0;
    handle.seek(4);
    const second = JSON.stringify(canvas.ctx.calls);
    expect(second).toBe(first);

    // And a *third* seek to t=4 (no scrub between) is also identical.
    canvas.ctx.calls.length = 0;
    handle.seek(4);
    const third = JSON.stringify(canvas.ctx.calls);
    expect(third).toBe(first);

    // Engine must not have ticked on its own — wall-clock advanced but the
    // canvas hasn't moved past the addressed frame.
    expect(raf.pending()).toBe(0);

    handle.stop();
  });

  it("pause() cancels the RAF loop without destroying the handle", async () => {
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(compWithTween(), canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    expect(raf.pending()).toBe(1);
    handle.pause();
    expect(raf.pending()).toBe(0);

    // Wall clock advances while paused; no tick fires.
    const fillsAtPause = fillRectCount(canvas.ctx);
    clock.advance(5000);
    expect(fillRectCount(canvas.ctx)).toBe(fillsAtPause);

    // pause() is idempotent.
    handle.pause();
    expect(raf.pending()).toBe(0);

    // The handle is still alive — getItemBoundsAt resolves, getSourceMap
    // doesn't throw, seek paints.
    expect(handle.getSourceMap()).toBeNull(); // no emitSourceMap option.
    canvas.ctx.calls.length = 0;
    handle.seek(7);
    expect(lastShapeAlpha(canvas.ctx)).toBeCloseTo(0.7, 5);

    handle.stop();
  });

  it("resume() re-primes the RAF loop from the last rendered frame", async () => {
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(compWithTween(), canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });

    handle.pause();
    handle.seek(3);
    expect(lastShapeAlpha(canvas.ctx)).toBeCloseTo(0.3, 5);

    // Long real-time pause; resume must NOT skip forward by that amount.
    clock.advance(8000);
    handle.resume();
    expect(raf.pending()).toBe(1);

    // The next tick should land just after t=3 (opacity ~0.3), not at t=11
    // (which would be past duration and end the comp with opacity=1).
    raf.flushOne();
    const a = lastShapeAlpha(canvas.ctx);
    expect(a).not.toBeNull();
    // Allow a couple frames of slack; the point is we did NOT jump by 8s.
    expect(a!).toBeGreaterThanOrEqual(0.3);
    expect(a!).toBeLessThan(0.35);

    handle.stop();
  });

  it("pause() / resume() / seek() are inert after stop()", async () => {
    const canvas = new FakeCanvas();
    const clock = new FakeClock(0);
    const raf = makeFakeRaf();

    const handle = await attach(compWithTween(), canvas, {
      loader: noopLoader(),
      now: clock.now,
      requestAnimationFrame: raf.schedule,
      cancelAnimationFrame: raf.cancel,
    });
    handle.stop();

    const fillsAfterStop = fillRectCount(canvas.ctx);
    canvas.ctx.calls.length = 0;
    handle.pause();
    handle.resume();
    handle.seek(5);
    expect(fillRectCount(canvas.ctx)).toBe(0);
    expect(raf.pending()).toBe(0);
    // Sanity: the canvas didn't accumulate draws past stop either.
    void fillsAfterStop;
  });
});
