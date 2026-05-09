import { describe, expect, it } from "vitest";
import {
  RefResolutionError,
  resolveImports,
  type ReadFile,
} from "../../src/compose/imports.js";

// In-memory filesystem keyed by absolute path. Each test seeds a tiny tree
// and points the resolver at a virtual root.
function vfs(files: Record<string, unknown>): {
  read: ReadFile;
  reads: string[];
} {
  const reads: string[] = [];
  const read: ReadFile = async (absPath) => {
    reads.push(absPath);
    if (!(absPath in files)) {
      throw Object.assign(new Error(`ENOENT: ${absPath}`), { code: "ENOENT" });
    }
    return JSON.stringify(files[absPath]);
  };
  return { read, reads };
}

const ROOT = "/proj/root.json";

describe("resolveImports — passthrough", () => {
  it("returns scalars unchanged", async () => {
    expect(await resolveImports(42, ROOT)).toBe(42);
    expect(await resolveImports("hello", ROOT)).toBe("hello");
    expect(await resolveImports(null, ROOT)).toBe(null);
  });

  it("returns ref-free objects unchanged structurally", async () => {
    const json = { a: 1, b: [2, 3, { c: "x" }] };
    expect(await resolveImports(json, ROOT)).toEqual(json);
  });
});

describe("resolveImports — inline mode", () => {
  it("inlines a referenced file at an object value", async () => {
    const { read } = vfs({
      "/proj/frag.json": { kind: "card", title: "Hi" },
    });
    const out = await resolveImports(
      { items: { card: { $ref: "./frag.json" } } },
      ROOT,
      { readFile: read },
    );
    expect(out).toEqual({ items: { card: { kind: "card", title: "Hi" } } });
  });

  it("inlines a sub-tree via JSON Pointer", async () => {
    const { read } = vfs({
      "/proj/lib.json": {
        wipeLeft: { kind: "wipe", dir: "left" },
        wipeRight: { kind: "wipe", dir: "right" },
      },
    });
    const out = await resolveImports(
      { transition: { $ref: "./lib.json#/wipeLeft" } },
      ROOT,
      { readFile: read },
    );
    expect(out).toEqual({ transition: { kind: "wipe", dir: "left" } });
  });

  it("recursively resolves $ref chains across files", async () => {
    const { read } = vfs({
      "/proj/a.json": { next: { $ref: "./b.json" } },
      "/proj/b.json": { value: 99 },
    });
    const out = await resolveImports({ $ref: "./a.json" }, ROOT, {
      readFile: read,
    });
    expect(out).toEqual({ next: { value: 99 } });
  });

  it("a $ref inside a loaded file resolves relative to that file's dir", async () => {
    const { read } = vfs({
      "/proj/scenes/intro.json": { bg: { $ref: "./bg.json" } },
      "/proj/scenes/bg.json": { color: "#000" },
    });
    const out = await resolveImports(
      { intro: { $ref: "./scenes/intro.json" } },
      ROOT,
      { readFile: read },
    );
    expect(out).toEqual({ intro: { bg: { color: "#000" } } });
  });
});

describe("resolveImports — spread mode", () => {
  it("spreads a top-level array file into the parent array", async () => {
    const { read } = vfs({
      "/proj/tweens.json": [{ id: "t1" }, { id: "t2" }],
    });
    const out = await resolveImports(
      { tweens: [{ $ref: "./tweens.json" }, { id: "t3" }] },
      ROOT,
      { readFile: read },
    );
    expect(out).toEqual({ tweens: [{ id: "t1" }, { id: "t2" }, { id: "t3" }] });
  });

  it("spreads an array selected by JSON pointer", async () => {
    const { read } = vfs({
      "/proj/act.json": {
        tweens: [{ id: "a" }, { id: "b" }],
        items: { x: 1 },
      },
    });
    const out = await resolveImports(
      { tweens: [{ $ref: "./act.json#/tweens" }] },
      ROOT,
      { readFile: read },
    );
    expect(out).toEqual({ tweens: [{ id: "a" }, { id: "b" }] });
  });

  it("does NOT spread when the resolved value is an object", async () => {
    const { read } = vfs({
      "/proj/one.json": { id: "only" },
    });
    const out = await resolveImports(
      { tweens: [{ $ref: "./one.json" }] },
      ROOT,
      { readFile: read },
    );
    expect(out).toEqual({ tweens: [{ id: "only" }] });
  });

  it("does NOT spread when the $ref is in object position even if result is array", async () => {
    const { read } = vfs({ "/proj/list.json": [1, 2, 3] });
    const out = await resolveImports(
      { items: { $ref: "./list.json" } },
      ROOT,
      { readFile: read },
    );
    expect(out).toEqual({ items: [1, 2, 3] });
  });
});

