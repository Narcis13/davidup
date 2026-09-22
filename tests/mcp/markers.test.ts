// Markers through the MCP tools (hand-drawn film 4.0 D4): composition markers
// via set_composition_property, a track's via add/update_audio_track, and both
// kept by replace_composition and toJSON.

import { describe, expect, it } from "vitest";

import { CompositionStore, TOOLS, dispatchTool, type ToolDef, type ToolDeps } from "../../src/mcp/index.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

function freshDeps(): ToolDeps {
  const store = new CompositionStore();
  store.createComposition({ width: 640, height: 360, fps: 30, duration: 10 });
  store.registerAsset({ id: "music", type: "audio", src: "music.wav", duration: 4 });
  return { store };
}

const call = (name: string, args: Record<string, unknown>, deps: ToolDeps) => dispatchTool(getTool(name), args, deps);

describe("composition markers", () => {
  it("set_composition_property sets them sorted, and null drops them", async () => {
    const deps = freshDeps();
    const set = await call(
      "set_composition_property",
      { property: "markers", value: [{ t: 4, name: "b" }, { t: 1, name: "a", source: "hdf:clip" }] },
      deps,
    );
    expect(set).toEqual({ ok: true, result: { ok: true } });
    expect(deps.store.toJSON().composition.markers).toEqual([{ t: 1, name: "a", source: "hdf:clip" }, { t: 4, name: "b" }]);
    expect(deps.store.validate().valid).toBe(true);

    await call("set_composition_property", { property: "markers", value: null }, deps);
    expect(deps.store.toJSON().composition).not.toHaveProperty("markers");
  });

  it("rejects a malformed marker", async () => {
    const deps = freshDeps();
    const r = await call("set_composition_property", { property: "markers", value: [{ t: -1, name: "x" }] }, deps);
    expect(r.ok).toBe(false);
    expect(deps.store.toJSON().composition).not.toHaveProperty("markers");
  });

  it("toJSON hands out copies", () => {
    const deps = freshDeps();
    deps.store.setMetaProperty("markers", [{ t: 1, name: "a" }]);
    deps.store.toJSON().composition.markers![0]!.t = 9;
    expect(deps.store.toJSON().composition.markers).toEqual([{ t: 1, name: "a" }]);
  });
});

describe("audio track markers", () => {
  it("add, replace and drop through the audio tools", async () => {
    const deps = freshDeps();
    const added = await call(
      "add_audio_track",
      { asset: "music", start: 0, loop: true, id: "bed", markers: [{ t: 2, name: "drop" }, { t: 0, name: "beat" }] },
      deps,
    );
    expect(added.ok).toBe(true);
    expect(deps.store.listAudioTracks()[0]!.markers).toEqual([{ t: 0, name: "beat" }, { t: 2, name: "drop" }]);

    await call("update_audio_track", { id: "bed", props: { volume: 0.5 } }, deps);
    expect(deps.store.listAudioTracks()[0]!.markers).toHaveLength(2);

    await call("update_audio_track", { id: "bed", props: { markers: [{ t: 1, name: "one" }] } }, deps);
    expect(deps.store.listAudioTracks()[0]!.markers).toEqual([{ t: 1, name: "one" }]);

    await call("update_audio_track", { id: "bed", props: { markers: [] } }, deps);
    expect(deps.store.listAudioTracks()[0]).not.toHaveProperty("markers");
  });
});

describe("round trips", () => {
  it("replace_composition keeps both kinds", async () => {
    const deps = freshDeps();
    deps.store.setMetaProperty("markers", [{ t: 1, name: "chapter 1", source: "hdf:clip" }]);
    await call("add_audio_track", { asset: "music", start: 0, id: "bed", markers: [{ t: 0.5, name: "beat" }] }, deps);
    const doc = deps.store.toJSON();
    const other = new CompositionStore();
    const r = await dispatchTool(getTool("replace_composition"), { json: doc }, { store: other });
    expect(r.ok).toBe(true);
    expect(other.toJSON()).toEqual(doc);
  });

  it("list_engine_capabilities says where markers go", async () => {
    const r = await call("list_engine_capabilities", {}, freshDeps());
    expect(r.ok && (r.result as { markers: unknown }).markers).toEqual({
      composition: "composition.markers",
      audioTrack: "markers",
      fields: ["t", "name", "source"],
    });
  });
});
