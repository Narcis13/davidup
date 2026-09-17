// v1.1 S9: render_to_video accepts the alpha codecs and rejects an output
// extension that can't hold the codec with E_CONTAINER_CODEC — before
// validating or rendering anything.

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type MCPRenderStartArgs,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

function depsWithQueue(started: MCPRenderStartArgs[]): ToolDeps {
  const store = new CompositionStore();
  store.createComposition({ width: 16, height: 16, fps: 10, duration: 0.1, background: "transparent" });
  const snap = {
    jobId: "j1",
    status: "running" as const,
    outputPath: "/p/renders/x",
    relativeOutputPath: "renders/x",
    totalFrames: 1,
    startedAt: 0,
    progress: null,
    result: null,
    error: null,
  };
  return {
    store,
    renderControls: {
      start: (args) => {
        started.push(args);
        return snap;
      },
      get: () => snap,
      list: () => [snap],
      cancel: () => ({ ok: true }),
      waitFor: () => snap,
    } as unknown as ToolDeps["renderControls"],
  };
}

describe("render_to_video — alpha codecs (v1.1 S9)", () => {
  it.each([
    ["overlay.mp4", "prores_ks", ".mov"],
    ["overlay.mov", "libvpx-vp9", ".webm"],
    ["overlay.webm", "libx264", ".mp4"],
  ])("rejects %s with codec %s", async (outputPath, codec, want) => {
    const started: MCPRenderStartArgs[] = [];
    const out = await dispatchTool(
      getTool("render_to_video"),
      { outputPath, codec },
      depsWithQueue(started),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_CONTAINER_CODEC");
    expect(out.error.message).toContain(`use ${want}`);
    expect(started).toHaveLength(0);
  });

  it("forwards prores_ks → .mov to the render queue", async () => {
    const started: MCPRenderStartArgs[] = [];
    const out = await dispatchTool(
      getTool("render_to_video"),
      { outputPath: "overlay.mov", codec: "prores_ks" },
      depsWithQueue(started),
    );
    expect(out.ok).toBe(true);
    expect(started).toEqual([{ outputPath: "overlay.mov", codec: "prores_ks" }]);
  });
});
