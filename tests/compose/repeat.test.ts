// `$repeat` blocks (v1.1 S16, REPEAT_EXPRESSIONS_DESIGN.md §4): root pass,
// template and scene expansion, ids, nesting, limits, source maps, and the
// bulletList rewrite.

import { describe, expect, it } from "vitest";

import { expandTemplate } from "../../src/compose/templates.js";
import { expandSceneInstance, type SceneDefinition } from "../../src/compose/scenes.js";
import { precompile } from "../../src/compose/precompile.js";
import {
  expandRepeatItems,
  expandRepeatTweens,
  expandRepeats,
  REPEAT_MAX_COUNT,
  REPEAT_MAX_DEPTH,
} from "../../src/compose/repeat.js";
import { MCPToolError } from "../../src/engine/errors.js";
import { validate } from "../../src/schema/validator.js";

const TRANSFORM = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
};

function dot(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "shape",
    kind: "circle",
    radius: 10,
    fillColor: "#ffffff",
    transform: { ...TRANSFORM, x: "${i * 40}" },
    ...extra,
  };
}

function caught(fn: () => unknown): MCPToolError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MCPToolError);
    return err as MCPToolError;
  }
  throw new Error("expected an MCPToolError");
}

function rootComp(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 640, height: 360, fps: 30, duration: 2, background: "#000000" },
    assets: [],
    layers: [{ id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["dots"] }],
    items: {},
    tweens: [],
    ...extra,
  };
}

describe("root $repeat pass", () => {
  it("returns canonical input unchanged (identity)", () => {
    const comp = rootComp({ items: { a: dot() } });
    expect(expandRepeats(comp)).toBe(comp);
  });

  it("expands items with default ids and rewires layers", () => {
    const out = expandRepeats(
      rootComp({
        items: { dots: { $repeat: { count: 3 }, item: dot() } },
      }),
    ) as any;
    expect(Object.keys(out.items)).toEqual(["dots__r0", "dots__r1", "dots__r2"]);
    expect(out.items.dots__r2.transform.x).toBe(80);
    expect(out.layers[0].items).toEqual(["dots__r0", "dots__r1", "dots__r2"]);
  });

  it("rewires group children that reference the base id", () => {
    const out = expandRepeats(
      rootComp({
        layers: [{ id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["g"] }],
        items: {
          g: { type: "group", items: ["dots"], transform: TRANSFORM },
          dots: { $repeat: { count: 2, as: "k", id: "dot${k}" }, item: dot({ transform: TRANSFORM }) },
        },
      }),
    ) as any;
    expect(out.items.g.items).toEqual(["dot0", "dot1"]);
    expect(Object.keys(out.items)).toEqual(["g", "dot0", "dot1"]);
  });

  it("expands tweens: constant ids get __r suffixes, interpolated ids are kept", () => {
    const out = expandRepeats(
      rootComp({
        tweens: [
          {
            $repeat: { count: 2 },
            item: {
              id: "fade",
              target: "dots__r${i}",
              property: "transform.opacity",
              from: 0,
              to: 1,
              start: "${i * 0.25}",
              duration: 0.2,
            },
          },
          {
            $repeat: { count: 2, as: "n" },
            item: {
              id: "grow_${n}",
              target: "dots__r${n}",
              property: "transform.scaleX",
              from: 1,
              to: 2,
              start: 1,
              duration: 0.5,
            },
          },
        ],
      }),
    ) as any;
    expect(out.tweens.map((t: any) => t.id)).toEqual(["fade__r0", "fade__r1", "grow_0", "grow_1"]);
    expect(out.tweens[1]).toMatchObject({ target: "dots__r1", start: 0.25 });
  });

  it("nests repeats with every loop variable in scope", () => {
    const { items } = expandRepeatItems(
      {
        cell: {
          $repeat: { count: 2, as: "row", id: "r${row}" },
          item: {
            $repeat: { count: 3, as: "col" },
            item: dot({ transform: { ...TRANSFORM, x: "${col * 10}", y: "${row * 10}" } }),
          },
        },
      },
      { params: {} },
      "items",
    );
    expect(Object.keys(items)).toEqual([
      "r0__r0",
      "r0__r1",
      "r0__r2",
      "r1__r0",
      "r1__r1",
      "r1__r2",
    ]);
    expect((items.r1__r2 as any).transform).toMatchObject({ x: 20, y: 10 });
  });

  it("suffixes constant tween ids per nesting level", () => {
    const out = expandRepeatTweens(
      [
        {
          $repeat: { count: 2, as: "a" },
          item: { $repeat: { count: 2, as: "b" }, item: { id: "t", start: "${a + b}" } },
        },
      ],
      { params: {} },
      "tweens",
    );
    expect(out.map((e) => (e.value as any).id)).toEqual([
      "t__r0__r0",
      "t__r0__r1",
      "t__r1__r0",
      "t__r1__r1",
    ]);
    expect(out.every((e) => e.generated)).toBe(true);
  });

  it("count 0 produces nothing", () => {
    const { items, expanded } = expandRepeatItems(
      { dots: { $repeat: { count: 0 }, item: dot() } },
      { params: {} },
      "items",
    );
    expect(items).toEqual({});
    expect(expanded.get("dots")).toEqual([]);
  });

  it("interpolates only loop / param references; other ${…} and $${ escapes stay literal", () => {
    const { items } = expandRepeatItems(
      {
        t: {
          $repeat: { count: 1 },
          item: { text: "costs ${price} · #${i + 1} · $${i}" },
        },
      },
      { params: {} },
      "items",
    );
    expect((items.t__r0 as any).text).toBe("costs ${price} · #1 · ${i}");
  });

  it("compiles and validates end to end", async () => {
    const resolved = await precompile(
      rootComp({
        items: { dots: { $repeat: { count: 4 }, item: dot() } },
        tweens: [
          {
            $repeat: { count: 4 },
            item: {
              $behavior: "fadeIn",
              target: "dots__r${i}",
              start: "${i * 0.2}",
              duration: 0.3,
            },
          },
        ],
      }),
    );
    const result = validate(resolved);
    expect(result.errors).toEqual([]);
    expect((resolved as any).tweens).toHaveLength(4);
  });
});

