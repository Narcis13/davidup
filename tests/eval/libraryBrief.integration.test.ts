// The eval harness scores the library brief (asset-library plan S1) end to
// end — spawned standalone MCP server, render, frame inspection, and the
// "find before placing" check on the tool trace — with a scripted model in
// place of Claude, so it runs without an API key. The live run is
// `bun run eval:agents --only library-opener` (agentEval.integration.test.ts
// runs it when a credential is set).
//
// The script is the walk README and examples/mcp-demo.md document:
// search_assets → get_asset_preview → use_asset, then text, tweens, validate.

import type Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { BRIEFS } from "../../scripts/eval-agents/briefs.js";
import { runBrief } from "../../scripts/eval-agents/runBrief.js";

type Call = [name: string, input: Record<string, unknown>];

const TURNS: Call[][] = [
  [["create_composition", { width: 960, height: 540, fps: 24, duration: 6, background: "#f3ead8" }]],
  [
    ["search_assets", { q: "warm paper", media: "raster", limit: 3 }],
    ["search_assets", { q: "fox walk", kind: ["image"], limit: 3 }],
    ["search_assets", { q: "handwritten", kind: ["font"], limit: 3 }],
    ["search_assets", { q: "pop", media: "audio", limit: 3 }],
  ],
  [["get_asset_preview", { ids: ["paper-warm", "fox-sprite", "hershey-script-font", "sfx-pop"] }]],
  [
    ["add_layer", { id: "bg", z: 0 }],
    ["add_layer", { id: "main", z: 1 }],
  ],
  [
    ["use_asset", { id: "paper-warm", place: { layerId: "bg", width: 960, height: 540 } }],
    ["use_asset", { id: "fox-sprite", place: { layerId: "main", id: "fox", x: -120, y: 470, cycle: "walk" } }],
    ["use_asset", { id: "hershey-script-font" }],
    ["use_asset", { id: "sfx-pop", place: { start: 3 } }],
  ],
  [
    ["add_tween", { target: "fox", property: "transform.x", from: -120, to: 330, start: 0, duration: 2.5 }],
    [
      "add_text",
      {
        layerId: "main",
        id: "title",
        text: "How foxes learn",
        font: "hershey-script-font",
        fontSize: 64,
        color: "#2b2622",
        x: 470,
        y: 270,
        opacity: 0,
      },
    ],
    ["add_tween", { target: "title", property: "transform.opacity", from: 0, to: 1, start: 2.6, duration: 0.4 }],
  ],
  [["validate", {}]],
];

/** A stand-in for the Messages API that plays TURNS, one assistant turn per call, then ends. */
function scriptedModel(): Anthropic {
  let turn = 0;
  const usage = { input_tokens: 0, output_tokens: 0 };
  const create = async () => {
    const calls = TURNS[turn++];
    if (!calls) return { content: [{ type: "text", text: "Built the opening." }], stop_reason: "end_turn", usage };
    return {
      content: calls.map(([name, input], i) => ({ type: "tool_use", id: `toolu_${turn}_${i}`, name, input })),
      stop_reason: "tool_use",
      usage,
    };
  };
  return { messages: { create } } as unknown as Anthropic;
}

const renderDir = mkdtempSync(join(tmpdir(), "davidup-eval-library-"));
afterAll(() => rmSync(renderDir, { recursive: true, force: true }));

describe("the library brief, scored by the eval harness (asset-library plan S1)", () => {
  it(
    "passes when the agent searches before it places, and every asset is a pinned library record",
    async () => {
      const brief = BRIEFS.find((b) => b.id === "library-opener");
      if (!brief) throw new Error("library-opener brief fixture not found");

      const entry = await runBrief(brief, scriptedModel(), { renderDir });

      expect(entry.agent?.toolErrors).toEqual([]);
      expect(entry.agent?.finishedNaturally).toBe(true);
      const trace = entry.agent!.toolTrace.map((t) => t.name);
      expect(trace.indexOf("search_assets")).toBeLessThan(trace.indexOf("use_asset"));
      expect(trace).not.toContain("register_asset");

      expect(entry.library).toMatchObject({ ran: true, passed: true, firstSearch: 1, firstPlace: 8, otherAssets: [] });
      expect(entry.library?.libraryAssets).toEqual(["paper-warm", "fox-sprite", "hershey-script-font", "sfx-pop"]);
      expect(entry.validate).toMatchObject({ valid: true, errors: [] });
      expect(entry.render.succeeded).toBe(true);
      expect(entry.frames).toMatchObject({ dimensionsMatch: true, durationMatches: true, allFramesNonBlank: true });
      expect(entry.errors).toEqual([]);
      expect(entry.passed).toBe(true);
    },
    5 * 60 * 1000,
  );
});
