// v1.1 S30: direct tests for the MCP tools the audit found with no coverage —
// update_layer, remove_layer, remove_tween, remove_user_template, get_source_map,
// cancel_render, list_library, get_library_thumbnail, import_scene's sandbox,
// and render_to_video's editor-hosted `wait: true` branch. Drives the
// dispatcher directly (no transport spawn).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type LibraryListArgs,
  type MCPRenderJobSnapshot,
  type MCPRenderStartArgs,
  type ProjectControls,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import type { Composition } from "../../src/schema/types.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function call(name: string, args: Record<string, unknown>, deps: ToolDeps) {
  return dispatchTool(getTool(name), args, deps);
}

async function expectOk(name: string, args: Record<string, unknown>, deps: ToolDeps) {
  const out = await call(name, args, deps);
  if (!out.ok) throw new Error(`${name} failed: ${out.error.code} ${out.error.message}`);
  return out.result;
}

async function expectError(
  name: string,
  args: Record<string, unknown>,
  deps: ToolDeps,
  code: string,
) {
  const out = await call(name, args, deps);
  expect(out.ok).toBe(false);
  if (out.ok) throw new Error("unreachable");
  expect(out.error.code).toBe(code);
  return out.error;
}

async function compWithLayer(): Promise<ToolDeps> {
  const deps: ToolDeps = { store: new CompositionStore() };
  await expectOk("create_composition", { width: 64, height: 64, fps: 10, duration: 1 }, deps);
  await expectOk("add_layer", { id: "main", z: 0 }, deps);
  return deps;
}

async function getComp(deps: ToolDeps): Promise<Composition> {
  const out = (await expectOk("get_composition", {}, deps)) as { json: Composition };
  return out.json;
}

// ──────────────── Layers ────────────────

describe("update_layer", () => {
  it("patches every layer prop and leaves the rest untouched", async () => {
    const deps = await compWithLayer();
    await expectOk(
      "update_layer",
      {
        id: "main",
        props: {
          z: 5,
          opacity: 0.5,
          blendMode: "multiply",
          visible: false,
          locked: true,
          name: "Background",
          enter: 0.2,
          exit: 0.8,
        },
      },
      deps,
    );
    const layer = (await getComp(deps)).layers.find((l) => l.id === "main");
    expect(layer).toMatchObject({
      id: "main",
      z: 5,
      opacity: 0.5,
      blendMode: "multiply",
      visible: false,
      locked: true,
      name: "Background",
      enter: 0.2,
      exit: 0.8,
    });
  });

  it("an empty patch is a no-op", async () => {
    const deps = await compWithLayer();
    const before = (await getComp(deps)).layers;
    await expectOk("update_layer", { id: "main", props: {} }, deps);
    expect((await getComp(deps)).layers).toEqual(before);
  });

  it("rejects an unknown layer with E_NOT_FOUND", async () => {
    const deps = await compWithLayer();
    await expectError("update_layer", { id: "nope", props: { z: 1 } }, deps, "E_NOT_FOUND");
  });

  it("rejects out-of-range opacity at the schema boundary", async () => {
    const deps = await compWithLayer();
    const out = await call("update_layer", { id: "main", props: { opacity: 2 } }, deps);
    expect(out.ok).toBe(false);
  });
});

describe("remove_layer", () => {
  async function withItem(): Promise<ToolDeps> {
    const deps = await compWithLayer();
    await expectOk(
      "add_shape",
      { id: "box", layerId: "main", kind: "rect", x: 0, y: 0, width: 10, height: 10, fillColor: "#ff0000" },
      deps,
    );
    await expectOk(
      "add_tween",
      { id: "fade", target: "box", property: "transform.opacity", from: 0, to: 1, start: 0, duration: 1 },
      deps,
    );
    return deps;
  }

  it("removes an empty layer", async () => {
    const deps = await compWithLayer();
    await expectOk("remove_layer", { id: "main" }, deps);
    expect((await getComp(deps)).layers).toEqual([]);
  });

  it("refuses a non-empty layer without cascade (E_LAYER_NOT_EMPTY)", async () => {
    const deps = await withItem();
    await expectError("remove_layer", { id: "main" }, deps, "E_LAYER_NOT_EMPTY");
    expect((await getComp(deps)).layers).toHaveLength(1);
  });

  it("cascade removes the layer's items and their tweens", async () => {
    const deps = await withItem();
    await expectOk("remove_layer", { id: "main", cascade: true }, deps);
    const comp = await getComp(deps);
    expect(comp.layers).toEqual([]);
    expect(comp.items).toEqual({});
    expect(comp.tweens).toEqual([]);
  });

  it("rejects an unknown layer with E_NOT_FOUND", async () => {
    const deps = await compWithLayer();
    await expectError("remove_layer", { id: "nope" }, deps, "E_NOT_FOUND");
  });
});

