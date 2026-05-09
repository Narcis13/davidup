// End-to-end smoke test for the MCP server (per implementation plan §8 + design-doc §4).
//
// Spawns a real `bun src/mcp/bin.ts` subprocess connected over stdio, then
// drives it through the §4 lifecycle the design doc recommends:
//   create_composition → add_layer → add_shape/add_text → add_tween →
//   validate → render_preview_frame → render_thumbnail_strip → reset.
//
// Asserts:
//   1. tools/list returns every tool from the design doc (count + names).
//   2. Tool calls return structuredContent shaped as the design specifies
//      (success payloads or `{error:{code,message,hint?}}` envelopes).
//   3. Preview output is real base64 PNG bytes (matches the file signature).
//   4. Tween overlap on the same (target, property) yields E_TWEEN_OVERLAP
//      with a hint, not a thrown protocol error.

import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../../src/mcp/index.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const REPO_ROOT = (() => {
  // tests/mcp/server.integration.test.ts → repo root
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..");
})();
const BIN_PATH = join(REPO_ROOT, "src", "mcp", "bin.ts");

interface ToolCallEnvelope {
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function structured(result: ToolCallEnvelope): Record<string, unknown> {
  // Prefer the structured payload (machine-readable); fall back to parsing
  // the text content for SDK builds that don't surface structuredContent.
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Tool result had no structured or text content.");
  return JSON.parse(text) as Record<string, unknown>;
}

describe("MCP server — end-to-end over stdio", () => {
  let transport: StdioClientTransport;
  let client: Client;

  beforeEach(async () => {
    if (!existsSync(BIN_PATH)) {
      throw new Error(`bin not found at ${BIN_PATH}`);
    }
    transport = new StdioClientTransport({
      command: "bun",
      args: ["run", BIN_PATH],
      cwd: REPO_ROOT,
      stderr: "pipe",
    });
    client = new Client({ name: "davidup-test", version: "0.0.0" });
    await client.connect(transport);
  });

  afterEach(async () => {
    try {
      await client.close();
    } catch {
      // ignore close errors during teardown
    }
    try {
      await transport.close();
    } catch {
      // ignore
    }
  });

  it("exposes every §4 tool via tools/list", async () => {
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    const expected = [...TOOL_NAMES].sort();
    expect(names).toEqual(expected);
    expect(names).toHaveLength(27);
    // Spot-check that each surface area is covered.
    for (const required of [
      "create_composition",
      "validate",
      "register_asset",
      "add_layer",
      "add_sprite",
      "add_text",
      "add_shape",
      "add_group",
      "add_tween",
      "apply_behavior",
      "list_behaviors",
      "render_preview_frame",
      "render_thumbnail_strip",
      "render_to_video",
    ]) {
      expect(names).toContain(required);
    }
  }, 30_000);

  it(
    "drives a build → validate → render_preview_frame → render_thumbnail_strip flow",
    async () => {
      // 1. create_composition
      const create = (await client.callTool({
        name: "create_composition",
        arguments: {
          width: 120,
          height: 80,
          fps: 10,
          duration: 0.5,
          background: "#000020",
        },
      })) as ToolCallEnvelope;
      expect(create.isError).not.toBe(true);
      const created = structured(create);
      expect(typeof created.compositionId).toBe("string");

      // 2. add_layer
      const layer = structured(
        (await client.callTool({
          name: "add_layer",
          arguments: { z: 0 },
        })) as ToolCallEnvelope,
      );
      expect(typeof layer.layerId).toBe("string");
      const layerId = layer.layerId as string;

      // 3. add_shape
      const shape = structured(
        (await client.callTool({
          name: "add_shape",
          arguments: {
            layerId,
            kind: "rect",
            x: 60,
            y: 40,
            width: 40,
            height: 40,
            fillColor: "#ff8800",
            cornerRadius: 6,
            anchorX: 0.5,
            anchorY: 0.5,
            opacity: 1,
          },
        })) as ToolCallEnvelope,
      );
      const itemId = shape.itemId as string;
      expect(typeof itemId).toBe("string");

      // update_item — patch the transform anchor; confirms the partial-update path.
      const updated = structured(
        (await client.callTool({
          name: "update_item",
          arguments: {
            id: itemId,
            props: { anchorX: 0.5, anchorY: 0.5, opacity: 0 },
          },
        })) as ToolCallEnvelope,
      );
      expect(updated.ok).toBe(true);

      // 4. add_tween — fade-in from 0 to 1 over [0, 0.4]
      const tween = structured(
        (await client.callTool({
          name: "add_tween",
          arguments: {
            target: itemId,
            property: "transform.opacity",
            from: 0,
            to: 1,
            start: 0,
            duration: 0.4,
            easing: "easeOutQuad",
          },
        })) as ToolCallEnvelope,
      );
      expect(typeof tween.tweenId).toBe("string");

      // 5. add_tween overlap → structured error
      const overlap = (await client.callTool({
        name: "add_tween",
        arguments: {
          target: itemId,
          property: "transform.opacity",
          from: 1,
          to: 0,
          start: 0.1,
          duration: 0.2,
        },
      })) as ToolCallEnvelope;
      expect(overlap.isError).toBe(true);
      const overlapBody = structured(overlap);
      expect(overlapBody).toHaveProperty("error");
      const overlapErr = overlapBody.error as {
        code: string;
        message: string;
        hint?: string;
      };
      expect(overlapErr.code).toBe("E_TWEEN_OVERLAP");
      expect(typeof overlapErr.message).toBe("string");
      expect(typeof overlapErr.hint).toBe("string");

      // 6. validate → must be valid
      const validate = structured(
        (await client.callTool({
          name: "validate",
          arguments: {},
        })) as ToolCallEnvelope,
      );
      expect(validate.valid).toBe(true);
      expect(validate.errors).toEqual([]);

      // 7. render_preview_frame → base64 PNG with magic bytes
      const preview = structured(
        (await client.callTool({
          name: "render_preview_frame",
          arguments: { time: 0.2 },
        })) as ToolCallEnvelope,
      );
      expect(preview.mimeType).toBe("image/png");
      expect(typeof preview.image).toBe("string");
      const previewBytes = Buffer.from(preview.image as string, "base64");
      expect(previewBytes.length).toBeGreaterThan(8);
      expect(previewBytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect(preview.width).toBe(120);
      expect(preview.height).toBe(80);

      // 8. render_thumbnail_strip — 3 uniformly-sampled frames
      const strip = structured(
        (await client.callTool({
          name: "render_thumbnail_strip",
          arguments: { count: 3 },
        })) as ToolCallEnvelope,
      );
      const images = strip.images as string[];
      expect(Array.isArray(images)).toBe(true);
      expect(images).toHaveLength(3);
      for (const img of images) {
        const bytes = Buffer.from(img, "base64");
        expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      }
      const times = strip.times as number[];
      expect(times).toEqual([0, 0.25, 0.5]);

      // 9. get_composition — sanity check serialised JSON shape
      const got = structured(
        (await client.callTool({
          name: "get_composition",
          arguments: {},
        })) as ToolCallEnvelope,
      );
      const json = got.json as {
        composition: { width: number; height: number };
        items: Record<string, unknown>;
      };
      expect(json.composition.width).toBe(120);
      expect(Object.keys(json.items)).toContain(itemId);

      // 10. reset — drops the composition; further calls should fail.
      const reset = structured(
        (await client.callTool({
          name: "reset",
          arguments: {},
        })) as ToolCallEnvelope,
      );
      expect(reset.ok).toBe(true);

      const afterReset = (await client.callTool({
        name: "get_composition",
        arguments: {},
      })) as ToolCallEnvelope;
      expect(afterReset.isError).toBe(true);
      const errBody = structured(afterReset);
      expect((errBody.error as { code: string }).code).toBe("E_NO_COMPOSITION");
    },
    60_000,
  );

  it("returns structured E_VALIDATION_FAILED when rendering an invalid composition", async () => {
    // Composition with an asset reference that doesn't exist → validator fails
    // → render_preview_frame must surface the structured error code.
    await client.callTool({
      name: "create_composition",
      arguments: { width: 32, height: 32, fps: 10, duration: 0.2 },
    });
    const layer = structured(
      (await client.callTool({
        name: "add_layer",
        arguments: { z: 0 },
      })) as ToolCallEnvelope,
    );
    await client.callTool({
      name: "add_sprite",
      arguments: {
        layerId: layer.layerId as string,
        asset: "nonexistent-asset",
        x: 0,
        y: 0,
        width: 16,
        height: 16,
      },
    });

    const result = (await client.callTool({
      name: "render_preview_frame",
      arguments: { time: 0 },
    })) as ToolCallEnvelope;
    expect(result.isError).toBe(true);
    const body = structured(result);
    const err = body.error as { code: string; message: string; hint?: string };
    expect(err.code).toBe("E_VALIDATION_FAILED");
    expect(typeof err.hint).toBe("string");
  }, 30_000);
});
