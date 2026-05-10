// Unit tests for the §7 template registry — covers param substitution
// (§7.4), id rewriting (§7.5), time mapping (§7.6), validation errors
// (§7.7), and the `expandTemplates` compile-time walker that wires the
// expansion back into a composition's items/layers/tweens.

import { describe, expect, it } from "vitest";

import {
  expandTemplate,
  expandTemplates,
  type TemplateDefinition,
} from "../../src/compose/templates.js";
import { substitute } from "../../src/compose/params.js";
import { precompile } from "../../src/compose/precompile.js";
import { MCPToolError } from "../../src/mcp/errors.js";

const lowerThird: TemplateDefinition = {
  id: "lowerThird",
  params: [
    { name: "name", type: "string", required: true },
    { name: "role", type: "string", required: true },
    { name: "x", type: "number", default: 120 },
    { name: "y", type: "number", default: 900 },
    { name: "color", type: "color", default: "#ffd166" },
    { name: "fontDisplay", type: "string", required: true },
    { name: "fontMono", type: "string", required: true },
  ],
  items: {
    bar: {
      type: "shape",
      kind: "rect",
      width: 0,
      height: 6,
      fillColor: "${params.color}",
      transform: {
        x: "${params.x}",
        y: "${params.y}",
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 1,
      },
    },
    name: {
      type: "text",
      text: "${params.name}",
      font: "${params.fontDisplay}",
      fontSize: 64,
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
    role: {
      type: "text",
      text: "${params.role}",
      font: "${params.fontMono}",
      fontSize: 24,
      color: "${params.color}",
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
    { $behavior: "fadeIn", target: "name", start: 0.0, duration: 0.4, easing: "easeOutQuad" },
    { $behavior: "fadeIn", target: "role", start: 0.2, duration: 0.4, easing: "easeOutQuad" },
    {
      target: "bar",
      property: "width",
      from: 0,
      to: 360,
      start: 0.0,
      duration: 0.6,
      easing: "easeOutBack",
    },
  ],
};

// ──────────────── substitute (params engine) ────────────────

describe("substitute — whole-string placeholders only", () => {
  it("replaces ${params.X} with the param value, preserving type", () => {
    const out = substitute(
      { x: "${params.x}", label: "${params.name}", flag: "${params.flag}" },
      { params: { x: 42, name: "title", flag: false } },
    );
    expect(out).toEqual({ x: 42, label: "title", flag: false });
  });

  it("leaves partial-match strings unchanged (no string-template mode)", () => {
    const out = substitute("hello ${params.name}", { params: { name: "x" } });
    expect(out).toBe("hello ${params.name}");
  });

  it("recurses into arrays and objects", () => {
    const out = substitute(
      [{ a: "${params.a}" }, { b: ["${params.b}", 3] }],
      { params: { a: 1, b: "two" } },
    );
    expect(out).toEqual([{ a: 1 }, { b: ["two", 3] }]);
  });

  it("supports the ${$.X} meta namespace", () => {
    const out = substitute("${$.start}", { params: {}, meta: { start: 4.5 } });
    expect(out).toBe(4.5);
  });

  it("throws E_TEMPLATE_PARAM_MISSING on unknown param refs", () => {
    expect(() => substitute("${params.bogus}", { params: {} })).toThrow(MCPToolError);
  });
});

// ──────────────── expandTemplate (single instance) ────────────────

describe("expandTemplate — happy path", () => {
  it("substitutes params, prefixes ids, lifts tween starts to global time", () => {
    const ex = expandTemplate(
      "myLT",
      {
        template: "lowerThird",
        params: {
          name: "Narcis",
          role: "Engineer",
          fontDisplay: "font-display",
          fontMono: "font-mono",
        },
        start: 4.5,
      },
      { templates: { lowerThird } },
    );

    // §7.5 — every item id is `${instanceId}__${localId}`.
    expect(Object.keys(ex.items).sort()).toEqual([
      "myLT__bar",
      "myLT__name",
      "myLT__role",
    ]);
    // Defaults flow through param substitution.
    expect((ex.items["myLT__bar"] as any).fillColor).toBe("#ffd166");
    expect((ex.items["myLT__bar"] as any).transform.x).toBe(120);
    expect((ex.items["myLT__name"] as any).text).toBe("Narcis");
    expect((ex.items["myLT__name"] as any).font).toBe("font-display");
    expect((ex.items["myLT__role"] as any).text).toBe("Engineer");

    // Tween targets are rewritten to prefixed ids and starts are lifted.
    const t0 = ex.tweens[0] as Record<string, unknown>;
    expect(t0.$behavior).toBe("fadeIn");
    expect(t0.target).toBe("myLT__name");
    expect(t0.start).toBe(4.5);

    const t1 = ex.tweens[1] as Record<string, unknown>;
    expect(t1.target).toBe("myLT__role");
    expect(t1.start).toBeCloseTo(4.7, 10);

    // Literal tween gets an auto-derived prefixed id when no explicit one was set.
    const t2 = ex.tweens[2] as Record<string, unknown>;
    expect(t2.id).toBe("myLT__t2");
    expect(t2.target).toBe("myLT__bar");
    expect(t2.start).toBe(4.5);
  });

  it("two instances of the same template never collide on item ids", () => {
    const a = expandTemplate(
      "a",
      {
        template: "lowerThird",
        params: { name: "A", role: "A", fontDisplay: "f1", fontMono: "f2" },
      },
      { templates: { lowerThird } },
    );
    const b = expandTemplate(
      "b",
      {
        template: "lowerThird",
        params: { name: "B", role: "B", fontDisplay: "f1", fontMono: "f2" },
      },
      { templates: { lowerThird } },
    );
    const ids = new Set([...Object.keys(a.items), ...Object.keys(b.items)]);
    expect(ids.size).toBe(Object.keys(a.items).length + Object.keys(b.items).length);
  });

  it("uses default start of 0 when omitted", () => {
    const ex = expandTemplate(
      "x",
      {
        template: "lowerThird",
        params: { name: "n", role: "r", fontDisplay: "f", fontMono: "g" },
      },
      { templates: { lowerThird } },
    );
    expect((ex.tweens[0] as any).start).toBe(0);
    expect((ex.tweens[1] as any).start).toBeCloseTo(0.2, 10);
  });

  it("rewrites group `items` arrays so children survive prefixing", () => {
    const grouped: TemplateDefinition = {
      id: "grouped",
      params: [],
      items: {
        leaf: {
          type: "shape",
          kind: "rect",
          width: 1,
          height: 1,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
        },
        wrap: {
          type: "group",
          items: ["leaf", "external-id"],
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
        },
      },
      tweens: [],
    };
    const ex = expandTemplate("g", { template: "grouped" }, { templates: { grouped } });
    expect((ex.items["g__wrap"] as any).items).toEqual(["g__leaf", "external-id"]);
  });
});

// ──────────────── expandTemplate — validation errors (§7.7) ────────────────

describe("expandTemplate — validation errors", () => {
  it("E_TEMPLATE_UNKNOWN on missing template name", () => {
    try {
      expandTemplate("x", { template: "nope" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MCPToolError);
      expect((err as MCPToolError).code).toBe("E_TEMPLATE_UNKNOWN");
    }
  });

  it("E_TEMPLATE_PARAM_MISSING when a required param is absent", () => {
    try {
      expandTemplate(
        "x",
        { template: "lowerThird", params: { fontDisplay: "f", fontMono: "g" } },
        { templates: { lowerThird } },
      );
      expect.unreachable();
    } catch (err) {
      expect((err as MCPToolError).code).toBe("E_TEMPLATE_PARAM_MISSING");
    }
  });

  it("E_TEMPLATE_PARAM_TYPE when a param has the wrong type", () => {
    try {
      expandTemplate(
        "x",
        {
          template: "lowerThird",
          params: {
            name: 42, // expected string
            role: "r",
            fontDisplay: "f",
            fontMono: "g",
          },
        },
        { templates: { lowerThird } },
      );
      expect.unreachable();
    } catch (err) {
      expect((err as MCPToolError).code).toBe("E_TEMPLATE_PARAM_TYPE");
    }
  });

  it("E_INVALID_VALUE for negative instance start", () => {
    expect(() =>
      expandTemplate(
        "x",
        {
          template: "lowerThird",
          start: -1,
          params: { name: "n", role: "r", fontDisplay: "f", fontMono: "g" },
        },
        { templates: { lowerThird } },
      ),
    ).toThrow(/non-negative numeric start/);
  });
});

// ──────────────── expandTemplates (compile-time walker) ────────────────

describe("expandTemplates — compile pass", () => {
  it("strips `templates` key and replaces $template instances inline", () => {
    const comp = {
      version: "0.3",
      composition: { width: 16, height: 16, fps: 30, duration: 5, background: "#000" },
      assets: [],
      templates: { lowerThird },
      layers: [
        { id: "lt", z: 0, opacity: 1, blendMode: "normal", items: ["myLT"] },
      ],
      items: {
        myLT: {
          $template: "lowerThird",
          params: { name: "N", role: "R", fontDisplay: "f1", fontMono: "f2" },
          start: 1,
        },
      },
      tweens: [],
    };

    const out = expandTemplates(comp) as Record<string, unknown>;

    expect(out.templates).toBeUndefined();

    const items = out.items as Record<string, unknown>;
    expect(Object.keys(items).sort()).toEqual([
      "myLT__bar",
      "myLT__name",
      "myLT__role",
    ]);

    // Layer reference rewired to expanded ids in declaration order.
    const layers = out.layers as Array<{ items: string[] }>;
    expect(layers[0]?.items).toEqual(["myLT__bar", "myLT__name", "myLT__role"]);

    // Tweens appended.
    const tweens = out.tweens as unknown[];
    expect(tweens).toHaveLength(3);
    expect((tweens[0] as any).target).toBe("myLT__name");
    expect((tweens[2] as any).id).toBe("myLT__t2");
  });

  it("falls back to `instance.layerId` when no layer references the instance", () => {
    const comp = {
      version: "0.3",
      composition: { width: 16, height: 16, fps: 30, duration: 5, background: "#000" },
      assets: [],
      templates: { lowerThird },
      layers: [
        { id: "lt", z: 0, opacity: 1, blendMode: "normal", items: [] },
      ],
      items: {
        myLT: {
          $template: "lowerThird",
          layerId: "lt",
          params: { name: "N", role: "R", fontDisplay: "f1", fontMono: "f2" },
        },
      },
      tweens: [],
    };
    const out = expandTemplates(comp) as { layers: Array<{ id: string; items: string[] }> };
    expect(out.layers[0]?.items).toEqual(["myLT__bar", "myLT__name", "myLT__role"]);
  });

  it("errors when an instance has no layerId AND no layer references it", () => {
    const comp = {
      version: "0.3",
      composition: { width: 16, height: 16, fps: 30, duration: 5, background: "#000" },
      assets: [],
      templates: { lowerThird },
      layers: [
        { id: "lt", z: 0, opacity: 1, blendMode: "normal", items: [] },
      ],
      items: {
        myLT: {
          $template: "lowerThird",
          params: { name: "N", role: "R", fontDisplay: "f1", fontMono: "f2" },
        },
      },
      tweens: [],
    };
    expect(() => expandTemplates(comp)).toThrowError(/no layerId/);
  });

  it("short-circuits when there are no $template markers and no `templates` key", () => {
    const comp = {
      version: "0.1",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: [] }],
      items: {},
      tweens: [],
    };
    expect(expandTemplates(comp)).toBe(comp);
  });

  it("strips an empty `templates` key when no instances reference it", () => {
    const comp = {
      version: "0.3",
      composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
      assets: [],
      templates: { lowerThird },
      layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: [] }],
      items: {},
      tweens: [],
    };
    const out = expandTemplates(comp) as Record<string, unknown>;
    expect(out.templates).toBeUndefined();
    expect(out.items).toEqual({});
  });
});

