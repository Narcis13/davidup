// Video-item MCP tools through the dispatcher (v0.2 §S9).
//
// The headline test is the lifecycle the plan's "Verificare" calls for:
//   register_asset(video) → add_video → add_tween → render_preview_frame
// driven entirely through `dispatchTool` (the same path the real server and the
// editor bridge use), with a fake skia so the native binary isn't needed. The
// rest cover §S9: asset must exist and be video, trim/timing invariants reject
// at add/update time, a clip past the composition end warns (never errors),
// remove_item / move_item_to_layer work on a video like any item, and
// list_engine_capabilities advertises video.

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { FakeContext } from "../engine/fakeContext.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

// Minimal skia stand-in: a Canvas that hands back a FakeContext and emits a
// PNG-signatured buffer. The preview loader skips video assets (they aren't
// canvas resources), so loadImage is never called for a video-only comp.
function makeFakeSkia() {
  class Canvas {
    width: number;
    height: number;
    ctx = new FakeContext();
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(): FakeContext {
      return this.ctx;
    }
    async toBuffer(): Promise<Uint8Array> {
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    }
  }
  return {
    Canvas,
    loadImage: async (src: string) => ({ src }),
    FontLibrary: { use: () => undefined },
  };
}

function freshDeps(duration = 30): ToolDeps {
  const store = new CompositionStore();
  store.createComposition({ width: 1920, height: 1080, fps: 30, duration });
  return { store, skiaCanvas: makeFakeSkia() as never };
}

// Register a video asset directly on the store with injected metadata so the
// duration-bound checks and the natural placement warning are exercisable
// without ffprobe in CI.
function withVideoAsset(
  deps: ToolDeps,
  id: string,
  opts: { src?: string; duration?: number; width?: number; height?: number } = {},
): void {
  deps.store.registerAsset({
    id,
    type: "video",
    src: opts.src ?? `${id}.mp4`,
    ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
    ...(opts.width !== undefined ? { width: opts.width } : {}),
    ...(opts.height !== undefined ? { height: opts.height } : {}),
  });
}

async function call(
  name: string,
  args: Record<string, unknown>,
  deps: ToolDeps,
) {
  return dispatchTool(getTool(name), args, deps);
}

describe("video item tools — add_video → add_tween → render preview frame", () => {
  it("builds a video+audio+tween composition end-to-end via MCP and renders a frame", async () => {
    const deps = freshDeps(10);
    withVideoAsset(deps, "clip", { duration: 12, width: 1280, height: 720 });
    deps.store.registerAsset({ id: "music", type: "audio", src: "music.mp3" });

    const layer = await call("add_layer", { z: 0 }, deps);
    expect(layer.ok).toBe(true);
    if (!layer.ok) return;
    const layerId = (layer.result as { layerId: string }).layerId;

    // add_video with an explicit trim + window inside the composition.
    const added = await call(
      "add_video",
      {
        layerId,
        asset: "clip",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        start: 0,
        end: 8,
        trimIn: 1,
        trimOut: 9,
        fit: "cover",
        loop: true,
      },
      deps,
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const { itemId } = added.result as { itemId: string };
    expect(itemId).toBe("item-1");
    // Fully inside [0, 10) → no warnings key.
    expect(added.result).toEqual({ itemId: "item-1" });

    // An external audio track alongside the video (deliverable: video + audio).
    const track = await call("add_audio_track", { asset: "music", start: 0, end: 8 }, deps);
    expect(track.ok).toBe(true);

    // Tweens compatible via the existing add_tween (x, y, opacity, width, height).
    for (const t of [
      { property: "transform.x", from: 0, to: 200, start: 0, duration: 1 },
      { property: "transform.opacity", from: 0, to: 1, start: 0, duration: 0.5 },
      { property: "width", from: 1920, to: 960, start: 1, duration: 2 },
    ]) {
      const tw = await call("add_tween", { target: itemId, ...t }, deps);
      expect(tw.ok).toBe(true);
    }

    // render_preview_frame validates first, so a clean render proves the video
    // item the tools built passes the semantic validator (E_VIDEO_RANGE-free).
    const frame = await call("render_preview_frame", { time: 4 }, deps);
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;
    const result = frame.result as { image: string; mimeType: string; width: number; height: number };
    expect(result.mimeType).toBe("image/png");
    expect(result.image.startsWith("iVBORw")).toBe(true);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  it("defaults width/height to the composition and start to 0 when omitted", async () => {
    const deps = freshDeps(10);
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "L" }, deps);

    const added = await call("add_video", { layerId: "L", asset: "clip", x: 0, y: 0 }, deps);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const itemId = (added.result as { itemId: string }).itemId;

    const comp = await call("get_composition", {}, deps);
    expect(comp.ok).toBe(true);
    if (!comp.ok) return;
    const item = (comp.result as { json: { items: Record<string, Record<string, unknown>> } }).json.items[itemId]!;
    expect(item.type).toBe("video");
    expect(item.width).toBe(1920);
    expect(item.height).toBe(1080);
    expect(item.start).toBe(0);
    expect(item.fit).toBe("contain");
    expect(item.loop).toBe(false);
  });

  it("drops the clip on the topmost layer when layerId is omitted", async () => {
    const deps = freshDeps(10);
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "bg" }, deps);
    await call("add_layer", { z: 10, id: "fg" }, deps);

    const added = await call("add_video", { asset: "clip", x: 0, y: 0 }, deps);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const itemId = (added.result as { itemId: string }).itemId;

    const comp = await call("get_composition", {}, deps);
    if (!comp.ok) return;
    const fg = (comp.result as { json: { layers: Array<{ id: string; items: string[] }> } }).json.layers.find(
      (l) => l.id === "fg",
    )!;
    expect(fg.items).toContain(itemId);
  });
});

