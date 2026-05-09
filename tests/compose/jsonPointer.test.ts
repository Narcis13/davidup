import { describe, expect, it } from "vitest";
import {
  JsonPointerError,
  evaluatePointer,
} from "../../src/compose/jsonPointer.js";

describe("evaluatePointer — RFC 6901", () => {
  const doc = {
    foo: ["bar", "baz"],
    "": 0,
    "a/b": 1,
    "c%d": 2,
    "e^f": 3,
    "g|h": 4,
    "i\\j": 5,
    'k"l': 6,
    " ": 7,
    "m~n": 8,
  };

  it("empty pointer returns the whole document", () => {
    expect(evaluatePointer(doc, "")).toBe(doc);
  });

  it("looks up plain keys", () => {
    expect(evaluatePointer(doc, "/foo")).toEqual(["bar", "baz"]);
  });

  it("indexes into arrays", () => {
    expect(evaluatePointer(doc, "/foo/0")).toBe("bar");
    expect(evaluatePointer(doc, "/foo/1")).toBe("baz");
  });

  it("decodes ~1 as / and ~0 as ~ (in that order)", () => {
    expect(evaluatePointer(doc, "/a~1b")).toBe(1);
    expect(evaluatePointer(doc, "/m~0n")).toBe(8);
  });

  it("handles the empty-string key", () => {
    expect(evaluatePointer(doc, "/")).toBe(0);
  });

  it("throws when the pointer doesn't start with /", () => {
    expect(() => evaluatePointer(doc, "foo")).toThrow(JsonPointerError);
  });

  it("throws on missing keys", () => {
    expect(() => evaluatePointer(doc, "/nope")).toThrow(JsonPointerError);
  });

  it("throws on out-of-range array index", () => {
    expect(() => evaluatePointer(doc, "/foo/9")).toThrow(JsonPointerError);
  });

  it("throws on non-numeric array index", () => {
    expect(() => evaluatePointer(doc, "/foo/bar")).toThrow(JsonPointerError);
  });

  it("rejects leading-zero array indices like /foo/01", () => {
    expect(() => evaluatePointer(doc, "/foo/01")).toThrow(JsonPointerError);
  });

  it("throws when descending into a primitive", () => {
    expect(() => evaluatePointer({ a: 5 }, "/a/b")).toThrow(JsonPointerError);
  });
});
