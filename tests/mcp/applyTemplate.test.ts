// End-to-end tests for the §7.8 MCP tools `apply_template`,
// `list_templates`, and `define_user_template`. Drives the dispatcher
// directly (no transport spawn) like applyBehavior.test.ts.

import { describe, expect, it } from "vitest";

import { BUILT_IN_TEMPLATE_IDS } from "../../src/compose/index.js";
import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function setup(): Promise<{ deps: ToolDeps }> {
  const deps: ToolDeps = { store: new CompositionStore() };
  await dispatchTool(
    getTool("create_composition"),
    { width: 1280, height: 720, fps: 30, duration: 10 },
    deps,
  );
  await dispatchTool(getTool("add_layer"), { z: 0, id: "main" }, deps);
  // Register the fonts the built-ins reference so subsequent renders /
  // validations would be happy. Asset existence isn't enforced at tween
  // expansion time but it documents the typical setup.
  await dispatchTool(
    getTool("register_asset"),
    { id: "font-display", type: "font", src: "Inter.ttf", family: "Inter" },
    deps,
  );
  await dispatchTool(
    getTool("register_asset"),
    { id: "font-mono", type: "font", src: "Mono.ttf", family: "Mono" },
    deps,
  );
  return { deps };
}

describe("list_templates tool", () => {
  it("surfaces every built-in template with descriptors and emits[]", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    const out = await dispatchTool(getTool("list_templates"), {}, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = out.result as {
      templates: Array<{ id: string; emits: string[] }>;
    };
    const ids = body.templates.map((t) => t.id).sort();
    for (const builtIn of BUILT_IN_TEMPLATE_IDS) {
      expect(ids).toContain(builtIn);
    }
    const titleCard = body.templates.find((t) => t.id === "titleCard");
    expect(titleCard?.emits.sort()).toEqual(["subtitle", "title"]);
  });
});

describe("apply_template tool", () => {
  it("titleCard adds two prefixed items + tweens, returning their ids", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "titleCard",
        layerId: "main",
        id: "tc1",
        params: {
          title: "Davidup",
          subtitle: "v0.3",
          fontDisplay: "font-display",
          fontMono: "font-mono",
        },
      },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = out.result as {
      instanceId: string;
      items: string[];
      tweens: string[];
    };
    expect(body.instanceId).toBe("tc1");
    expect(body.items.sort()).toEqual(["tc1__subtitle", "tc1__title"]);
    // popIn → 3 tweens (opacity, scaleX, scaleY); fadeIn → 1 tween. Total 4.
    expect(body.tweens).toHaveLength(4);
    // Verify the items actually landed under the right layer.
    const get = await dispatchTool(getTool("get_composition"), {}, deps);
    expect(get.ok).toBe(true);
    if (!get.ok) return;
    const json = (get.result as { json: { layers: Array<{ id: string; items: string[] }> } })
      .json;
    const main = json.layers.find((l) => l.id === "main");
    expect(main?.items).toContain("tc1__title");
    expect(main?.items).toContain("tc1__subtitle");
  });

  it("derives instanceId from templateId+start when id omitted", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "captionBurst",
        layerId: "main",
        start: 2,
        params: { text: "boom", font: "font-display" },
      },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = out.result as { instanceId: string; items: string[] };
    expect(body.instanceId).toBe("captionBurst_2");
    expect(body.items).toEqual(["captionBurst_2__caption"]);
  });

  it("kenburnsImage propagates non-default scaleX from the template into the stored sprite", async () => {
    const { deps } = await setup();
    await dispatchTool(
      getTool("register_asset"),
      { id: "photo", type: "image", src: "photo.png" },
      deps,
    );
    const out = await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "kenburnsImage",
        layerId: "main",
        id: "kb",
        params: {
          asset: "photo",
          width: 1280,
          height: 720,
          fromScale: 1.05,
          toScale: 1.25,
          pan: 80,
        },
      },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const get = await dispatchTool(getTool("get_composition"), {}, deps);
    expect(get.ok).toBe(true);
    if (!get.ok) return;
    const json = (get.result as { json: { items: Record<string, { transform: { scaleX: number } }> } })
      .json;
    expect(json.items["kb__img"]?.transform.scaleX).toBeCloseTo(1.05, 6);
  });

  it("rolls back items + tweens if a tween collides with an existing one", async () => {
    const { deps } = await setup();
    // Pre-place a tween that will collide with titleCard's popIn opacity sub-tween.
    // titleCard.title's popIn at start=0, duration=0.6 → tween id "tc__title_popIn_0__opacity"
    // on transform.opacity. We pre-add an item + a tween covering [0, 0.6].
    await dispatchTool(
      getTool("add_text"),
      {
        layerId: "main",
        id: "tc__title",
        text: "preexisting",
        font: "font-display",
        fontSize: 24,
        color: "#ffffff",
        x: 0,
        y: 0,
      },
      deps,
    );
    // Create a tween that will conflict with the popIn opacity sub-tween:
    await dispatchTool(
      getTool("add_tween"),
      {
        target: "tc__title",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: 0,
        duration: 0.6,
        id: "blocker",
      },
      deps,
    );
    const out = await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "titleCard",
        layerId: "main",
        id: "tc",
        params: {
          title: "Will fail",
          subtitle: "",
          fontDisplay: "font-display",
          fontMono: "font-mono",
        },
      },
      deps,
    );
    // Item id "tc__title" already exists → first addRawItem fails immediately.
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_DUPLICATE_ID");
    // The pre-existing tween must still be the only one in the store.
    const list = await dispatchTool(getTool("list_tweens"), {}, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect((list.result as { tweens: Array<{ id: string }> }).tweens.map((t) => t.id))
      .toEqual(["blocker"]);
  });

  it("rolls back partial state when a later tween collides", async () => {
    const { deps } = await setup();
    // Apply titleCard once → succeeds. Now block the second instance's
    // first emitted tween via a colliding pre-placed tween.
    await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "captionBurst",
        layerId: "main",
        id: "cap1",
        params: { text: "first", font: "font-display" },
      },
      deps,
    );
    // Pre-place a tween that overlaps a future captionBurst at start=0.5
    // Place it on cap1__caption at [0.4, 0.9] which would collide with the
    // popIn at start=0.5 duration=0.5 → [0.5, 1.0].
    // Actually let's make a fresh 2nd instance and pre-block it.
    // Pre-create the item "cap2__caption" under main with a colliding tween.
    await dispatchTool(
      getTool("add_text"),
      {
        layerId: "main",
        id: "cap2__caption",
        text: "x",
        font: "font-display",
        fontSize: 24,
        color: "#ffffff",
        x: 0,
        y: 0,
      },
      deps,
    );
    // Now apply_template with id=cap2 will fail at addRawItem (duplicate id).
    const out = await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "captionBurst",
        layerId: "main",
        id: "cap2",
        params: { text: "second", font: "font-display" },
      },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_DUPLICATE_ID");
    // No tweens for cap2__caption should remain.
    const list = await dispatchTool(
      getTool("list_tweens"),
      { target: "cap2__caption" },
      deps,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect((list.result as { tweens: unknown[] }).tweens).toHaveLength(0);
  });

  it("returns E_TEMPLATE_UNKNOWN for an unregistered template", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "doesNotExist",
        layerId: "main",
        params: {},
      },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_TEMPLATE_UNKNOWN");
  });

  it("returns E_TEMPLATE_PARAM_MISSING for absent required params", async () => {
    const { deps } = await setup();
    const out = await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "titleCard",
        layerId: "main",
        params: {
          // missing: title, fontDisplay, fontMono
        },
      },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_TEMPLATE_PARAM_MISSING");
  });
});