describe("$repeat errors", () => {
  const ctx = { params: { n: 2, s: "x" }, paramTypes: { n: "number", s: "string" } };
  const expandOne = (block: unknown) =>
    expandRepeatItems({ d: block }, ctx, "items");

  it.each([
    [{ $repeat: { count: -1 }, item: {} }, "between 0 and"],
    [{ $repeat: { count: 1.5 }, item: {} }, "between 0 and"],
    [{ $repeat: { count: REPEAT_MAX_COUNT + 1 }, item: {} }, "between 0 and"],
    [{ $repeat: { count: "${params.s}" }, item: {} }, "between 0 and"],
    [{ $repeat: {}, item: {} }, "missing `count`"],
    [{ $repeat: { count: 1 } }, "missing `item`"],
    [{ $repeat: { count: 1 }, item: {}, extra: 1 }, 'unexpected key "extra"'],
    [{ $repeat: { count: 1, stagger: 1 }, item: {} }, 'unknown $repeat option "stagger"'],
    [{ $repeat: { count: 1, as: "params" }, item: {} }, "`as` must be"],
    [{ $repeat: { count: 1, as: "a-b" }, item: {} }, "`as` must be"],
    [{ $repeat: { count: 1, id: 7 }, item: {} }, "`id` must be"],
    [{ $repeat: { count: 1 }, item: 5 }, "`item` must be an object"],
    [
      { $repeat: { count: 1 }, item: { $repeat: { count: 1 }, item: {} } },
      'loop variable "i" is already bound',
    ],
  ])("rejects malformed block #%#", (block, message) => {
    const err = caught(() => expandOne(block));
    expect(err.code).toBe("E_REPEAT_INVALID");
    expect(err.message).toContain(message);
    expect(String(err.details?.path)).toMatch(/^items\.d/);
  });

  it("rejects `id` on tween repeats", () => {
    const err = caught(() =>
      expandRepeatTweens([{ $repeat: { count: 1, id: "x" }, item: {} }], ctx, "tweens"),
    );
    expect(err.message).toContain('unknown $repeat option "id"');
  });

  it("enforces the nesting depth limit", () => {
    let block: unknown = {};
    for (let d = 0; d <= REPEAT_MAX_DEPTH; d += 1) {
      block = { $repeat: { count: 1, as: `v${d}` }, item: block };
    }
    expect(caught(() => expandOne(block)).message).toContain(
      `nest deeper than ${REPEAT_MAX_DEPTH}`,
    );
  });

  it("enforces the total output budget", () => {
    const block = {
      $repeat: { count: 500, as: "a" },
      item: { $repeat: { count: 5, as: "b" }, item: {} },
    };
    expect(caught(() => expandOne(block)).message).toContain("more than 2000 entries");
  });

  it("rejects colliding ids", () => {
    const err = caught(() =>
      expandRepeatItems(
        { d: { $repeat: { count: 2, id: "same" }, item: {} } },
        ctx,
        "items",
      ),
    );
    expect(err.code).toBe("E_DUPLICATE_ID");
  });

  it("rejects a produced id that collides with a literal item", () => {
    const err = caught(() =>
      expandRepeatItems(
        { d: { $repeat: { count: 1 }, item: {} }, d__r0: {} },
        ctx,
        "items",
      ),
    );
    expect(err.code).toBe("E_DUPLICATE_ID");
  });

  it("reports unknown names with the loop variables in scope", () => {
    // `${j}` alone isn't an expression (no known reference) and stays literal;
    // `${j + k}` is, and `j` is unknown.
    const err = caught(() =>
      expandOne({ $repeat: { count: 1, as: "k" }, item: { x: "${j + k}" } }),
    );
    expect(err.code).toBe("E_TEMPLATE_EXPR");
    expect(err.message).toContain("$repeat variable: k");
  });

  it("root scope has no params", () => {
    const err = caught(() =>
      expandRepeats(
        rootComp({ items: { dots: { $repeat: { count: "${params.n}" }, item: dot() } } }),
      ),
    );
    expect(err.code).toBe("E_TEMPLATE_PARAM_MISSING");
  });
});

