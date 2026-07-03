// Unit tests for CompositionStore. Cover the structural invariants the
// design doc §4 expects from the MCP layer:
//   - default compositionId resolution
//   - duplicate id rejection
//   - tween overlap detection (matches validator §3.5.5)
//   - asset-in-use rejection
//   - layer cascade
//   - tween cascade on item removal
//
// The store sits below the MCP transport, so we drive it directly here —
// transport-shaped behaviour is covered by the spawn integration test.

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  MCPToolError,
} from "../../src/mcp/index.js";

function makeStore(width = 100, height = 100): {
  store: CompositionStore;
  compositionId: string;
} {
  const store = new CompositionStore();
  const compositionId = store.createComposition({
    width,
    height,
    fps: 30,
    duration: 1,
  });
  return { store, compositionId };
}

describe("CompositionStore — composition lifecycle", () => {
  it("falls back to the default composition when compositionId is omitted", () => {
    const { store, compositionId } = makeStore();
    expect(store.getDefaultId()).toBe(compositionId);
    const layerId = store.addLayer({ z: 0 });
    expect(store.toJSON().layers.find((l) => l.id === layerId)).toBeDefined();
  });

  it("throws E_DUPLICATE_ID when creating a composition with an id already in use", () => {
    const store = new CompositionStore();
    store.createComposition({ width: 10, height: 10, fps: 1, duration: 1, id: "x" });
    expect(() =>
      store.createComposition({ width: 10, height: 10, fps: 1, duration: 1, id: "x" }),
    ).toThrow(MCPToolError);
  });

  it("throws E_NO_COMPOSITION when there is no composition (default or named)", () => {
    const store = new CompositionStore();
    expect(() => store.toJSON()).toThrow(/E_NO_COMPOSITION|No composition/i);
    expect(() => store.addLayer({ z: 0 })).toThrow(MCPToolError);
  });

  it("reset({id}) drops only the named composition; reset() drops all", () => {
    const store = new CompositionStore();
    store.createComposition({ width: 1, height: 1, fps: 1, duration: 1, id: "a" });
    store.createComposition({ width: 1, height: 1, fps: 1, duration: 1, id: "b" });
    store.reset("a");
    expect(store.hasComposition("a")).toBe(false);
    expect(store.hasComposition("b")).toBe(true);
    store.reset();
    expect(store.hasComposition("b")).toBe(false);
    expect(store.getDefaultId()).toBeNull();
  });

  it("set_composition_property updates meta and rejects bad values", () => {
    const { store } = makeStore();
    store.setMetaProperty("fps", 60);
    expect(store.toJSON().composition.fps).toBe(60);
    expect(() => store.setMetaProperty("fps", -1)).toThrow(MCPToolError);
    expect(() => store.setMetaProperty("background", "")).toThrow(MCPToolError);
  });
});

