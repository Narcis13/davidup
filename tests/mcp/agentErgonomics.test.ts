// Session 25 — MCP agent ergonomics batch (R-17, R-18, R-28, R-29, R-30).
//
// Covers the parts of the batch that live below the MCP transport layer
// (dispatchTool / ToolDef), driven the same way the real server and the
// editor bridge drive tools:
//   - list_engine_capabilities reports `server.flavor` (R-28)
//   - list_fonts returns an actionable `hint` when the catalog is empty (R-30)
//   - render_thumbnail_strip rejects `count` above the cap with a structured,
//     hinted error rather than silently rendering a flood of frames (R-18)
//   - render_preview_frame / render_thumbnail_strip expose `toImages`, the
//     hook server.ts uses to promote base64 bytes to real MCP image content
//     blocks instead of leaving them inert inside JSON text (R-17)
//
// R-29 (cross-session leak) is documentation-only — see the updated
// `create_composition` / `reset` descriptions in src/mcp/tools.ts — so there
// is nothing behavioural to assert here.

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type LibraryControls,
  type ProjectControls,
  type RenderControls,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { THUMBNAIL_STRIP_MAX_COUNT } from "../../src/mcp/render.js";
import { FakeContext } from "../engine/fakeContext.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function call(name: string, args: Record<string, unknown>, deps: ToolDeps) {
  return dispatchTool(getTool(name), args, deps);
}

function freshDeps(): ToolDeps {
  return { store: new CompositionStore() };
}

// Never invoked in these tests — just present so `deps.projectControls` is
// truthy, which is exactly what list_engine_capabilities checks for "editor".
const stubProjectControls: ProjectControls = {
  current: () => null,
  list: () => [],
  open: () => {
    throw new Error("not implemented in test stub");
  },
  create: () => {
    throw new Error("not implemented in test stub");
  },
};

const stubLibraryControls: LibraryControls = {
  list: () => {
    throw new Error("not implemented in test stub");
  },
  thumbnail: () => {
    throw new Error("not implemented in test stub");
  },
};

const stubRenderControls: RenderControls = {
  start: () => {
    throw new Error("not implemented in test stub");
  },
  get: () => null,
  list: () => [],
  waitFor: () => {
    throw new Error("not implemented in test stub");
  },
  cancel: () => null,
};

describe("list_engine_capabilities — server flavor (R-28)", () => {
  it("reports standalone when no project/library/render controls are injected", async () => {
    const out = await call("list_engine_capabilities", {}, freshDeps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const caps = out.result as {
      server: {
        flavor: string;
        hasProjectLifecycle: boolean;
        hasLibrary: boolean;
        hasRenderQueue: boolean;
      };
    };
    expect(caps.server.flavor).toBe("standalone");
    expect(caps.server.hasProjectLifecycle).toBe(false);
    expect(caps.server.hasLibrary).toBe(false);
    expect(caps.server.hasRenderQueue).toBe(false);
  });

  it("reports editor when the editor bridge's controls are injected", async () => {
    const deps: ToolDeps = {
      store: new CompositionStore(),
      projectControls: stubProjectControls,
      libraryControls: stubLibraryControls,
      renderControls: stubRenderControls,
    };
    const out = await call("list_engine_capabilities", {}, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const caps = out.result as { server: { flavor: string } };
    expect(caps.server.flavor).toBe("editor");
  });
});

describe("list_fonts — cold-start hint (R-30)", () => {
  it("returns an actionable hint when no fonts are registered anywhere", async () => {
    const deps = freshDeps();
    deps.store.createComposition({ width: 100, height: 100, fps: 30, duration: 1 });
    const out = await call("list_fonts", {}, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = out.result as {
      composition: unknown[];
      library: unknown[];
      hint?: string;
    };
    expect(body.composition).toEqual([]);
    expect(body.library).toEqual([]);
    expect(typeof body.hint).toBe("string");
    expect(body.hint).toContain("register_asset");
  });

  it("omits the hint once a font asset is registered on the composition", async () => {
    const deps = freshDeps();
    deps.store.createComposition({ width: 100, height: 100, fps: 30, duration: 1 });
    deps.store.registerAsset({
      id: "brand-font",
      type: "font",
      src: "brand.ttf",
      family: "Brand Sans",
    });
    const out = await call("list_fonts", {}, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = out.result as { composition: unknown[]; hint?: string };
    expect(body.composition).toHaveLength(1);
    expect(body.hint).toBeUndefined();
  });
});

describe("render_thumbnail_strip — count cap (R-18)", () => {
  function makeFakeSkia() {
    class Canvas {
      width: number;
      height: number;
      ctx = new FakeContext();
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): FakeContext {
        return this.ctx;
      }
      async toBuffer(): Promise<Uint8Array> {
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
      }
    }
    return {
      Canvas,
      loadImage: async (src: string) => ({ src }),
      FontLibrary: { use: () => undefined },
    };
  }

  function deps(): ToolDeps {
    const store = new CompositionStore();
    store.createComposition({ width: 16, height: 16, fps: 10, duration: 2 });
    return { store, skiaCanvas: makeFakeSkia() as never };
  }

  it("rejects a count above the cap with a structured, hinted E_INVALID_VALUE", async () => {
    const out = await call(
      "render_thumbnail_strip",
      { count: THUMBNAIL_STRIP_MAX_COUNT + 1 },
      deps(),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
    expect(out.error.hint).toContain(String(THUMBNAIL_STRIP_MAX_COUNT));
  });

  it("accepts a count at the cap", async () => {
    const out = await call("render_thumbnail_strip", { count: THUMBNAIL_STRIP_MAX_COUNT }, deps());
    expect(out.ok).toBe(true);
  });
});

describe("render tools — toImages hook for MCP image content blocks (R-17)", () => {
  it("render_preview_frame.toImages splits the base64 image out of the metadata", () => {
    const tool = getTool("render_preview_frame");
    expect(tool.toImages).toBeTypeOf("function");
    const { images, metadata } = tool.toImages!({
      image: "ZmFrZS1wbmc=",
      mimeType: "image/png",
      width: 16,
      height: 16,
    });
    expect(images).toEqual([{ data: "ZmFrZS1wbmc=", mimeType: "image/png" }]);
    expect(metadata).toEqual({ mimeType: "image/png", width: 16, height: 16 });
    expect(metadata).not.toHaveProperty("image");
  });

  it("render_thumbnail_strip.toImages maps each frame to its own image block", () => {
    const tool = getTool("render_thumbnail_strip");
    expect(tool.toImages).toBeTypeOf("function");
    const { images, metadata } = tool.toImages!({
      images: ["aaaa", "bbbb"],
      times: [0, 1],
      mimeType: "image/png",
      width: 8,
      height: 8,
    });
    expect(images).toEqual([
      { data: "aaaa", mimeType: "image/png" },
      { data: "bbbb", mimeType: "image/png" },
    ]);
    expect(metadata).toEqual({ times: [0, 1], mimeType: "image/png", width: 8, height: 8 });
    expect(metadata).not.toHaveProperty("images");
  });
});
