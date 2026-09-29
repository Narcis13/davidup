// Asset library D2 through the MCP tools: search_assets, get_asset and
// get_asset_preview over temp shelves, on the standalone server (no editor)
// and editor-hosted (the open project's shelf first), and list_library /
// get_library_thumbnail serving the library's asset and font items.

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decodePng, readShelf, type EntryInput } from "../../assetlib/index.js";
import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type MCPLibraryCatalog,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { BLUE_PNG, RED_PNG, makeShelves, put, putFont, repoRoot, type Shelves } from "../assets/libraryShelves.js";

function tool(name: string): ToolDef {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

async function ok(name: string, args: Record<string, unknown>, deps: ToolDeps): Promise<any> {
  const out = await dispatchTool(tool(name), args, deps);
  if (!out.ok) throw new Error(`${name} failed: ${out.error.code} ${out.error.message}`);
  return out.result;
}

async function fails(name: string, args: Record<string, unknown>, deps: ToolDeps, code: string) {
  const out = await dispatchTool(tool(name), args, deps);
  expect(out.ok).toBe(false);
  if (out.ok) throw new Error("unreachable");
  expect(out.error.code).toBe(code);
  return out.error;
}

const png = (b64: string) => decodePng(Buffer.from(b64, "base64"));

// The house teapot: a real cutout (silhouette and all), so hdf's previewer draws it.
const HOUSE = join(repoRoot, "assets");
function putTeapot(root: string): string {
  const { sha: _sha, ...entry } = readShelf(HOUSE).entry("teapot");
  return put(root, { ...entry, id: "teapot" } as EntryInput, readShelf(HOUSE).payload("teapot"));
}

const envBefore = { ...process.env };
let sh: Shelves;
let teapot: string;

beforeEach(() => {
  sh = makeShelves();
  Object.assign(process.env, sh.env);
  delete process.env.DAVIDUP_PROJECT;
  teapot = putTeapot(sh.house);
  put(join(sh.project, "assets"), { id: "dot", kind: "image", name: "Red dot", tags: ["dot", "red"] }, RED_PNG);
  put(sh.user, { id: "dot", kind: "image", name: "Blue dot", tags: ["dot", "blue"] }, BLUE_PNG);
  put(sh.user, { id: "paper-warm", kind: "stock", name: "Warm paper", desc: "Cream paper, warm", tags: ["paper", "warm"], box: [0, 0, 2, 2] }, BLUE_PNG);
  put(sh.house, { id: "fox", kind: "puppet", name: "Fox", tags: ["animal"], units: 1, box: [0, 0, 10, 10] }, JSON.stringify({ parts: [] }));
  put(
    sh.house,
    { id: "fox-sheet", kind: "image", name: "Fox sprite sheet", tags: ["fox"], made: { tool: "hdf sprite", from: ["fox"], args: { clip: "walk" } } },
    RED_PNG,
  );
  putFont(sh.house, "inter", "LibInter");
});

afterEach(() => {
  sh.cleanup();
  process.env = { ...envBefore };
});

/** The standalone server: no editor, no project. */
const standalone = (): ToolDeps => ({ store: new CompositionStore() });

/** Editor-hosted: the open project is `sh.project`. */
function hosted(extra: Partial<ToolDeps> = {}): ToolDeps {
  const info = { root: sh.project, compositionPath: join(sh.project, "composition.json"), libraryIndexPath: null, assetsDir: null, loadedAt: 0 };
  return {
    store: new CompositionStore(),
    projectControls: { current: () => info, list: () => [], open: async () => info, create: async () => info },
    ...extra,
  };
}

describe("search_assets", () => {
  it("ranks a word, explains it, and hands back the register_asset call", async () => {
    const out = await ok("search_assets", { q: "teapot" }, standalone());
    expect(out.hits[0].id).toBe("teapot");
    const hit = out.hits[0];
    expect(hit.shelf).toBe("house");
    expect(hit.why.join(" ")).toMatch(/id: teapot/);
    expect(hit.use.davidup).toMatchObject({
      tool: "register_asset",
      args: { id: "teapot", type: "image", src: `asset:teapot@${teapot.slice(0, 12)}`, licence: "CC0" },
    });
    expect(hit.use.davidup.args.credit).toMatch(/Metropolitan/);
    // hdf reads its own store with no `from`; a temp house shelf is another store.
    expect(hit.use.hdf.code).toBe(`fromStore(['teapot'], { from: '${sh.house}' })`);
    // The silhouette stays out of a hit; get_asset has it.
    expect(hit.record.sil).toBeUndefined();
    expect(hit.omitted).toEqual(["sil"]);
    expect(hit.path).toBe(join(sh.house, "blobs", `${teapot}.webp`));
  });

  it("finds through a synonym, and filters alone list their hits with facets that add up", async () => {
    const dog = await ok("search_assets", { q: "dog" }, standalone());
    expect(dog.hits.map((h: { id: string }) => h.id)).toEqual(["fox"]);

    const raster = await ok("search_assets", { media: "raster" }, standalone());
    expect(raster.hits.map((h: { id: string }) => h.id)).toEqual(["teapot", "dot", "fox-sheet", "paper-warm"]);
    for (const facet of ["kind", "shelf", "licence", "media"]) {
      const sum = Object.values(raster.facets[facet] as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(sum).toBe(raster.count);
    }
    expect(raster.total).toBe(6);
  });

  it("offers a puppet to davidup through the sprite sheet made from it", async () => {
    const out = await ok("search_assets", { q: "fox", kind: "puppet" }, standalone());
    expect(out.hits.map((h: { id: string }) => h.id)).toEqual(["fox"]);
    expect(out.hits[0].use.davidup).toMatchObject({ via: "fox-sheet", args: { id: "fox-sheet", type: "image" } });
  });

  it("no hits: an empty list and the whole library's facets", async () => {
    const out = await ok("search_assets", { q: "zeppelin" }, standalone());
    expect(out).toMatchObject({ count: 0, hits: [], facetsOf: "all" });
    expect(out.facets.kind).toMatchObject({ image: 2, cutout: 1, font: 1, puppet: 1, stock: 1 });
  });

  it("puts the open project's shelf first", async () => {
    const out = await ok("search_assets", { q: "dot" }, hosted());
    expect(out.hits.map((h: { id: string; shelf: string }) => [h.id, h.shelf])).toEqual([["dot", "project"]]);
    expect(out.hits[0].record).toMatchObject({ name: "Red dot", shadowed: ["user"] });
    // Standalone, the same id resolves on the user's pool.
    const alone = await ok("search_assets", { q: "dot" }, standalone());
    expect(alone.hits[0]).toMatchObject({ shelf: "user", record: { name: "Blue dot" } });
  });

  it("takes $DAVIDUP_PROJECT as the project on the standalone server", async () => {
    process.env.DAVIDUP_PROJECT = sh.project;
    const out = await ok("search_assets", { q: "dot" }, standalone());
    expect(out.hits[0].shelf).toBe("project");
  });

  it("refuses a shelf that is not there and a kind outside the list", async () => {
    const err = await fails("search_assets", { shelf: "project" }, standalone(), "E_INVALID_VALUE");
    expect(err.hint).toMatch(/user, house/);
    await fails("search_assets", { kind: "sticker" }, standalone(), "E_INVALID_VALUE");
  });
});

describe("get_asset", () => {
  it("returns the whole record, its shelves and its use", async () => {
    const out = await ok("get_asset", { id: "teapot" }, standalone());
    expect(out.record.sil).toBeDefined();
    expect(out).toMatchObject({ shelf: "house", shelves: ["house"], path: join(sh.house, "blobs", `${teapot}.webp`), same: [] });
    expect(out.use.davidup.args.src).toBe(`asset:teapot@${teapot.slice(0, 12)}`);
  });

  it("says what a record was made from and what was made from it", async () => {
    const fox = await ok("get_asset", { id: "fox" }, standalone());
    expect(fox.made).toEqual({ from: [], into: [{ id: "fox-sheet", kind: "image", shelf: "house", tool: "hdf sprite" }] });
    const sheet = await ok("get_asset", { id: "fox-sheet" }, standalone());
    expect(sheet.made.from).toEqual([{ id: "fox", kind: "puppet", shelf: "house" }]);
    // Same bytes as the project's red dot.
    expect(sheet.same).toEqual([]);
    const hostedSheet = await ok("get_asset", { id: "fox-sheet" }, hosted());
    expect(hostedSheet.same).toEqual([{ shelf: "project", id: "dot" }]);
  });

  it("lists every shelf holding a shadowed id, and takes a sha: ref", async () => {
    const dot = await ok("get_asset", { id: "dot" }, hosted());
    expect(dot).toMatchObject({ shelf: "project", shelves: ["project", "user"] });
    const bySha = await ok("get_asset", { id: `sha:${teapot.slice(0, 12)}` }, standalone());
    expect(bySha.record.id).toBe("teapot");
  });

  it("E_ASSET_MISSING names the shelves searched", async () => {
    const err = await fails("get_asset", { id: "zeppelin" }, standalone(), "E_ASSET_MISSING");
    expect(err.message).toContain(sh.user);
    expect(err.message).toContain(sh.house);
  });
});

describe("get_asset_preview", () => {
  it("draws a cutout with hdf's previewer, then answers from the thumb", async () => {
    const first = await ok("get_asset_preview", { id: "teapot" }, standalone());
    expect(first).toMatchObject({ id: "teapot", shelf: "house", mimeType: "image/png", width: 480, by: "hdf@1", cached: false });
    expect(first.thumb).toBe(join(sh.house, "thumbs", `${teapot}.png`));
    expect(png(first.image).width).toBe(480);
    const again = await ok("get_asset_preview", { id: "teapot" }, standalone());
    expect(again).toMatchObject({ cached: true, by: "hdf@1", image: first.image });
    // get_asset now names the thumb.
    expect((await ok("get_asset", { id: "teapot" }, standalone())).thumb).toBe(first.thumb);
  });

  it("gives a contact sheet for ids, as one MCP image", async () => {
    const out = await ok("get_asset_preview", { ids: ["teapot", "dot", "inter"] }, standalone());
    expect(out).toMatchObject({ ids: ["teapot", "dot", "inter"], cols: 2, rows: 2, mimeType: "image/png" });
    expect(out.cells.map((c: { id: string; shelf: string }) => [c.id, c.shelf])).toEqual([["teapot", "house"], ["dot", "user"], ["inter", "house"]]);
    const img = png(out.image);
    expect([img.width, img.height]).toEqual([out.width, out.height]);

    const split = tool("get_asset_preview").toImages!(out);
    expect(split.images).toHaveLength(1);
    expect(JSON.stringify(split.metadata)).not.toContain(out.image);
  });

  it("sheet: false gives one image per id", async () => {
    const out = await ok("get_asset_preview", { ids: ["dot", "paper-warm"], sheet: false }, standalone());
    expect(out.previews.map((p: { id: string; by: string }) => p.id)).toEqual(["dot", "paper-warm"]);
    // hdf draws paper; nothing draws an image, so it is the fallback card.
    expect(out.previews.map((p: { by: string }) => p.by.replace(/:.*/, ""))).toEqual(["card", "hdf@1"]);
    const split = tool("get_asset_preview").toImages!(out);
    expect(split.images).toHaveLength(2);
    expect((split.metadata as { previews: object[] }).previews[0]).not.toHaveProperty("image");
  });

  it("uses injected previewers", async () => {
    const d: ToolDeps = { ...standalone(), assetPreviewers: { image: { name: "test", version: 3, render: () => RED_PNG } } };
    const out = await ok("get_asset_preview", { id: "dot", force: true }, d);
    expect(out.by).toBe("test@3");
  });

  it("takes id or ids, and names a missing one", async () => {
    await fails("get_asset_preview", {}, standalone(), "E_INVALID_VALUE");
    await fails("get_asset_preview", { id: "dot", ids: ["dot"] }, standalone(), "E_INVALID_VALUE");
    await fails("get_asset_preview", { ids: ["dot", "zeppelin"] }, standalone(), "E_ASSET_MISSING");
  });
});

describe("list_library and get_library_thumbnail over the asset library", () => {
  it("lists the library's asset and font items on the standalone server", async () => {
    const out = (await ok("list_library", {}, standalone())) as MCPLibraryCatalog;
    expect(out.attached).toBe(false);
    expect(out.items.map((i) => [i.kind, i.id, i.assetKind, i.shelf])).toEqual([
      ["asset", "teapot", "cutout", "house"],
      ["font", "inter", "font", "house"],
      ["asset", "dot", "image", "user"],
      ["asset", "fox-sheet", "image", "house"],
      ["asset", "paper-warm", "stock", "user"],
    ]);
    const tea = out.items.find((i) => i.id === "teapot")!;
    expect(tea).toMatchObject({ url: `asset:teapot@${teapot.slice(0, 12)}`, scope: "global", licence: "CC0" });
    expect(out.count).toBe(5);
    expect(out.shelves?.map((s) => s.name)).toEqual(["user", "house"]);

    const fonts = (await ok("list_library", { kind: "font" }, standalone())) as MCPLibraryCatalog;
    expect(fonts.items.map((i) => i.id)).toEqual(["inter"]);
    const q = (await ok("list_library", { q: "paper" }, standalone())) as MCPLibraryCatalog;
    expect(q.items.map((i) => i.id)).toEqual(["paper-warm"]);
    await fails("list_library", { kind: "template" }, standalone(), "E_FEATURE_UNAVAILABLE");
  });

  it("adds the library's items to the editor's catalog, scoped by shelf", async () => {
    const d = hosted({
      libraryControls: {
        list: (args) => ({
          root: "/lib",
          roots: [],
          loadedAt: 0,
          attached: true,
          globalAttached: true,
          projectRoot: sh.project,
          count: 1,
          total: 1,
          query: { q: args.q ?? null, kind: args.kind ?? null, scope: args.scope ?? null },
          items: [{ kind: "asset", id: "logo", source: "logo.png", scope: "project", url: "assets/logo.png" }],
          errors: [],
        }),
        thumbnail: ({ id }) => {
          throw Object.assign(new Error(`no ${id}`), { code: "E_NOT_FOUND" });
        },
      },
    });
    const out = (await ok("list_library", { kind: "asset", scope: "project" }, d)) as MCPLibraryCatalog;
    expect(out.items.map((i) => [i.id, i.url])).toEqual([
      ["logo", "assets/logo.png"],
      ["dot", `asset:dot@${readShelf(join(sh.project, "assets")).entry("dot").sha.slice(0, 12)}`],
    ]);
    expect(out.count).toBe(2);
    // Every asset item there is (the font is not one).
    expect(out.total).toBe(1 + 4);

    // The editor does not hold `teapot`: the library draws it.
    const thumb = await ok("get_library_thumbnail", { kind: "asset", id: "teapot" }, d);
    expect(thumb).toMatchObject({ mimeType: "image/png", width: 480, placeholder: false });
  });

  it("lists an editor item that points at a record once, as the record (D5)", async () => {
    const d = hosted({
      libraryControls: {
        list: (args) => {
          const items = [
            { kind: "font" as const, id: "inter", source: "index.json", scope: "global" as const, url: "asset:inter" },
            { kind: "font" as const, id: "brand", source: "index.json", scope: "global" as const, url: "global:fonts/brand.ttf" },
          ];
          return {
            root: "/lib",
            roots: [],
            loadedAt: 0,
            attached: true,
            globalAttached: true,
            projectRoot: sh.project,
            count: items.length,
            total: items.length,
            query: { q: args.q ?? null, kind: args.kind ?? null, scope: args.scope ?? null },
            items,
            errors: [],
          };
        },
        thumbnail: ({ id }) => {
          throw Object.assign(new Error(`no ${id}`), { code: "E_NOT_FOUND" });
        },
      },
    });
    const out = (await ok("list_library", { kind: "font" }, d)) as MCPLibraryCatalog;
    expect(out.items.map((i) => [i.id, i.shelf ?? i.source])).toEqual([
      ["brand", "index.json"],
      ["inter", "house"],
    ]);
    expect([out.count, out.total]).toEqual([2, 2]);

    d.store.createComposition({ width: 64, height: 64, fps: 30, duration: 1 });
    const fonts = await ok("list_fonts", {}, d);
    expect(fonts.library.map((f: { id: string }) => f.id)).toEqual(["inter", "brand"]);
  });

  it("get_library_thumbnail draws a library record on the standalone server", async () => {
    const card = await ok("get_library_thumbnail", { kind: "font", id: "inter" }, standalone());
    expect(card).toMatchObject({ mimeType: "image/png", placeholder: true });
    await fails("get_library_thumbnail", { kind: "font", id: "dot" }, standalone(), "E_NOT_FOUND");
    await fails("get_library_thumbnail", { kind: "template", id: "x" }, standalone(), "E_FEATURE_UNAVAILABLE");
  });
});

describe("list_fonts over the asset library (D5)", () => {
  it("lists the shelves' font records with or without an editor", async () => {
    putFont(sh.user, "brand-sans", "Brand Sans");
    const sha = readShelf(sh.user).entry("brand-sans").sha;
    for (const deps of [standalone(), hosted()]) {
      deps.store.createComposition({ width: 64, height: 64, fps: 30, duration: 1 });
      const out = await ok("list_fonts", {}, deps);
      expect(out.library).toEqual([
        {
          id: "brand-sans",
          name: "brand-sans",
          family: "Brand Sans",
          scope: "global",
          source: join(sh.user, "blobs", `${sha}.ttf`),
          shelf: "user",
          src: `asset:brand-sans@${sha.slice(0, 12)}`,
          licence: "own",
        },
        expect.objectContaining({ id: "inter", family: "LibInter", shelf: "house" }),
      ]);
      expect(out.hint).toBeUndefined();
    }
  });
});