// ──────────────── remove_tween ────────────────

describe("remove_tween", () => {
  it("removes one tween and leaves its target and siblings", async () => {
    const deps = await compWithLayer();
    await expectOk(
      "add_shape",
      { id: "box", layerId: "main", kind: "rect", x: 0, y: 0, width: 10, height: 10, fillColor: "#ff0000" },
      deps,
    );
    for (const id of ["fade", "slide"]) {
      await expectOk(
        "add_tween",
        {
          id,
          target: "box",
          property: id === "fade" ? "transform.opacity" : "transform.x",
          from: 0,
          to: 1,
          start: 0,
          duration: 1,
        },
        deps,
      );
    }
    expect(await expectOk("remove_tween", { id: "fade" }, deps)).toEqual({ ok: true });
    const comp = await getComp(deps);
    expect(comp.tweens.map((t) => t.id)).toEqual(["slide"]);
    expect(Object.keys(comp.items)).toEqual(["box"]);
  });

  it("rejects an unknown tween with E_NOT_FOUND", async () => {
    const deps = await compWithLayer();
    await expectError("remove_tween", { id: "nope" }, deps, "E_NOT_FOUND");
  });
});

// ──────────────── remove_user_template ────────────────

describe("remove_user_template", () => {
  const stamp = {
    id: "stamp",
    items: {
      dot: {
        type: "shape",
        kind: "rect",
        width: 4,
        height: 4,
        fillColor: "#ffffff",
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
      },
    },
  };

  async function templateIds(deps: ToolDeps): Promise<string[]> {
    const out = (await expectOk("list_templates", {}, deps)) as { templates: { id: string }[] };
    return out.templates.map((t) => t.id);
  }

  it("drops a session-defined template from the registry", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    await expectOk("define_user_template", stamp, deps);
    expect(await templateIds(deps)).toContain("stamp");
    expect(await expectOk("remove_user_template", { templateId: "stamp" }, deps)).toEqual({ ok: true });
    expect(await templateIds(deps)).not.toContain("stamp");
  });

  it("rejects an unknown id with E_NOT_FOUND", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    await expectError("remove_user_template", { templateId: "stamp" }, deps, "E_NOT_FOUND");
  });

  it("refuses to remove a built-in (process-global) template", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    await expectError("remove_user_template", { templateId: "titleCard" }, deps, "E_NOT_FOUND");
    expect(await templateIds(deps)).toContain("titleCard");
  });

  it("does not leak removal across sessions", async () => {
    const a: ToolDeps = { store: new CompositionStore() };
    const b: ToolDeps = { store: new CompositionStore() };
    await expectOk("define_user_template", stamp, a);
    await expectOk("define_user_template", stamp, b);
    await expectOk("remove_user_template", { templateId: "stamp" }, a);
    expect(await templateIds(b)).toContain("stamp");
  });
});

// ──────────────── get_source_map ────────────────

describe("get_source_map", () => {
  it("maps every imperatively-built item and tween to a literal <root> origin", async () => {
    const deps = await compWithLayer();
    await expectOk(
      "add_shape",
      { id: "box", layerId: "main", kind: "rect", x: 0, y: 0, width: 10, height: 10, fillColor: "#ff0000" },
      deps,
    );
    await expectOk(
      "add_tween",
      { id: "fade", target: "box", property: "transform.opacity", from: 0, to: 1, start: 0, duration: 1 },
      deps,
    );
    const out = (await expectOk("get_source_map", {}, deps)) as {
      sourceMap: {
        items: Record<string, { file: string; jsonPointer: string; originKind: string }>;
        tweens: Record<string, { file: string; jsonPointer: string; originKind: string }>;
      };
    };
    expect(Object.keys(out.sourceMap.items)).toEqual(["box"]);
    expect(Object.keys(out.sourceMap.tweens)).toEqual(["fade"]);
    expect(out.sourceMap.items.box).toMatchObject({ file: "<root>", originKind: "literal" });
    expect(out.sourceMap.tweens.fade).toMatchObject({ file: "<root>", originKind: "literal" });
  });

  it("errors when no composition exists", async () => {
    const deps: ToolDeps = { store: new CompositionStore() };
    const out = await call("get_source_map", {}, deps);
    expect(out.ok).toBe(false);
  });
});

// ──────────────── Render queue: cancel_render + render_to_video wait ────────────────