// ──────────────── precompile pipeline integration ────────────────

describe("precompile — templates + behaviors together", () => {
  it("expands templates first, then behaviors run on the emitted $behavior blocks", async () => {
    const comp = {
      version: "0.3",
      composition: { width: 16, height: 16, fps: 30, duration: 5, background: "#000" },
      assets: [],
      templates: { lowerThird },
      layers: [
        { id: "lt", z: 0, opacity: 1, blendMode: "normal", items: ["myLT"] },
      ],
      items: {
        myLT: {
          $template: "lowerThird",
          params: { name: "N", role: "R", fontDisplay: "f1", fontMono: "f2" },
          start: 2,
        },
      },
      tweens: [],
    };
    const out = (await precompile(comp)) as { tweens: Array<Record<string, unknown>> };
    // Two fadeIn behaviors expand to one opacity tween each (§6.3) plus the
    // one literal `bar` width tween — total 3.
    expect(out.tweens).toHaveLength(3);

    // The fadeIn for `name` lifts to 2 + 0 = 2.
    const nameOpacity = out.tweens.find((t) => t.target === "myLT__name");
    expect(nameOpacity?.property).toBe("transform.opacity");
    expect(nameOpacity?.start).toBe(2);
    expect(nameOpacity?.id).toBe("myLT__name_fadeIn_2__opacity");

    // The fadeIn for `role` lifts to 2 + 0.2 = 2.2.
    const roleOpacity = out.tweens.find((t) => t.target === "myLT__role");
    expect(roleOpacity?.property).toBe("transform.opacity");
    expect(roleOpacity?.start as number).toBeCloseTo(2.2, 10);
  });
});