describe("CompositionStore — assets", () => {
  it("rejects removing an asset that is in use by a sprite", () => {
    const { store } = makeStore();
    store.registerAsset({ id: "logo", type: "image", src: "logo.png" });
    const layerId = store.addLayer({ z: 0 });
    store.addSprite({
      layerId,
      asset: "logo",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(() => store.removeAsset("logo")).toThrow(MCPToolError);
    try {
      store.removeAsset("logo");
    } catch (err) {
      expect((err as MCPToolError).code).toBe("E_ASSET_IN_USE");
      expect((err as MCPToolError).hint).toBeDefined();
    }
  });

  it("rejects removing an asset that is in use as a font", () => {
    const { store } = makeStore();
    store.registerAsset({ id: "f", type: "font", src: "f.ttf", family: "F" });
    const layerId = store.addLayer({ z: 0 });
    store.addText({
      layerId,
      text: "hi",
      font: "f",
      fontSize: 12,
      color: "#fff",
      x: 0,
      y: 0,
    });
    expect(() => store.removeAsset("f")).toThrow(MCPToolError);
  });

  it("rejects font registration without family", () => {
    const { store } = makeStore();
    expect(() =>
      store.registerAsset({ id: "f", type: "font", src: "f.ttf" }),
    ).toThrow(/family/);
  });

  it("registers an audio asset with probed metadata and round-trips it through toJSON", () => {
    const { store } = makeStore();
    store.registerAsset({
      id: "vo",
      type: "audio",
      src: "voiceover.mp3",
      duration: 12.5,
      sampleRate: 44100,
      channels: 2,
      codec: "mp3",
    });
    expect(store.listAssets()).toContainEqual({
      id: "vo",
      type: "audio",
      src: "voiceover.mp3",
      duration: 12.5,
      sampleRate: 44100,
      channels: 2,
      codec: "mp3",
    });
    // Cloned on the way out — the serialised composition carries the metadata.
    expect(store.toJSON().assets).toContainEqual(
      expect.objectContaining({ id: "vo", type: "audio", codec: "mp3", channels: 2 }),
    );
  });

  it("registers an audio asset with no metadata (ffprobe-less path)", () => {
    const { store } = makeStore();
    store.registerAsset({ id: "music", type: "audio", src: "bed.wav" });
    const asset = store.listAssets().find((a) => a.id === "music");
    expect(asset).toEqual({ id: "music", type: "audio", src: "bed.wav" });
    // No spurious undefined metadata keys leak into the registry.
    expect(Object.keys(asset!).sort()).toEqual(["id", "src", "type"]);
  });

  it("rejects an audio asset whose src has an unsupported extension", () => {
    const { store } = makeStore();
    expect(() =>
      store.registerAsset({ id: "x", type: "audio", src: "notes.txt" }),
    ).toThrow(MCPToolError);
    try {
      store.registerAsset({ id: "x", type: "audio", src: "notes.txt" });
    } catch (err) {
      expect((err as MCPToolError).code).toBe("E_INVALID_VALUE");
    }
  });

  it("accepts every supported audio extension (case-insensitive)", () => {
    const { store } = makeStore();
    for (const [i, src] of [
      "a.mp3",
      "b.WAV",
      "c.aac",
      "d.M4A",
      "e.ogg",
    ].entries()) {
      expect(() =>
        store.registerAsset({ id: `aud${i}`, type: "audio", src }),
      ).not.toThrow();
    }
    expect(store.listAssets().filter((a) => a.type === "audio")).toHaveLength(5);
  });
});

describe("CompositionStore — layers", () => {
  it("removeLayer requires cascade=true when layer is non-empty", () => {
    const { store } = makeStore();
    const layerId = store.addLayer({ z: 0 });
    store.addShape({ layerId, kind: "rect", x: 0, y: 0, width: 5, height: 5 });
    try {
      store.removeLayer(layerId, false);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as MCPToolError).code).toBe("E_LAYER_NOT_EMPTY");
    }
    store.removeLayer(layerId, true);
    expect(store.toJSON().layers).toEqual([]);
    expect(Object.keys(store.toJSON().items)).toEqual([]);
  });
});