function snapshot(over: Partial<MCPRenderJobSnapshot> = {}): MCPRenderJobSnapshot {
  return {
    jobId: "j1",
    status: "running",
    outputPath: "/p/renders/out.mp4",
    relativeOutputPath: "renders/out.mp4",
    totalFrames: 10,
    startedAt: 1000,
    progress: null,
    result: null,
    error: null,
    ...over,
  };
}

interface QueueLog {
  started: MCPRenderStartArgs[];
  waited: string[];
  cancelled: { jobId: string; reason: string | undefined }[];
}

async function depsWithQueue(
  finalSnap: MCPRenderJobSnapshot,
  log: QueueLog = { started: [], waited: [], cancelled: [] },
): Promise<ToolDeps> {
  const deps = await compWithLayer();
  const jobs = new Map<string, MCPRenderJobSnapshot>([["j1", snapshot()]]);
  deps.renderControls = {
    start: (args) => {
      log.started.push(args);
      return snapshot({ eventsUrl: "/api/render/j1/events" });
    },
    get: (jobId) => jobs.get(jobId) ?? null,
    list: () => [...jobs.values()],
    waitFor: async (jobId) => {
      log.waited.push(jobId);
      return finalSnap;
    },
    cancel: (jobId, reason) => {
      log.cancelled.push({ jobId, reason });
      const job = jobs.get(jobId);
      if (!job) return null;
      if (job.status === "done" || job.status === "error") return job;
      const next = snapshot({ status: "error", error: { message: reason ?? "" } });
      jobs.set(jobId, next);
      return next;
    },
  };
  return deps;
}

describe("render_to_video — editor-hosted wait: true", () => {
  const done = snapshot({
    status: "done",
    progress: { frame: 10, total: 10, elapsedMs: 50 },
    result: {
      outputPath: "/p/renders/out.mp4",
      relativeOutputPath: "renders/out.mp4",
      frameCount: 10,
      durationMs: 50,
    },
  });

  it("without wait returns the queued snapshot with result: null", async () => {
    const log: QueueLog = { started: [], waited: [], cancelled: [] };
    const deps = await depsWithQueue(done, log);
    const out = (await expectOk("render_to_video", { outputPath: "out.mp4" }, deps)) as {
      status: string;
      result: unknown;
      eventsUrl?: string;
    };
    expect(out.status).toBe("running");
    expect(out.result).toBeNull();
    expect(out.eventsUrl).toBe("/api/render/j1/events");
    expect(log.waited).toEqual([]);
  });

  it("with wait blocks on waitFor and returns the populated result", async () => {
    const log: QueueLog = { started: [], waited: [], cancelled: [] };
    const deps = await depsWithQueue(done, log);
    const out = await expectOk(
      "render_to_video",
      { outputPath: "out.mp4", crf: 18, preset: "fast", from: 0.2, to: 0.6, wait: true },
      deps,
    );
    expect(log.started).toEqual([
      { outputPath: "out.mp4", crf: 18, preset: "fast", range: { from: 0.2, to: 0.6 } },
    ]);
    expect(log.waited).toEqual(["j1"]);
    expect(out).toEqual({
      jobId: "j1",
      status: "done",
      outputPath: "/p/renders/out.mp4",
      relativeOutputPath: "renders/out.mp4",
      totalFrames: 10,
      startedAt: 1000,
      result: done.result,
    });
  });

  it("with wait surfaces a failed job as E_RENDER_FAILED carrying the job's message", async () => {
    const deps = await depsWithQueue(snapshot({ status: "error", error: { message: "ffmpeg exited 1" } }));
    const err = await expectError(
      "render_to_video",
      { outputPath: "out.mp4", wait: true },
      deps,
      "E_RENDER_FAILED",
    );
    expect(err.message).toBe("ffmpeg exited 1");
  });

  it("with wait rejects a terminal job missing its result payload", async () => {
    const deps = await depsWithQueue(snapshot({ status: "done", result: null }));
    const err = await expectError(
      "render_to_video",
      { outputPath: "out.mp4", wait: true },
      deps,
      "E_RENDER_FAILED",
    );
    expect(err.message).toContain("without a result");
  });
});