describe("resolveImports — caching", () => {
  it("parses each file at most once even when referenced many times", async () => {
    const { read, reads } = vfs({
      "/proj/lib.json": {
        a: { v: 1 },
        b: { v: 2 },
      },
    });
    const out = await resolveImports(
      {
        first: { $ref: "./lib.json#/a" },
        second: { $ref: "./lib.json#/b" },
        third: { $ref: "./lib.json#/a" },
      },
      ROOT,
      { readFile: read },
    );
    expect(out).toEqual({
      first: { v: 1 },
      second: { v: 2 },
      third: { v: 1 },
    });
    expect(reads).toEqual(["/proj/lib.json"]);
  });
});

describe("resolveImports — cycle detection", () => {
  it("self-cycle on the same file errors with E_REF_CYCLE", async () => {
    const { read } = vfs({
      "/proj/loop.json": { back: { $ref: "./loop.json" } },
    });
    await expect(
      resolveImports({ $ref: "./loop.json" }, ROOT, { readFile: read }),
    ).rejects.toMatchObject({
      name: "RefResolutionError",
      code: "E_REF_CYCLE",
    });
  });

  it("two-file cycle errors with E_REF_CYCLE", async () => {
    const { read } = vfs({
      "/proj/a.json": { go: { $ref: "./b.json" } },
      "/proj/b.json": { go: { $ref: "./a.json" } },
    });
    await expect(
      resolveImports({ $ref: "./a.json" }, ROOT, { readFile: read }),
    ).rejects.toMatchObject({ code: "E_REF_CYCLE" });
  });

  it("does NOT flag the same file referenced from sibling places (no cycle)", async () => {
    // a.json referenced twice from root, but a.json itself contains no $ref
    // back. That is reuse, not a cycle.
    const { read } = vfs({
      "/proj/a.json": { v: 1 },
    });
    const out = await resolveImports(
      { x: { $ref: "./a.json" }, y: { $ref: "./a.json" } },
      ROOT,
      { readFile: read },
    );
    expect(out).toEqual({ x: { v: 1 }, y: { v: 1 } });
  });
});

describe("resolveImports — error cases", () => {
  it("missing file errors with E_REF_MISSING", async () => {
    const { read } = vfs({});
    await expect(
      resolveImports({ $ref: "./nope.json" }, ROOT, { readFile: read }),
    ).rejects.toMatchObject({ code: "E_REF_MISSING" });
  });

  it("invalid JSON errors with E_REF_PARSE", async () => {
    const read: ReadFile = async () => "{ this is not json";
    await expect(
      resolveImports({ $ref: "./bad.json" }, ROOT, { readFile: read }),
    ).rejects.toMatchObject({ code: "E_REF_PARSE" });
  });

  it("unresolvable JSON pointer errors with E_REF_POINTER", async () => {
    const { read } = vfs({ "/proj/lib.json": { a: 1 } });
    await expect(
      resolveImports({ $ref: "./lib.json#/missing" }, ROOT, { readFile: read }),
    ).rejects.toMatchObject({ code: "E_REF_POINTER" });
  });

  it("same-document refs (#/foo with no path) error with E_REF_INVALID", async () => {
    await expect(
      resolveImports({ $ref: "#/elsewhere" }, ROOT),
    ).rejects.toBeInstanceOf(RefResolutionError);
  });
});

describe("resolveImports — composition-shaped integration", () => {
  it("splits a small composition across files and re-joins it", async () => {
    const composition = {
      composition: { width: 1280, height: 720, fps: 60, duration: 5 },
      assets: [{ id: "logo", type: "image", src: "logo.png" }],
    };
    const items = {
      title: { type: "text", text: "Hello" },
      logo: { type: "sprite", asset: "logo" },
    };
    const tweens = [
      { target: "title", property: "transform.opacity", from: 0, to: 1 },
      { target: "title", property: "transform.opacity", from: 1, to: 0 },
    ];
    const { read } = vfs({
      "/proj/meta.json": composition,
      "/proj/items.json": items,
      "/proj/tweens.json": tweens,
    });
    const root = {
      version: "0.2",
      composition: { $ref: "./meta.json#/composition" },
      assets: { $ref: "./meta.json#/assets" },
      items: { $ref: "./items.json" },
      tweens: [{ $ref: "./tweens.json" }],
    };
    const out = await resolveImports(root, ROOT, { readFile: read });
    expect(out).toEqual({
      version: "0.2",
      composition: composition.composition,
      assets: composition.assets,
      items,
      tweens,
    });
  });
});