describe("$repeat in templates", () => {
  const templates = {
    row: {
      id: "row",
      params: [
        { name: "n", type: "number" as const, default: 3 },
        { name: "gap", type: "number" as const, default: 50 },
      ],
      items: {
        g: { type: "group", items: ["cell"], transform: TRANSFORM },
        cell: {
          $repeat: { count: "${params.n}", as: "i", id: "cell${i}" },
          item: dot({ transform: { ...TRANSFORM, x: "${params.gap * i}" } }),
        },
      },
      tweens: [
        {
          $repeat: { count: "${params.n}" },
          item: {
            target: "cell${i}",
            property: "transform.opacity",
            from: 0,
            to: 1,
            start: "${i * 0.1}",
            duration: 0.1,
          },
        },
      ],
    },
  };

  it("uses instance params for count and body, prefixes produced ids and targets", () => {
    const ex = expandTemplate("r", { template: "row", params: { n: 4 }, start: 1 }, { templates });
    expect(Object.keys(ex.items)).toEqual(["r__cell0", "r__cell1", "r__cell2", "r__cell3", "r__g"]);
    expect((ex.items.r__cell3 as any).transform.x).toBe(150);
    expect((ex.items.r__g as any).items).toEqual(["r__cell0", "r__cell1", "r__cell2", "r__cell3"]);
    expect(ex.tweens.map((t: any) => [t.id, t.target, t.start])).toEqual([
      ["r__t0", "r__cell0", 1],
      ["r__t1", "r__cell1", 1.1],
      ["r__t2", "r__cell2", 1.2],
      ["r__t3", "r__cell3", 1.3],
    ]);
  });

  it("does not substitute produced entries twice", () => {
    const ex = expandTemplate(
      "q",
      { template: "quote", params: { s: "${params.s}" } },
      {
        templates: {
          quote: {
            id: "quote",
            params: [{ name: "s", type: "string" }],
            items: { t: { $repeat: { count: 1 }, item: { text: "${params.s}" } } },
            tweens: [],
          },
        },
      },
    );
    expect((ex.items.q__t__r0 as any).text).toBe("${params.s}");
  });
});

describe("$repeat in scenes", () => {
  const def: SceneDefinition = {
    id: "grid",
    duration: 2,
    params: [{ name: "rows", type: "number", default: 2 }],
    assets: [],
    items: {
      box: {
        $repeat: { count: "${params.rows}", as: "r", id: "box${r}" },
        item: {
          type: "shape",
          kind: "rect",
          width: 10,
          height: 10,
          fillColor: "#fff",
          transform: { ...TRANSFORM, y: "${r * 20}" },
        },
      },
    },
    tweens: [
      {
        $repeat: { count: "${params.rows}", as: "r" },
        item: {
          target: "box${r}",
          property: "transform.x",
          from: 0,
          to: 100,
          start: "${r * 0.5}",
          duration: 0.5,
        },
      },
    ],
  };

  it("expands with scene params and prefixes ids, group children and targets", () => {
    const ex = expandSceneInstance("s", { scene: "grid", params: { rows: 3 }, start: 1 }, {
      scenes: { grid: def },
    });
    expect(Object.keys(ex.items)).toEqual(["s__box0", "s__box1", "s__box2"]);
    expect((ex.groupItem as any).items).toEqual(["s__box0", "s__box1", "s__box2"]);
    expect((ex.items.s__box2 as any).transform.y).toBe(40);
    expect(ex.tweens.map((t: any) => [t.target, t.start])).toEqual([
      ["s__box0", 1],
      ["s__box1", 1.5],
      ["s__box2", 2],
    ]);
  });

  it("rejects a $template produced inside a scene", () => {
    const err = caught(() =>
      expandSceneInstance(
        "s",
        { scene: "t" },
        {
          scenes: {
            t: {
              ...def,
              id: "t",
              items: { l: { $repeat: { count: 1 }, item: { $template: "titleCard" } } },
              tweens: [],
            },
          },
        },
      ),
    );
    expect(err.code).toBe("E_REPEAT_INVALID");
  });
});

