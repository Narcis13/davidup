// Strict composition schema with `$` / `x-` extension keys (v1.1 S23, R-23).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { precompile } from "../../src/compose/precompile.js";
import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
} from "../../src/mcp/index.js";
import { suggestKey } from "../../src/schema/strict.js";
import { validate } from "../../src/schema/validator.js";
import { baseComposition } from "./fixtures.js";

type Json = Record<string, any>;

function comp(): Json {
  return baseComposition() as Json;
}

describe("strict schema — typo detection", () => {
  it("reports a typo'd transform key at its full path with a suggestion", () => {
    const c = comp();
    c.items["logo-sprite"].transform.opacty = 0.5;
    const result = validate(c);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: "E_SCHEMA",
      path: "items.logo-sprite.transform.opacty",
    });
    expect(result.errors[0]!.message).toContain('did you mean "opacity"?');
  });

  it("suggests across case (cornerradius → cornerRadius)", () => {
    const c = comp();
    c.items.box = {
      type: "shape",
      kind: "rect",
      width: 10,
      height: 10,
      cornerradius: 4,
      transform: { ...c.items["bg-sprite"].transform },
    };
    c.layers[0].items.push("box");
    const result = validate(c);
    expect(result.errors[0]!.path).toBe("items.box.cornerradius");
    expect(result.errors[0]!.message).toContain('did you mean "cornerRadius"?');
  });

  it("flags unknown keys on every level: root, meta, asset, layer, tween, audio", () => {
    const c = comp();
    c.titel = "x";
    c.composition.bg = "#000";
    c.assets[0].source = "./a.png";
    c.layers[0].opactiy = 1;
    c.tweens.push({
      id: "t1",
      target: "logo-sprite",
      property: "transform.opacity",
      from: 0,
      to: 1,
      start: 0,
      duration: 1,
      ease: "linear",
    });
    c.audio = [{ asset: "a", start: 0, volum: 1 }];
    const paths = validate(c).errors.map((e) => e.path).sort();
    expect(paths).toEqual(
      [
        "assets.0.source",
        "audio.0.volum",
        "composition.bg",
        "layers.0.opactiy",
        "titel",
        "tweens.1.ease",
      ].sort(),
    );
  });

  it("lists every unknown key when an object has several", () => {
    const c = comp();
    Object.assign(c.items["title-text"], { fontsize: 10, colour: "#fff" });
    const [error] = validate(c).errors;
    expect(error!.path).toBe("items.title-text");
    expect(error!.message).toMatch(/Unknown keys "fontsize" \(did you mean "fontSize"\?\), "colour" \(did you mean "color"\?\)/);
  });

  it("offers no suggestion for an unrelated key", () => {
    expect(suggestKey("banana", ["x", "y", "opacity"])).toBeUndefined();
    const c = comp();
    c.items["bg-sprite"].banana = 1;
    expect(validate(c).errors[0]!.message).not.toContain("did you mean");
  });
});

describe("strict schema — extension keys pass through", () => {
  it("allows $- and x- keys at every level", () => {
    const c = comp();
    c.$comment = ["notes"];
    c["x-author"] = "me";
    c.composition["x-preset"] = "1080p";
    c.assets[0]["x-license"] = "CC0";
    c.layers[0].$comment = "bg";
    c.items["logo-sprite"]["x-editor"] = { pinned: true };
    c.items["logo-sprite"].transform["x-note"] = 1;
    c.items["title-text"].$comment = "title";
    const result = validate(c);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("still reports a real typo next to an extension key, without naming the extension", () => {
    const c = comp();
    c.items["logo-sprite"]["x-editor"] = 1;
    c.items["logo-sprite"].widht = 400;
    const result = validate(c);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.path).toBe("items.logo-sprite.widht");
    expect(result.errors[0]!.message).not.toContain("x-editor");
  });

  it("does not mutate the input", () => {
    const c = comp();
    c["x-author"] = "me";
    c.items["logo-sprite"]["x-editor"] = 1;
    validate(c);
    expect(c["x-author"]).toBe("me");
    expect(c.items["logo-sprite"]["x-editor"]).toBe(1);
  });

  it("treats record keys as ids, not extensions — an `x-` item id is still checked", () => {
    const c = comp();
    c.items["x-logo"] = { ...c.items["logo-sprite"], tnit: "#fff" };
    c.layers[1].items.push("x-logo");
    const result = validate(c);
    expect(result.errors.map((e) => e.path)).toEqual(["items.x-logo.tnit"]);
    expect(result.errors[0]!.message).toContain('did you mean "tint"?');
  });
});

describe("strict schema — examples still validate", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");
  const files = [
    "hello-world.json",
    "two-templates-30s.json",
    "comprehensive-composition.json",
    "comprehensive-browser/composition.json",
    "comprehensive-split/comprehensive.json",
    "ball-showcase-60s/composition.json",
    "four-scenes-60s/composition.json",
    "davidup-demo-90s/composition.json",
    "editor-demo/composition.json",
    "launch-video/composition.json",
  ];

  it.each(files)("%s", async (file) => {
    const sourcePath = join(root, file);
    const raw = JSON.parse(readFileSync(sourcePath, "utf8"));
    const compiled = await precompile(raw, { sourcePath });
    const errors = validate(compiled).errors.filter((e) => e.code === "E_SCHEMA");
    expect(errors).toEqual([]);
  });
});

describe("MCP — unknown props are E_INVALID_PROPERTY", () => {
  function tool(name: string): ToolDef {
    const found = TOOLS.find((t) => t.name === name);
    if (!found) throw new Error(`tool ${name} not registered`);
    return found;
  }

  async function setup() {
    const deps = { store: new CompositionStore() };
    await dispatchTool(tool("create_composition"), { width: 100, height: 100, fps: 10, duration: 1 }, deps);
    await dispatchTool(tool("add_layer"), { id: "L", z: 0 }, deps);
    await dispatchTool(tool("add_shape"), { layerId: "L", id: "box", kind: "rect", x: 0, y: 0, width: 10, height: 10 }, deps);
    return deps;
  }

  it("update_item rejects a typo'd prop with a suggestion instead of dropping it", async () => {
    const deps = await setup();
    const out = await dispatchTool(tool("update_item"), { id: "box", props: { opacty: 0.5 } }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_PROPERTY");
    expect(out.error.message).toContain('Unknown key "opacty" (did you mean "opacity"?)');
    expect(deps.store.toJSON().items.box!.transform.opacity).toBe(1);
  });

  it("update_video rejects an unknown prop the same way", async () => {
    const deps = await setup();
    const out = await dispatchTool(tool("update_video"), { id: "box", props: { trimin: 1 } }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_PROPERTY");
    expect(out.error.message).toContain('did you mean "trimIn"?');
  });
});
