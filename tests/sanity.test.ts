import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("scaffold sanity", () => {
  it("exports a version string", () => {
    expect(VERSION).toBe("1.0.0");
  });
});