describe("$repeat source maps", () => {
  it("attributes produced items, tweens and template instances to the block", async () => {
    const { sourceMap } = await precompile(
      rootComp({
        layers: [{ id: "main", z: 0, opacity: 1, blendMode: "normal", items: ["dots", "cards"] }],
        items: {
          dots: { $repeat: { count: 2 }, item: dot() },
          cards: {
            $repeat: { count: 2, id: "card${i}" },
            item: {
              $template: "bulletList",
              params: { bullet1: "Row ${i}", count: 1, font: "f", y1: "${i * 100}" },
            },
          },
        },
        tweens: [
          {
            $repeat: { count: 2 },
            item: { $behavior: "fadeIn", target: "dots__r${i}", start: "${i}", duration: 0.5 },
          },
        ],
      }),
      { emitSourceMap: true },
    );
    expect(sourceMap.items.dots__r1).toEqual({
      file: "<root>",
      jsonPointer: "/items/dots",
      originKind: "repeat",
    });
    expect(sourceMap.items.card1__b1).toEqual({
      file: "<root>",
      jsonPointer: "/items/cards",
      originKind: "template",
    });
    const tweenIds = Object.keys(sourceMap.tweens);
    expect(tweenIds.length).toBeGreaterThan(0);
    for (const id of tweenIds.filter((t) => t.startsWith("dots__"))) {
      expect(sourceMap.tweens[id]).toEqual({
        file: "<root>",
        jsonPointer: "/tweens/0",
        originKind: "repeat",
      });
    }
  });
});

describe("bulletList on $repeat", () => {
  const base = { font: "fd", bullet1: "a", bullet2: "b", bullet3: "c", bullet4: "d", bullet5: "e" };

  it("emits `count` bullets with ids b1..bN, per-bullet y and staggered starts", () => {
    const ex = expandTemplate("bl", { template: "bulletList", params: { ...base, count: 5 } });
    expect(Object.keys(ex.items)).toEqual(["bl__b1", "bl__b2", "bl__b3", "bl__b4", "bl__b5"]);
    expect((ex.items.bl__b5 as any).text).toBe("e");
    expect((ex.items.bl__b5 as any).transform.y).toBe(640);
    expect(ex.tweens.map((t: any) => [t.target, t.start])).toEqual([
      ["bl__b1", 0],
      ["bl__b2", 0.15],
      ["bl__b3", 0.3],
      ["bl__b4", 0.44999999999999996],
      ["bl__b5", 0.6],
    ]);
  });

  it("needs only the bullets it emits", () => {
    const ex = expandTemplate("bl", { template: "bulletList", params: { font: "fd", bullet1: "x", count: 1 } });
    expect(Object.keys(ex.items)).toEqual(["bl__b1"]);
  });

  it("names the missing bullet when count outruns the params", () => {
    const err = caught(() =>
      expandTemplate("bl", { template: "bulletList", params: { font: "fd", bullet1: "x", count: 2 } }),
    );
    expect(err.code).toBe("E_TEMPLATE_PARAM_MISSING");
    expect(err.message).toContain("bullet2");
  });
});

describe("descriptors", () => {
  it("report $repeat id patterns in emits", async () => {
    const { listTemplates } = await import("../../src/compose/templates.js");
    const { describeItemIds } = await import("../../src/compose/repeat.js");
    expect(listTemplates().find((t) => t.id === "bulletList")?.emits).toEqual(["b${i + 1}"]);
    expect(
      describeItemIds({ z: {}, dot: { $repeat: { count: 2, as: "k" }, item: {} } }),
    ).toEqual(["dot__r${k}", "z"]);
  });
});
