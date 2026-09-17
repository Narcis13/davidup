// Param substitution + the `${…}` expression evaluator (v1.1 S15,
// REPEAT_EXPRESSIONS_DESIGN.md §3). Template/scene expansion tests that go
// through `substitute` live in templates.test.ts / scenes.test.ts.

import { describe, expect, it } from "vitest";

import {
  EXPR_MAX_DEPTH,
  EXPR_MAX_LENGTH,
  EXPR_MAX_TOKENS,
  evaluateExpression,
  substitute,
  type SubstitutionContext,
} from "../../src/compose/params.js";
import {
  expandTemplate,
  registerTemplate,
  unregisterTemplate,
  type TemplateDefinition,
} from "../../src/compose/templates.js";
import { expandSceneInstance, type SceneDefinition } from "../../src/compose/scenes.js";
import { MCPToolError } from "../../src/engine/errors.js";

const ctx: SubstitutionContext = {
  params: {
    stagger: 0.15,
    n: 3,
    name: "Ada",
    color: "#ff0000",
    flag: true,
    obj: { a: 1 },
    list: [1, 2],
    nothing: null,
  },
  meta: { start: 2, duration: 5 },
  paramTypes: { stagger: "number", n: "number", name: "string", color: "color", flag: "boolean" },
};

function exprError(fn: () => unknown): MCPToolError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MCPToolError);
    return err as MCPToolError;
  }
  throw new Error("expected an error");
}

describe("whole-string fast path (v0.3 compatibility)", () => {
  it("returns bare refs unchanged, any JSON type", () => {
    expect(substitute("${params.stagger}", ctx)).toBe(0.15);
    expect(substitute("${params.flag}", ctx)).toBe(true);
    expect(substitute("${params.obj}", ctx)).toBe(ctx.params.obj);
    expect(substitute("${params.list}", ctx)).toBe(ctx.params.list);
    expect(substitute("${params.nothing}", ctx)).toBeNull();
    expect(substitute("${$.start}", ctx)).toBe(2);
  });

  it("treats a spaced bare ref as a passthrough too", () => {
    expect(substitute("${ params.obj }", ctx)).toBe(ctx.params.obj);
  });

  it("leaves strings without a params/$ reference byte-identical", () => {
    for (const s of [
      "plain",
      "costs ${price}",
      "${1 + 2}",
      "${",
      "${params.x",
      "$${price}",
      "template `${foo.bar}`",
    ]) {
      expect(substitute(s, ctx)).toBe(s);
    }
  });

  it("keeps E_TEMPLATE_PARAM_MISSING for unknown refs", () => {
    expect(exprError(() => substitute("${params.bogus}", ctx)).code).toBe(
      "E_TEMPLATE_PARAM_MISSING",
    );
    expect(exprError(() => substitute("${params.bogus * 2}", ctx)).code).toBe(
      "E_TEMPLATE_PARAM_MISSING",
    );
    expect(exprError(() => substitute("${$.end}", ctx)).code).toBe(
      "E_TEMPLATE_PARAM_MISSING",
    );
  });
});

describe("arithmetic", () => {
  it("evaluates with standard precedence and associativity", () => {
    expect(substitute("${params.stagger * 2}", ctx)).toBe(0.3);
    expect(evaluateExpression("1 + 2 * 3", ctx)).toBe(7);
    expect(evaluateExpression("(1 + 2) * 3", ctx)).toBe(9);
    expect(evaluateExpression("10 - 4 - 3", ctx)).toBe(3);
    expect(evaluateExpression("24 / 4 / 3", ctx)).toBe(2);
    expect(evaluateExpression("7 % 3", ctx)).toBe(1);
    expect(evaluateExpression("-params.n + 1", ctx)).toBe(-2);
    expect(evaluateExpression("--2", ctx)).toBe(2);
    expect(evaluateExpression("2 * -3", ctx)).toBe(-6);
    expect(evaluateExpression("$.start + $.duration", ctx)).toBe(7);
    expect(evaluateExpression("1.5e2", ctx)).toBe(150);
  });

  it("matches JS double arithmetic exactly", () => {
    expect(evaluateExpression("0.1 + 0.2", ctx)).toBe(0.1 + 0.2);
    expect(evaluateExpression("params.stagger * 3", ctx)).toBe(0.15 * 3);
  });

  it("supports min, max and round", () => {
    expect(evaluateExpression("min(3, params.n, 1.5)", ctx)).toBe(1.5);
    expect(evaluateExpression("max(params.n * 2, 4)", ctx)).toBe(6);
    expect(evaluateExpression("round(params.stagger * 10)", ctx)).toBe(2);
    expect(evaluateExpression("round(-2.5)", ctx)).toBe(-2);
  });

  it("returns numbers as numbers from whole-string expressions", () => {
    const out = substitute({ start: "${params.stagger * params.n}" }, ctx) as {
      start: unknown;
    };
    expect(typeof out.start).toBe("number");
    expect(out.start).toBe(0.15 * 3);
  });
});

