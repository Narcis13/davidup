import { describe, expect, it } from "vitest";
import { validate } from "../../src/schema/validator.js";
import { baseComposition } from "./fixtures.js";

describe("validate — happy path", () => {
  it("accepts the base composition", () => {
    const result = validate(baseComposition());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("validate — schema errors (E_SCHEMA)", () => {
  it("rejects negative width", () => {
    const comp = baseComposition();
    comp.composition.width = -10;
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_SCHEMA")).toBe(true);
  });

  it("rejects unknown easing name", () => {
    const comp = baseComposition() as unknown as Record<string, unknown>;
    (comp.tweens as Array<Record<string, unknown>>)[0]!.easing = "easeBogus";
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_SCHEMA")).toBe(true);
  });

  it("rejects opacity > 1", () => {
    const comp = baseComposition();
    comp.layers[0]!.opacity = 2;
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_SCHEMA")).toBe(true);
  });
});

describe("validate — reference errors (E_ITEM_MISSING / E_ASSET_MISSING)", () => {
  it("flags layer pointing at unknown item", () => {
    const comp = baseComposition();
    comp.layers[0]!.items.push("nonexistent-item");
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(
      result.errors.find((e) => e.code === "E_ITEM_MISSING")?.message,
    ).toMatch(/nonexistent-item/);
  });

  it("flags sprite pointing at unknown asset", () => {
    const comp = baseComposition();
    const sprite = comp.items["logo-sprite"]!;
    if (sprite.type === "sprite") sprite.asset = "ghost-asset";
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_ASSET_MISSING")).toBe(true);
  });

  it("flags sprite pointing at a font asset", () => {
    const comp = baseComposition();
    const sprite = comp.items["logo-sprite"]!;
    if (sprite.type === "sprite") sprite.asset = "inter";
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(
      result.errors.find((e) => e.code === "E_ASSET_MISSING")?.message,
    ).toMatch(/not "image"/);
  });

  it("flags text pointing at an image asset", () => {
    const comp = baseComposition();
    const text = comp.items["title-text"]!;
    if (text.type === "text") text.font = "logo";
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(
      result.errors.find((e) => e.code === "E_ASSET_MISSING")?.message,
    ).toMatch(/not "font"/);
  });

  it("flags tween targeting unknown item", () => {
    const comp = baseComposition();
    comp.tweens[0]!.target = "ghost-item";
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_ITEM_MISSING")).toBe(true);
  });
});

describe("validate — tween property checks", () => {
  it("flags non-tweenable property", () => {
    const comp = baseComposition();
    comp.tweens[0]!.property = "fontSize"; // sprite has no fontSize
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_PROPERTY_INVALID")).toBe(
      true,
    );
  });

  it("flags wrong value kind (string for numeric property)", () => {
    const comp = baseComposition();
    comp.tweens[0]!.from = "0";
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_VALUE_KIND")).toBe(true);
  });

  it("accepts string from/to for color property", () => {
    const comp = baseComposition();
    comp.tweens.push({
      id: "title-color-shift",
      target: "title-text",
      property: "color",
      from: "#ffffff",
      to: "#ff0000",
      start: 0,
      duration: 1,
      easing: "linear",
    });
    const result = validate(comp);
    expect(result.valid).toBe(true);
  });

  it("flags numeric value on color property", () => {
    const comp = baseComposition();
    comp.tweens.push({
      id: "title-color-shift",
      target: "title-text",
      property: "color",
      from: 0,
      to: 1,
      start: 0,
      duration: 1,
      easing: "linear",
    });
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_VALUE_KIND")).toBe(true);
  });
});

describe("validate — tween overlap (E_TWEEN_OVERLAP)", () => {
  it("flags overlapping tweens on same (target, property)", () => {
    const comp = baseComposition();
    comp.tweens.push({
      id: "logo-fade-conflict",
      target: "logo-sprite",
      property: "transform.opacity",
      from: 1,
      to: 0,
      start: 0.5,
      duration: 1,
      easing: "linear",
    });
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_TWEEN_OVERLAP")).toBe(true);
  });

  it("allows tweens that touch at endpoints (no overlap)", () => {
    const comp = baseComposition();
    comp.tweens.push({
      id: "logo-fade-out",
      target: "logo-sprite",
      property: "transform.opacity",
      from: 1,
      to: 0,
      start: 1, // first tween ends at 1, this starts at 1
      duration: 1,
      easing: "linear",
    });
    const result = validate(comp);
    expect(result.valid).toBe(true);
  });

  it("does not conflate different properties on same target", () => {
    const comp = baseComposition();
    comp.tweens.push({
      id: "logo-pop-x",
      target: "logo-sprite",
      property: "transform.scaleX",
      from: 0.5,
      to: 1,
      start: 0,
      duration: 1.5,
      easing: "easeOutBack",
    });
    const result = validate(comp);
    expect(result.valid).toBe(true);
  });
});

describe("validate — tween overlap regression (IEEE-754 drift)", () => {
  it("accepts back-to-back chains whose start+duration drifts by 1 ULP", () => {
    // 8.55 + 0.55 = 9.100000000000001 in IEEE-754 — used to trip strict overlap.
    const comp = baseComposition();
    comp.composition.duration = 30;
    comp.tweens = [
      {
        id: "drift-a",
        target: "logo-sprite",
        property: "transform.x",
        from: 0,
        to: 100,
        start: 8.0,
        duration: 0.55,
        easing: "linear",
      },
      {
        id: "drift-b",
        target: "logo-sprite",
        property: "transform.x",
        from: 100,
        to: 200,
        start: 8.55,
        duration: 0.55,
        easing: "linear",
      },
      {
        id: "drift-c",
        target: "logo-sprite",
        property: "transform.x",
        from: 200,
        to: 300,
        start: 9.1,
        duration: 0.55,
        easing: "linear",
      },
    ];
    // sanity: drift exists.
    expect(8.55 + 0.55).not.toBe(9.1);
    const result = validate(comp);
    expect(result.errors.filter((e) => e.code === "E_TWEEN_OVERLAP")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("still flags real overlap larger than the epsilon", () => {
    const comp = baseComposition();
    comp.tweens.push({
      id: "logo-x-overlap",
      target: "logo-sprite",
      property: "transform.opacity",
      // Existing logo-fade-in covers [0,1]; this one starts at 0.5 — clearly overlapping.
      from: 1,
      to: 0,
      start: 0.5,
      duration: 0.4,
      easing: "linear",
    });
    const result = validate(comp);
    expect(result.errors.some((e) => e.code === "E_TWEEN_OVERLAP")).toBe(true);
  });
});

describe("validate — duration warning (W_TWEEN_TRUNCATED)", () => {
  it("warns (not errors) when tween extends past composition end", () => {
    const comp = baseComposition();
    comp.tweens[0]!.start = 24;
    comp.tweens[0]!.duration = 5; // ends at 29 > 25
    const result = validate(comp);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === "W_TWEEN_TRUNCATED")).toBe(
      true,
    );
  });
});

describe("validate — group cycles (E_GROUP_CYCLE)", () => {
  it("flags a self-referential group", () => {
    const comp = baseComposition();
    comp.items["self-group"] = {
      type: "group",
      items: ["self-group"],
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
    };
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_GROUP_CYCLE")).toBe(true);
  });

  it("flags a 2-cycle between groups", () => {
    const comp = baseComposition();
    const transform = {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
    };
    comp.items["group-a"] = { type: "group", items: ["group-b"], transform };
    comp.items["group-b"] = { type: "group", items: ["group-a"], transform };
    const result = validate(comp);
    expect(result.valid).toBe(false);
    const cycles = result.errors.filter((e) => e.code === "E_GROUP_CYCLE");
    // Canonicalized so we report exactly one cycle, not one per entry.
    expect(cycles).toHaveLength(1);
  });

  it("accepts an acyclic group hierarchy", () => {
    const comp = baseComposition();
    const transform = {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
    };
    comp.items["outer"] = {
      type: "group",
      items: ["inner", "logo-sprite"],
      transform,
    };
    comp.items["inner"] = {
      type: "group",
      items: ["title-text"],
      transform,
    };
    const result = validate(comp);
    expect(result.valid).toBe(true);
  });
});