describe("cancel_render", () => {
  it("marks a running job terminal and forwards the reason", async () => {
    const log: QueueLog = { started: [], waited: [], cancelled: [] };
    const deps = await depsWithQueue(snapshot(), log);
    const out = (await expectOk("cancel_render", { jobId: "j1", reason: "user abort" }, deps)) as MCPRenderJobSnapshot;
    expect(out.status).toBe("error");
    expect(out.error).toEqual({ message: "user abort" });
    expect(log.cancelled).toEqual([{ jobId: "j1", reason: "user abort" }]);
  });

  it("defaults the reason when none is given", async () => {
    const log: QueueLog = { started: [], waited: [], cancelled: [] };
    const deps = await depsWithQueue(snapshot(), log);
    await expectOk("cancel_render", { jobId: "j1" }, deps);
    expect(log.cancelled[0]!.reason).toBe("Render cancelled by MCP client.");
  });

  it("is a no-op on an already-terminal job", async () => {
    const deps = await depsWithQueue(snapshot());
    const first = await expectOk("cancel_render", { jobId: "j1", reason: "one" }, deps);
    const second = await expectOk("cancel_render", { jobId: "j1", reason: "two" }, deps);
    expect(second).toEqual(first);
  });

  it("rejects an unknown job with E_NOT_FOUND", async () => {
    const deps = await depsWithQueue(snapshot());
    await expectError("cancel_render", { jobId: "missing" }, deps, "E_NOT_FOUND");
  });

  it("is E_FEATURE_UNAVAILABLE on the standalone engine", async () => {
    const deps = await compWithLayer();
    await expectError("cancel_render", { jobId: "j1" }, deps, "E_FEATURE_UNAVAILABLE");
  });
});

// ──────────────── Library ────────────────

describe("list_library / get_library_thumbnail", () => {
  function depsWithLibrary(listed: LibraryListArgs[]): ToolDeps {
    return {
      store: new CompositionStore(),
      libraryControls: {
        list: (args) => {
          listed.push(args);
          return {
            root: "/lib",
            roots: [{ scope: "global", path: "/lib" }],
            loadedAt: 0,
            attached: true,
            globalAttached: true,
            projectRoot: null,
            count: 1,
            total: 1,
            query: { q: args.q ?? null, kind: args.kind ?? null, scope: args.scope ?? null },
            items: [{ kind: "template", id: "lowerThird", source: "lowerThird.json", scope: "global" }],
            errors: [],
          };
        },
        thumbnail: ({ kind, id }) => {
          if (kind !== "template" || id !== "lowerThird") {
            throw new Error("unreachable in these tests");
          }
          return { image: "iVBORw0KGgo=", mimeType: "image/png", width: 32, height: 18, placeholder: false };
        },
      },
    };
  }

  it("list_library forwards only the filters that were given", async () => {
    const listed: LibraryListArgs[] = [];
    const deps = depsWithLibrary(listed);
    await expectOk("list_library", {}, deps);
    const out = (await expectOk("list_library", { q: "lower", kind: "template", scope: "global" }, deps)) as {
      items: { id: string }[];
    };
    expect(listed).toEqual([{}, { q: "lower", kind: "template", scope: "global" }]);
    expect(out.items.map((i) => i.id)).toEqual(["lowerThird"]);
  });

  it("list_library rejects an unknown kind at the schema boundary", async () => {
    const out = await call("list_library", { kind: "widget" }, depsWithLibrary([]));
    expect(out.ok).toBe(false);
  });

  it("get_library_thumbnail returns the controller's PNG payload", async () => {
    const out = await expectOk(
      "get_library_thumbnail",
      { kind: "template", id: "lowerThird" },
      depsWithLibrary([]),
    );
    expect(out).toEqual({ image: "iVBORw0KGgo=", mimeType: "image/png", width: 32, height: 18, placeholder: false });
  });

  it.each(["list_library", "get_library_thumbnail"])(
    "%s is E_FEATURE_UNAVAILABLE on the standalone engine",
    async (name) => {
      const deps: ToolDeps = { store: new CompositionStore() };
      await expectError(name, { kind: "template", id: "x" }, deps, "E_FEATURE_UNAVAILABLE");
    },
  );
});

// ──────────────── import_scene sandbox ────────────────