describe("video item tools — update_video, move, remove", () => {
  async function withVideo(deps: ToolDeps): Promise<string> {
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const added = await call("add_video", { layerId: "L", asset: "clip", x: 0, y: 0 }, deps);
    if (!added.ok) throw new Error("add_video failed");
    return (added.result as { itemId: string }).itemId;
  }

  it("patches spatial, temporal, display and flag fields in one call", async () => {
    const deps = freshDeps(30);
    const id = await withVideo(deps);

    const out = await call(
      "update_video",
      {
        id,
        props: {
          x: 50,
          width: 640,
          start: 2,
          end: 10,
          trimIn: 1,
          trimOut: 6,
          fit: "fill",
          loop: true,
          // `name` is accepted by update_video (stored on the item); note
          // cloneItem/toJSON does not serialise `name` for any item type, so it
          // is intentionally not asserted on the round-tripped JSON below.
          name: "Hero clip",
        },
      },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual({ ok: true });

    const comp = await call("get_composition", {}, deps);
    if (!comp.ok) return;
    const item = (comp.result as { json: { items: Record<string, Record<string, unknown>> } }).json.items[id]!;
    expect(item).toMatchObject({
      type: "video",
      width: 640,
      start: 2,
      end: 10,
      trimIn: 1,
      trimOut: 6,
      fit: "fill",
      loop: true,
    });
    expect((item.transform as { x: number }).x).toBe(50);
  });

  it("move_item_to_layer relocates a video item", async () => {
    const deps = freshDeps(30);
    const id = await withVideo(deps);
    await call("add_layer", { z: 5, id: "L2" }, deps);

    const moved = await call("move_item_to_layer", { itemId: id, targetLayerId: "L2" }, deps);
    expect(moved.ok).toBe(true);

    const comp = await call("get_composition", {}, deps);
    if (!comp.ok) return;
    const layers = (comp.result as { json: { layers: Array<{ id: string; items: string[] }> } }).json.layers;
    expect(layers.find((l) => l.id === "L")!.items).not.toContain(id);
    expect(layers.find((l) => l.id === "L2")!.items).toContain(id);
  });

  it("remove_item drops the video and cascades its tweens", async () => {
    const deps = freshDeps(30);
    const id = await withVideo(deps);
    await call("add_tween", { target: id, property: "transform.x", from: 0, to: 10, start: 0, duration: 1 }, deps);

    const removed = await call("remove_item", { id }, deps);
    expect(removed.ok).toBe(true);

    const comp = await call("get_composition", {}, deps);
    if (!comp.ok) return;
    const json = (comp.result as { json: { items: Record<string, unknown>; tweens: unknown[] } }).json;
    expect(id in json.items).toBe(false);
    expect(json.tweens).toEqual([]);
  });

  it("update_video on a non-video item is E_INVALID_PROPERTY", async () => {
    const deps = freshDeps(30);
    await call("add_layer", { z: 0, id: "L" }, deps);
    const sprite = await call(
      "add_shape",
      { layerId: "L", kind: "rect", x: 0, y: 0, width: 10, height: 10 },
      deps,
    );
    if (!sprite.ok) return;
    const id = (sprite.result as { itemId: string }).itemId;

    const out = await call("update_video", { id, props: { fit: "cover" } }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_PROPERTY");
  });
});

describe("video item tools — asset validation", () => {
  it("rejects a video referencing an unregistered asset (E_NOT_FOUND)", async () => {
    const deps = freshDeps();
    await call("add_layer", { z: 0, id: "L" }, deps);
    const out = await call("add_video", { layerId: "L", asset: "ghost", x: 0, y: 0 }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_NOT_FOUND");
  });

  it("rejects a video referencing a non-video asset (E_ASSET_TYPE_MISMATCH)", async () => {
    const deps = freshDeps();
    await call("add_layer", { z: 0, id: "L" }, deps);
    deps.store.registerAsset({ id: "pic", type: "image", src: "pic.png" });
    const out = await call("add_video", { layerId: "L", asset: "pic", x: 0, y: 0 }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_ASSET_TYPE_MISMATCH");
  });

  it("re-checks the asset type when update_video changes it", async () => {
    const deps = freshDeps();
    withVideoAsset(deps, "clip", { duration: 12 });
    deps.store.registerAsset({ id: "pic", type: "image", src: "pic.png" });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const added = await call("add_video", { layerId: "L", asset: "clip", x: 0, y: 0 }, deps);
    if (!added.ok) return;
    const id = (added.result as { itemId: string }).itemId;

    const out = await call("update_video", { id, props: { asset: "pic" } }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_ASSET_TYPE_MISMATCH");
  });

  it("blocks remove_asset while a video item still references it", async () => {
    const deps = freshDeps();
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    await call("add_video", { layerId: "L", asset: "clip", x: 0, y: 0 }, deps);
    const out = await call("remove_asset", { id: "clip" }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_ASSET_IN_USE");
  });
});

describe("video item tools — trim/timing validation", () => {
  it("rejects an empty trim window trimIn >= trimOut (E_INVALID_VALUE)", async () => {
    const deps = freshDeps();
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const out = await call(
      "add_video",
      { layerId: "L", asset: "clip", x: 0, y: 0, trimIn: 5, trimOut: 5 },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
  });

  it("rejects trimOut past the asset duration (E_INVALID_VALUE)", async () => {
    const deps = freshDeps();
    withVideoAsset(deps, "clip", { duration: 5 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const out = await call(
      "add_video",
      { layerId: "L", asset: "clip", x: 0, y: 0, trimOut: 8 },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
  });

  it("rejects end <= start (E_INVALID_VALUE)", async () => {
    const deps = freshDeps();
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const out = await call(
      "add_video",
      { layerId: "L", asset: "clip", x: 0, y: 0, start: 5, end: 5 },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
  });

  it("re-validates the trim window on update_video", async () => {
    const deps = freshDeps();
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const added = await call(
      "add_video",
      { layerId: "L", asset: "clip", x: 0, y: 0, trimIn: 0, trimOut: 4 },
      deps,
    );
    if (!added.ok) return;
    const id = (added.result as { itemId: string }).itemId;

    const out = await call("update_video", { id, props: { trimIn: 5 } }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
  });

  it("add_tween rejects a non-tweenable video property (E_INVALID_PROPERTY)", async () => {
    const deps = freshDeps();
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const added = await call("add_video", { layerId: "L", asset: "clip", x: 0, y: 0 }, deps);
    if (!added.ok) return;
    const id = (added.result as { itemId: string }).itemId;

    const out = await call(
      "add_tween",
      { target: id, property: "trimIn", from: 0, to: 2, start: 0, duration: 1 },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_PROPERTY");
  });
});

describe("video item tools — past-composition-end warnings (not errors)", () => {
  it("warns (but succeeds) when an explicit end runs past the composition", async () => {
    const deps = freshDeps(10);
    withVideoAsset(deps, "clip", { duration: 30 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const out = await call(
      "add_video",
      { layerId: "L", asset: "clip", x: 0, y: 0, start: 0, end: 25 },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { itemId: string; warnings?: string[] };
    expect(result.itemId).toBe("item-1");
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toMatch(/past the composition end/i);
  });

  it("warns when the clip starts at or after the composition end", async () => {
    const deps = freshDeps(10);
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const out = await call(
      "add_video",
      { layerId: "L", asset: "clip", x: 0, y: 0, start: 12 },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { warnings?: string[] };
    expect(result.warnings![0]).toMatch(/at or past the composition end/i);
  });

  it("does not warn when the clip fits inside the composition", async () => {
    const deps = freshDeps(30);
    withVideoAsset(deps, "clip", { duration: 12 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const out = await call(
      "add_video",
      { layerId: "L", asset: "clip", x: 0, y: 0, start: 1, end: 9 },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toEqual({ itemId: "item-1" });
  });

  it("re-evaluates the warning on update_video", async () => {
    const deps = freshDeps(10);
    withVideoAsset(deps, "clip", { duration: 30 });
    await call("add_layer", { z: 0, id: "L" }, deps);
    const added = await call(
      "add_video",
      { layerId: "L", asset: "clip", x: 0, y: 0, start: 0, end: 8 },
      deps,
    );
    if (!added.ok) return;
    const id = (added.result as { itemId: string }).itemId;

    const out = await call("update_video", { id, props: { end: 40 } }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const result = out.result as { ok: true; warnings?: string[] };
    expect(result.warnings![0]).toMatch(/past the composition end/i);
  });
});

describe("video item tools — capabilities", () => {
  it("list_engine_capabilities reports video support", async () => {
    const deps = freshDeps();
    const out = await call("list_engine_capabilities", {}, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const caps = out.result as {
      itemTypes: string[];
      video?: { items: boolean; extensions: string[]; fitModes: string[]; loop: boolean };
      tweenable: Record<string, Array<{ path: string }>>;
    };
    expect(caps.itemTypes).toContain("video");
    expect(caps.video?.items).toBe(true);
    expect(caps.video?.extensions).toEqual([".mp4", ".mov", ".webm", ".mkv"]);
    expect(caps.video?.fitModes).toEqual(["cover", "contain", "fill", "none"]);
    expect(caps.video?.loop).toBe(true);
    const videoPaths = caps.tweenable.video!.map((d) => d.path);
    expect(videoPaths).toContain("transform.x");
    expect(videoPaths).toContain("width");
    expect(videoPaths).toContain("height");
  });
});