describe("strings and interpolation", () => {
  it("interpolates embedded placeholders", () => {
    expect(substitute("Hello ${params.name}!", ctx)).toBe("Hello Ada!");
    expect(substitute("${params.name} x${params.n}", ctx)).toBe("Ada x3");
    expect(substitute("t=${$.start + 0.5}s", ctx)).toBe("t=2.5s");
    expect(substitute("on: ${params.flag}", ctx)).toBe("on: true");
    expect(substitute("${params.stagger * 3}", ctx)).toBe(0.15 * 3);
    expect(substitute("x${params.stagger * 3}", ctx)).toBe(`x${0.15 * 3}`);
  });

  it("concatenates string literals and string params with +", () => {
    expect(evaluateExpression("'Dr. ' + params.name", ctx)).toBe("Dr. Ada");
    expect(evaluateExpression('"a}b" + params.color', ctx)).toBe("a}b#ff0000");
    expect(substitute("${'{' + params.name + '}'}", ctx)).toBe("{Ada}");
    expect(evaluateExpression("'it\\'s'", ctx)).toBe("it's");
  });

  it("escapes $${ to a literal ${", () => {
    expect(substitute("keep $${params.name} but ${params.name}", ctx)).toBe(
      "keep ${params.name} but Ada",
    );
    expect(substitute("$${params.name}", ctx)).toBe("${params.name}");
  });

  it("refuses to interpolate objects, arrays and null", () => {
    expect(exprError(() => substitute("x ${params.obj}", ctx)).code).toBe("E_TEMPLATE_EXPR");
    expect(exprError(() => substitute("x ${params.list}", ctx)).code).toBe("E_TEMPLATE_EXPR");
    expect(exprError(() => substitute("x ${params.nothing}", ctx)).code).toBe(
      "E_TEMPLATE_EXPR",
    );
  });

  it("walks nested objects and arrays", () => {
    expect(
      substitute({ a: ["${params.n + 1}", { b: "#${params.n}" }], c: 4 }, ctx),
    ).toEqual({ a: [4, { b: "#3" }], c: 4 });
  });
});

describe("type checking", () => {
  it("rejects arithmetic on a declared string, naming the declared type", () => {
    const err = exprError(() => substitute("${params.name * 2}", ctx, "items.t.text"));
    expect(err.code).toBe("E_TEMPLATE_EXPR");
    expect(err.message).toContain("params.name (string)");
    expect(err.message).toContain("items.t.text");
  });

  it("rejects mixing strings and numbers with +", () => {
    const err = exprError(() => evaluateExpression("params.name + 1", ctx));
    expect(err.message).toContain("interpolation");
  });

  it("rejects booleans and colors in arithmetic", () => {
    expect(exprError(() => evaluateExpression("params.flag + 1", ctx)).message).toContain(
      "params.flag (boolean)",
    );
    expect(exprError(() => evaluateExpression("-params.color", ctx)).message).toContain(
      "params.color (color)",
    );
    expect(exprError(() => evaluateExpression("min('a', 1)", ctx)).code).toBe(
      "E_TEMPLATE_EXPR",
    );
  });

  it("rejects division/modulo by zero and non-finite results", () => {
    expect(exprError(() => evaluateExpression("1 / 0", ctx)).message).toContain(
      "division by zero",
    );
    expect(exprError(() => evaluateExpression("params.n % (params.n - 3)", ctx)).message).toContain(
      "modulo by zero",
    );
    expect(exprError(() => evaluateExpression("1e308 * 10", ctx)).message).toContain(
      "finite",
    );
  });
});

