// A declarative composition summons an imperative clip in one call (hand-drawn
// film 4.0, D5). What an agent does, over the MCP protocol: a davidup MCP
// server spawned on stdio gets a card built the declarative way (a
// background, a panel, a title that fades in), then one `render_hdf_clip`
// call renders handdrawn's fox-wave on no paper (VP9 with alpha), registers
// it and places it on the card, where the fox waves over the panel with its
// own score. Then validate, a preview frame and the mp4.
//
//   node examples/hdf-clip/agent.mjs [--out examples/hdf-clip/output/fox-on-card.mp4]
//
// The clip lands in handdrawn/out/davidup/ (a standalone server has no
// project); the composition, the preview and the render beside this file.
// None of them is committed.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const W = 1280, H = 720, DUR = 4;
const at = process.argv.indexOf("--out");
const out = resolve(at > 0 ? process.argv[at + 1] : join(HERE, "output", "fox-on-card.mp4"));

const client = new Client({ name: "hdf-clip-agent", version: "1.0.0" }, { capabilities: {} });
await client.connect(new StdioClientTransport({ command: "bun", args: ["run", join(REPO, "src", "mcp", "bin.ts")], cwd: REPO, stderr: "ignore" }));
async function call(name, args, { show = false } = {}) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 600_000 });
  const text = r.content?.find((c) => c.type === "text")?.text ?? "{}";
  if (r.isError) throw new Error(`${name}: ${text}`);
  process.stdout.write(`  ${name} ${JSON.stringify(args).slice(0, 110)}\n`);
  if (show) process.stdout.write(`    -> ${text}\n`);
  try { return JSON.parse(text); } catch { return text; }
}

try {
  // The declarative part: data, no drawing code.
  await call("create_composition", { width: W, height: H, fps: 24, duration: DUR, background: "#2b3a55" });
  await call("add_layer", { id: "card", z: 0 });
  await call("add_shape", { layerId: "card", id: "panel", kind: "rect", x: 80, y: 90, width: 1120, height: 540, cornerRadius: 36, fillColor: "#f4efe4" });
  await call("add_text", { layerId: "card", id: "title", text: "Say hello to the fox", fontSize: 72, color: "#2b3a55", x: 150, y: 300 });
  await call("add_text", { layerId: "card", id: "sub", text: "drawn by hand, placed by data", fontSize: 36, color: "#8a3b2e", x: 150, y: 390 });
  await call("add_tween", { target: "title", property: "transform.opacity", from: 0, to: 1, start: 0, duration: 0.8 });
  await call("add_layer", { id: "cast", z: 10 });

  // The imperative clip, summoned in one call: rendered, registered, placed.
  const clip = await call("render_hdf_clip", {
    film: "fox-wave", alpha: "webm", width: 540,
    place: { layerId: "cast", x: 700, y: 110, width: 500, height: 500, start: 0.5 },
  }, { show: true });

  const v = await call("validate", {});
  if (!v.valid) throw new Error(`validate: ${JSON.stringify(v.errors)}`);
  const comp = await call("get_composition", {});
  writeFileSync(join(HERE, "composition.json"), JSON.stringify(comp.composition ?? comp, null, 1) + "\n");

  mkdirSync(dirname(out), { recursive: true });
  const shot = await client.callTool({ name: "render_preview_frame", arguments: { time: 2, format: "png" } });
  const img = shot.content?.find((c) => c.type === "image");
  if (img) writeFileSync(join(dirname(out), "fox-on-card-2s.png"), Buffer.from(img.data, "base64"));
  const r = await call("render_to_video", { outputPath: out });
  process.stdout.write(`${r.outputPath ?? out}  ${r.result?.frameCount ?? "?"} frames; the fox (${clip.clip.assetId}, ${clip.clip.duration}s) waves on the card from 0.5s\n`);
} finally {
  await client.close();
}