describe("CompositionStore — items", () => {
  it("update_item rejects keys that don't apply to the item type", () => {
    const { store } = makeStore();
    const layerId = store.addLayer({ z: 0 });
    const shapeId = store.addShape({
      layerId,
      kind: "rect",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    expect(() =>
      store.updateItem(shapeId, { text: "hello" }),
    ).toThrow(/E_INVALID_PROPERTY|cannot be set/);
  });

  it("move_item_to_layer relocates the item between layers", () => {
    const { store } = makeStore();
    const a = store.addLayer({ z: 0 });
    const b = store.addLayer({ z: 1 });
    const id = store.addShape({
      layerId: a,
      kind: "rect",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    store.moveItemToLayer(id, b);
    const json = store.toJSON();
    expect(json.layers.find((l) => l.id === a)?.items).toEqual([]);
    expect(json.layers.find((l) => l.id === b)?.items).toEqual([id]);
  });

  it("remove_item cascades: drops the item from its layer + any tween targeting it", () => {
    const { store } = makeStore();
    const layerId = store.addLayer({ z: 0 });
    const id = store.addShape({
      layerId,
      kind: "rect",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    store.addTween({
      target: id,
      property: "transform.x",
      from: 0,
      to: 10,
      start: 0,
      duration: 0.5,
    });
    store.removeItem(id);
    const json = store.toJSON();
    expect(json.tweens).toEqual([]);
    expect(json.layers[0]?.items ?? []).toEqual([]);
  });
});

describe("CompositionStore — tweens", () => {
  it("rejects overlapping tweens on (target, property)", () => {
    const { store } = makeStore();
    const layerId = store.addLayer({ z: 0 });
    const id = store.addShape({
      layerId,
      kind: "rect",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    store.addTween({
      target: id,
      property: "transform.x",
      from: 0,
      to: 10,
      start: 0,
      duration: 0.5,
    });
    expect(() =>
      store.addTween({
        target: id,
        property: "transform.x",
        from: 10,
        to: 20,
        start: 0.4,
        duration: 0.5,
      }),
    ).toThrow(/E_TWEEN_OVERLAP|overlap/i);
  });

  it("allows tweens that touch at endpoints", () => {
    const { store } = makeStore();
    const layerId = store.addLayer({ z: 0 });
    const id = store.addShape({
      layerId,
      kind: "rect",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    store.addTween({
      target: id,
      property: "transform.x",
      from: 0,
      to: 10,
      start: 0,
      duration: 0.5,
    });
    expect(() =>
      store.addTween({
        target: id,
        property: "transform.x",
        from: 10,
        to: 20,
        start: 0.5,
        duration: 0.5,
      }),
    ).not.toThrow();
  });

  // R-25 repro: 5.2 + 0.4 sums to 5.6000000000000005 in IEEE-754, so a tween
  // authored to start exactly where the previous one ends was being rejected
  // as an overlap. The MCP layer now shares the validator's OVERLAP_EPS.
  it("allows a tween starting exactly where a chained FP-noisy end lands", () => {
    const { store } = makeStore();
    const layerId = store.addLayer({ z: 0 });
    const id = store.addShape({
      layerId,
      kind: "rect",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    store.addTween({
      target: id,
      property: "transform.x",
      from: 0,
      to: 10,
      start: 5.2,
      duration: 0.4, // start + duration === 5.6000000000000005
    });
    expect(() =>
      store.addTween({
        target: id,
        property: "transform.x",
        from: 10,
        to: 20,
        start: 5.6,
        duration: 0.4,
      }),
    ).not.toThrow();
  });

  it("rejects color values on numeric properties and vice versa", () => {
    const { store } = makeStore();
    const layerId = store.addLayer({ z: 0 });
    const id = store.addShape({
      layerId,
      kind: "rect",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      fillColor: "#ff0000",
    });
    expect(() =>
      store.addTween({
        target: id,
        property: "transform.x",
        from: "#000",
        to: "#fff",
        start: 0,
        duration: 0.5,
      }),
    ).toThrow(MCPToolError);
    expect(() =>
      store.addTween({
        target: id,
        property: "fillColor",
        from: 0,
        to: 1,
        start: 0,
        duration: 0.5,
      }),
    ).toThrow(MCPToolError);
  });

  it("list_tweens filters by target and/or property", () => {
    const { store } = makeStore();
    const layerId = store.addLayer({ z: 0 });
    const a = store.addShape({
      layerId,
      kind: "rect",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    const b = store.addShape({
      layerId,
      kind: "rect",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    store.addTween({
      target: a,
      property: "transform.x",
      from: 0,
      to: 1,
      start: 0,
      duration: 0.1,
    });
    store.addTween({
      target: a,
      property: "transform.y",
      from: 0,
      to: 1,
      start: 0,
      duration: 0.1,
    });
    store.addTween({
      target: b,
      property: "transform.x",
      from: 0,
      to: 1,
      start: 0,
      duration: 0.1,
    });
    expect(store.listTweens({ target: a })).toHaveLength(2);
    expect(store.listTweens({ property: "transform.x" })).toHaveLength(2);
    expect(store.listTweens({ target: a, property: "transform.x" })).toHaveLength(1);
    expect(store.listTweens()).toHaveLength(3);
  });
});

describe("CompositionStore — toJSON shape", () => {
  it("emits a Composition JSON parseable by validate()", () => {
    const { store } = makeStore(50, 50);
    const layerId = store.addLayer({ z: 0 });
    store.addShape({
      layerId,
      kind: "rect",
      x: 25,
      y: 25,
      width: 10,
      height: 10,
      fillColor: "#fff",
    });
    const result = store.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