describe("parse errors carry a position", () => {
  const cases: Array<[string, number, string]> = [
    ["params.n *", 10, "end"],
    ["params.n ** 2", 10, '"*"'],
    ["(params.n + 1", 13, '")"'],
    ["params.n )", 9, '")"'],
    ["foo(1)", 0, "unknown name"],
    ["Math.max(1, 2)", 0, "unknown name"],
    ["params.obj.a", 10, "nested"],
    ["params.", 7, "name after the dot"],
    ["params.n # 2", 9, "unexpected character"],
    ["'open", 0, "unterminated"],
    ["round(1, 2)", 0, "exactly one"],
    ["", 0, "empty"],
  ];
  for (const [source, position, fragment] of cases) {
    it(`${JSON.stringify(source)} → position ${position}`, () => {
      const err = exprError(() => evaluateExpression(source, ctx, "tweens[0].start"));
      expect(err.code).toBe("E_TEMPLATE_EXPR");
      expect(err.details).toEqual({ path: "tweens[0].start", expression: source, position });
      expect(err.message).toContain(fragment);
      expect(err.message).toContain(`position ${position}`);
      expect(err.hint).toBeDefined();
    });
  }

  it("draws a caret under the offending token", () => {
    const err = exprError(() => substitute("${params.n ** 2}", ctx));
    const lines = err.message.split("\n");
    expect(lines[1]).toBe("  ${params.n ** 2}");
    expect(lines[2]).toBe(`  ${" ".repeat(12)}^`);
  });

  it("serialises into the MCP error body", () => {
    const body = exprError(() => substitute("${params.n +}", ctx, "p")).toBody();
    expect(body.code).toBe("E_TEMPLATE_EXPR");
    expect(body.details).toMatchObject({ path: "p", expression: "params.n +" });
  });
});

describe("bounds", () => {
  it(`caps length at ${EXPR_MAX_LENGTH}`, () => {
    const long = "params.n" + " + 1".repeat(70);
    expect(long.length).toBeGreaterThan(EXPR_MAX_LENGTH);
    expect(exprError(() => evaluateExpression(long, ctx)).message).toContain("longer than");
  });

  it(`caps tokens at ${EXPR_MAX_TOKENS}`, () => {
    const many = Array.from({ length: 40 }, () => "1").join("+");
    expect(exprError(() => evaluateExpression(many, ctx)).message).toContain("tokens");
    const ok = Array.from({ length: 32 }, () => "1").join("+");
    expect(evaluateExpression(ok, ctx)).toBe(32);
  });

  it(`caps nesting at ${EXPR_MAX_DEPTH}`, () => {
    const deep = "(".repeat(EXPR_MAX_DEPTH + 1) + "1" + ")".repeat(EXPR_MAX_DEPTH + 1);
    expect(exprError(() => evaluateExpression(deep, ctx)).message).toContain("nests deeper");
    const ok = "(".repeat(EXPR_MAX_DEPTH) + "1" + ")".repeat(EXPR_MAX_DEPTH);
    expect(evaluateExpression(ok, ctx)).toBe(1);
    const unary = "-".repeat(EXPR_MAX_DEPTH + 1) + "1";
    expect(exprError(() => evaluateExpression(unary, ctx)).message).toContain("nests deeper");
  });

  it("gives no access to JS globals or prototypes", () => {
    expect(exprError(() => evaluateExpression("constructor", ctx)).code).toBe("E_TEMPLATE_EXPR");
    expect(exprError(() => evaluateExpression("params.constructor", ctx)).code).toBe(
      "E_TEMPLATE_PARAM_MISSING",
    );
    expect(exprError(() => evaluateExpression("$.__proto__", ctx)).code).toBe(
      "E_TEMPLATE_PARAM_MISSING",
    );
  });
});