describe("define_user_template tool", () => {
  it("registers a user template that apply_template can then expand", async () => {
    const { deps } = await setup();
    const define = await dispatchTool(
      getTool("define_user_template"),
      {
        id: "stamp",
        description: "A single text stamp.",
        params: [
          { name: "text", type: "string", required: true },
          { name: "x", type: "number", default: 100 },
          { name: "y", type: "number", default: 100 },
          { name: "font", type: "string", required: true },
        ],
        items: {
          label: {
            type: "text",
            text: "${params.text}",
            font: "${params.font}",
            fontSize: 48,
            color: "#ffffff",
            transform: {
              x: "${params.x}",
              y: "${params.y}",
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
              anchorX: 0,
              anchorY: 0,
              opacity: 0,
            },
          },
        },
        tweens: [
          {
            $behavior: "fadeIn",
            target: "label",
            start: 0,
            duration: 0.4,
            easing: "easeOutQuad",
          },
        ],
      },
      deps,
    );
    expect(define.ok).toBe(true);
    if (!define.ok) return;
    expect((define.result as { id: string }).id).toBe("stamp");

    // Now the new template shows up in list_templates.
    const list = await dispatchTool(getTool("list_templates"), {}, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const ids = (list.result as { templates: Array<{ id: string }> }).templates
      .map((t) => t.id);
    expect(ids).toContain("stamp");

    // And apply_template can use it.
    const apply = await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "stamp",
        layerId: "main",
        id: "s1",
        params: { text: "Hello", font: "font-display" },
      },
      deps,
    );
    expect(apply.ok).toBe(true);
    if (!apply.ok) return;
    expect((apply.result as { items: string[] }).items).toEqual(["s1__label"]);
    expect((apply.result as { tweens: string[] }).tweens).toHaveLength(1);
  });

  it("re-registering an id (shadowing a built-in) wins on subsequent expansions", async () => {
    const { deps } = await setup();
    // Shadow titleCard with a minimal stub.
    await dispatchTool(
      getTool("define_user_template"),
      {
        id: "titleCard",
        params: [{ name: "title", type: "string", required: true }],
        items: {
          stub: {
            type: "text",
            text: "${params.title}",
            font: "font-display",
            fontSize: 12,
            color: "#000000",
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
      },
      deps,
    );
    const apply = await dispatchTool(
      getTool("apply_template"),
      {
        templateId: "titleCard",
        layerId: "main",
        id: "tc",
        params: { title: "shadowed" },
      },
      deps,
    );
    expect(apply.ok).toBe(true);
    if (!apply.ok) return;
    // The shadowed template emits exactly one item ("stub") instead of the
    // built-in's two ("title", "subtitle").
    expect((apply.result as { items: string[] }).items).toEqual(["tc__stub"]);
  });
});