describe("import_scene — filesystem sandbox", () => {
  const scene = {
    id: "card",
    duration: 2,
    items: {
      dot: {
        type: "shape",
        kind: "rect",
        width: 4,
        height: 4,
        fillColor: "#ffffff",
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
      },
    },
    tweens: [],
  };

  let dir: string;
  let prevAllowFs: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "davidup-import-scene-"));
    await mkdir(join(dir, "project", "scenes", "nested"), { recursive: true });
    await writeFile(join(dir, "project", "scenes", "card.json"), JSON.stringify(scene));
    await writeFile(join(dir, "project", "scenes", "nested", "card.json"), JSON.stringify(scene));
    await writeFile(join(dir, "project", "scenes", "broken.json"), "{ not json");
    await writeFile(join(dir, "project", "scenes", "list.json"), "[]");
    await writeFile(join(dir, "project", "scenes", "anon.json"), JSON.stringify({ ...scene, id: undefined }));
    await writeFile(join(dir, "outside.json"), JSON.stringify(scene));
    prevAllowFs = process.env.DAVIDUP_ALLOW_FS;
    delete process.env.DAVIDUP_ALLOW_FS;
  });

  afterEach(async () => {
    if (prevAllowFs === undefined) delete process.env.DAVIDUP_ALLOW_FS;
    else process.env.DAVIDUP_ALLOW_FS = prevAllowFs;
    await rm(dir, { recursive: true, force: true });
  });

  async function sceneIds(deps: ToolDeps): Promise<string[]> {
    const out = (await expectOk("list_scenes", {}, deps)) as { scenes: { id: string }[] };
    return out.scenes.map((s) => s.id);
  }

  describe("standalone engine (no project)", () => {
    it("refuses every read unless DAVIDUP_ALLOW_FS=1", async () => {
      const deps: ToolDeps = { store: new CompositionStore() };
      const err = await expectError(
        "import_scene",
        { path: join(dir, "outside.json") },
        deps,
        "E_INVALID_VALUE",
      );
      expect(err.message).toContain("disabled");
      expect(await sceneIds(deps)).not.toContain("card");
    });

    it("treats any value other than '1' as not opted in", async () => {
      process.env.DAVIDUP_ALLOW_FS = "true";
      const deps: ToolDeps = { store: new CompositionStore() };
      await expectError("import_scene", { path: join(dir, "outside.json") }, deps, "E_INVALID_VALUE");
    });

    it("reads an absolute path once DAVIDUP_ALLOW_FS=1", async () => {
      process.env.DAVIDUP_ALLOW_FS = "1";
      const deps: ToolDeps = { store: new CompositionStore() };
      expect(await expectOk("import_scene", { path: join(dir, "outside.json") }, deps)).toEqual({
        sceneId: "card",
      });
      expect(await sceneIds(deps)).toContain("card");
    });
  });

  describe("editor-hosted (project open)", () => {
    function projectDeps(root: string | null): ToolDeps {
      const controls = {
        current: () =>
          root === null
            ? null
            : { root, compositionPath: join(root, "composition.json"), loadedAt: 0 },
      } as unknown as ProjectControls;
      return { store: new CompositionStore(), projectControls: controls };
    }

    it("resolves relative paths under <project>/scenes/", async () => {
      const deps = projectDeps(join(dir, "project"));
      expect(await expectOk("import_scene", { path: "card.json" }, deps)).toEqual({ sceneId: "card" });
      expect(await expectOk("import_scene", { path: "nested/card.json", id: "nestedCard" }, deps)).toEqual({
        sceneId: "nestedCard",
      });
      expect(await sceneIds(deps)).toEqual(expect.arrayContaining(["card", "nestedCard"]));
    });

    it.each([
      ["a `..` escape", "../../outside.json"],
      ["a sibling-prefix escape", "../scenes-evil/card.json"],
      ["the scenes dir itself", "."],
    ])("refuses %s even with DAVIDUP_ALLOW_FS=1", async (_label, path) => {
      process.env.DAVIDUP_ALLOW_FS = "1";
      const deps = projectDeps(join(dir, "project"));
      const err = await expectError("import_scene", { path }, deps, "E_INVALID_VALUE");
      expect(err.message).toContain("outside the project's scenes/");
    });

    it("refuses an absolute path outside scenes/", async () => {
      const deps = projectDeps(join(dir, "project"));
      await expectError("import_scene", { path: join(dir, "outside.json") }, deps, "E_INVALID_VALUE");
    });

    it("accepts an absolute path that lands inside scenes/", async () => {
      const deps = projectDeps(join(dir, "project"));
      await expectOk("import_scene", { path: join(dir, "project", "scenes", "card.json") }, deps);
    });

    it("needs an open project", async () => {
      const deps = projectDeps(null);
      await expectError("import_scene", { path: "card.json" }, deps, "E_NOT_FOUND");
    });

    it("maps missing, non-JSON, non-object and id-less files to clean errors", async () => {
      const deps = projectDeps(join(dir, "project"));
      await expectError("import_scene", { path: "missing.json" }, deps, "E_NOT_FOUND");
      await expectError("import_scene", { path: "broken.json" }, deps, "E_INVALID_VALUE");
      await expectError("import_scene", { path: "list.json" }, deps, "E_INVALID_VALUE");
      await expectError("import_scene", { path: "anon.json" }, deps, "E_INVALID_VALUE");
      expect(await expectOk("import_scene", { path: "anon.json", id: "named" }, deps)).toEqual({
        sceneId: "named",
      });
    });
  });
});
