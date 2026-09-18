import { describe, expect, it } from "vitest";
import {
  checkDimensions,
  MAX_RECOMMENDED_DIMENSION,
  validate,
} from "../../src/schema/validator.js";
import { baseComposition } from "./fixtures.js";

describe("validate — encoder dimension preconditions (B-2)", () => {
  it("rejects odd width and height with E_DIMENSION_ODD per axis", () => {
    const comp = baseComposition();
    comp.composition.width = 1001;
    comp.composition.height = 501;
    const result = validate(comp);
    expect(result.valid).toBe(false);
    const odd = result.errors.filter((e) => e.code === "E_DIMENSION_ODD");
    expect(odd.map((e) => e.path)).toEqual([
      "composition.width",
      "composition.height",
    ]);
    expect(odd[0]!.message).toContain("1001");
    expect(odd[0]!.message).toContain("1000 or 1002");
  });

  it("rejects a single odd axis", () => {
    const comp = baseComposition();
    comp.composition.height = 225;
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(["E_DIMENSION_ODD"]);
  });

  it("accepts even dimensions", () => {
    const comp = baseComposition();
    comp.composition.width = 400;
    comp.composition.height = 224;
    expect(validate(comp).errors).toEqual([]);
  });

  it("warns W_DIMENSION_LARGE above 4096 without failing validation", () => {
    const comp = baseComposition();
    comp.composition.width = 8192;
    const result = validate(comp);
    expect(result.valid).toBe(true);
    expect(
      result.warnings.filter((w) => w.code === "W_DIMENSION_LARGE"),
    ).toHaveLength(1);
  });

  it("does not warn at exactly the limit", () => {
    const { errors, warnings } = checkDimensions(
      MAX_RECOMMENDED_DIMENSION,
      MAX_RECOMMENDED_DIMENSION,
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