describe("templates and scenes share the evaluator", () => {
  const tpl: TemplateDefinition = {
    id: "exprTpl",
    params: [
      { name: "who", type: "string", required: true },
      { name: "gap", type: "number", default: 0.25 },
    ],
    items: {
      t: {
        type: "text",
        text: "Hello ${params.who}!",
        font: "f",
        fontSize: 20,
        color: "#fff",
        transform: {
          x: "${params.gap * 400}",
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
    tweens: [
      {
        target: "t",
        property: "transform.opacity",
        from: 0,
        to: 1,
        start: "${params.gap * 2}",
        duration: "${max(params.gap, 0.5)}",
      },
    ],
  };

  it("expands expressions inside a template instance", () => {
    registerTemplate(tpl);
    try {
      const ex = expandTemplate("i", { template: "exprTpl", params: { who: "Bob" }, start: 1 });
      const item = ex.items["i__t"] as any;
      expect(item.text).toBe("Hello Bob!");
      expect(item.transform.x).toBe(100);
      const tween = ex.tweens[0] as any;
      expect(tween.start).toBe(1.5);
      expect(tween.duration).toBe(0.5);
    } finally {
      unregisterTemplate("exprTpl");
    }
  });

  it("reports the template path for a mistyped expression", () => {
    registerTemplate({
      ...tpl,
      id: "badTpl",
      tweens: [{ ...(tpl.tweens[0] as object), start: "${params.who * 2}" }],
    });
    try {
      const err = exprError(() =>
        expandTemplate("k", { template: "badTpl", params: { who: "Bob" } }),
      );
      expect(err.code).toBe("E_TEMPLATE_EXPR");
      expect(err.message).toContain("templates.badTpl.tweens[0].start");
      expect(err.message).toContain("params.who (string)");
    } finally {
      unregisterTemplate("badTpl");
    }
  });

  it("expands expressions inside a scene instance", () => {
    const scene: SceneDefinition = {
      id: "exprScene",
      duration: 4,
      params: [{ name: "label", type: "string", default: "Scene" }],
      assets: [],
      items: {
        t: {
          type: "text",
          text: "${params.label} (${$.duration}s)",
          font: "f",
          fontSize: 20,
          color: "#fff",
          transform: {
            x: "${$.duration * 10}",
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
    const ex = expandSceneInstance(
      "s",
      { scene: "exprScene", params: { label: "Intro" }, start: 0 } as any,
      { scenes: { exprScene: scene } } as any,
    );
    const item = ex.items["s__t"] as any;
    expect(item.text).toBe("Intro (4s)");
    expect(item.transform.x).toBe(40);
  });
});

describe("$repeat locals and computed param names (v1.1 S16)", () => {
  const ctx = {
    params: { y1: 10, y2: 20, bullet2: "two", name: "n" },
    paramTypes: { y1: "number", y2: "number", bullet2: "string", name: "string" },
    locals: { i: 1 },
  };

  it("resolves loop variables as bare identifiers", () => {
    expect(substitute("${i}", ctx)).toBe(1);
    expect(substitute("b${i + 1}", ctx)).toBe("b2");
    expect(evaluateExpression("i * 2", ctx)).toBe(2);
  });

  it("looks params up by computed name, joining numbers inside the brackets", () => {
    expect(substitute("${params['y' + (i + 1)]}", ctx)).toBe(20);
    expect(substitute("${params['bullet' + (i + 1)]}", ctx)).toBe("two");
    expect(substitute("${params[params.name + 'ame']}", { ...ctx, params: { ...ctx.params, name: "n", n: 1, name2: 0 } })).toBe("n");
  });

  it("keeps string + number an error outside params[…]", () => {
    expect(() => evaluateExpression("'y' + i", ctx)).toThrow(/needs numbers/);
  });

  it("rejects a non-string computed name and nested access", () => {
    expect(() => evaluateExpression("params[i]", ctx)).toThrow(/needs a string name/);
    expect(() => evaluateExpression("params['y1'].x", ctx)).toThrow(/nested property access/);
  });

  it("leaves segments without params, $ or a loop variable untouched", () => {
    expect(substitute("costs ${price} #${i}", ctx)).toBe("costs ${price} #1");
    expect(substitute("${index}", ctx)).toBe("${index}");
  });
});
