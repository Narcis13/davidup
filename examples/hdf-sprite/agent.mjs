// sam walks on, as a sprite (hand-drawn film 4.0, D2) — 6 s, 1280×720, no
// video anywhere. What an agent does, over the MCP protocol: `hdf sprite`
// draws sam (walk-on's stick teacher) as a sprite sheet, then a davidup MCP
// server spawned on stdio gets the calls an agent would make —
// register_asset with the sheet, add_sprite with `cycle: "walk"`, a tween
// that moves it at the sheet's own speed so the feet do not slide, and a
// second sprite on the same sheet, held on `happy`, that takes over where the
// walk stops (lifespans: the walk's `exit` is the happy one's `enter`).
//
//   node examples/hdf-sprite/agent.mjs [--out examples/hdf-sprite/output/sam-walks.mp4]
//
// The sheet lands in assets/ and the composition beside this file; neither is
// committed (see .gitignore).

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const W = 1280, H = 720, FLOOR = 600, DUR = 6, WALK = [0.5, 4];
const at = process.argv.indexOf("--out");
const out = resolve(at > 0 ? process.argv[at + 1] : join(HERE, "output", "sam-walks.mp4"));

// 1. The sheet: sam from walk-on's cast, on no stock, 240 px a frame.
const hdf = spawnSync(process.execPath, ["cli/hdf.mjs", "sprite", "sam", "--film", "films/walk-on.js", "--states", "walk,happy",
  "--h", "240", "--alpha", "--out", "out"], { cwd: join(REPO, "handdrawn"), encoding: "utf8" });
if (hdf.status !== 0) throw new Error(`hdf sprite: ${hdf.stderr || hdf.stdout}`);
process.stdout.write(hdf.stdout);
const json = JSON.parse(readFileSync(join(REPO, "handdrawn", "out", "sam-sprite-alpha.json"), "utf8"));
mkdirSync(join(HERE, "assets"), { recursive: true });
const png = join(HERE, "assets", "sam-sprite.png");
copyFileSync(join(REPO, "handdrawn", "out", json.image), png);
const { frameWidth, frameHeight, columns, count, fps, cycles, anchor } = json;
const sheet = { frameWidth, frameHeight, columns, count, fps, cycles, anchor };

// 2. The agent's calls, to a davidup MCP server of its own.
const client = new Client({ name: "hdf-sprite-agent", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "bun", args: ["run", join(REPO, "src", "mcp", "bin.ts")], cwd: REPO, stderr: "inherit" }));
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.find((c) => c.type === "text")?.text ?? "{}";
  if (r.isError) throw new Error(`${name}: ${text}`);
  process.stdout.write(`  ${name} ${JSON.stringify(args).slice(0, 110)}\n`);
  try { return JSON.parse(text); } catch { return text; }
}

try {
  await call("create_composition", { width: W, height: H, fps: 24, duration: DUR, background: "#f4efe4" });
  await call("register_asset", { id: "sam", type: "image", src: png, sheet });
  await call("add_layer", { id: "stage", z: 0 });
  await call("add_shape", { layerId: "stage", id: "floor", kind: "rect", x: 0, y: FLOOR, width: W, height: 4, fillColor: "#2b2a33" });
  await call("add_layer", { id: "cast", z: 10 });
  // Walking from off the left edge at the sheet's speed, feet on the floor; it stops where the time runs out.
  const x0 = -frameWidth, x1 = x0 + cycles.walk.speed * (WALK[1] - WALK[0]);
  const place = { width: frameWidth, height: frameHeight, anchorX: anchor.x, anchorY: anchor.y, y: FLOOR };
  await call("add_sprite", { layerId: "cast", id: "sam-walk", asset: "sam", x: x0, ...place, cycle: "walk", name: "sam walking" });
  await call("update_item", { id: "sam-walk", props: { exit: WALK[1] } });
  await call("add_tween", { target: "sam-walk", property: "transform.x", from: x0, to: x1, start: WALK[0], duration: WALK[1] - WALK[0] });
  await call("add_sprite", { layerId: "cast", id: "sam-happy", asset: "sam", x: x1, ...place, cycle: "happy", name: "sam, pleased" });
  await call("update_item", { id: "sam-happy", props: { enter: WALK[1] } });
  const v = await call("validate", {});
  if (!v.valid) throw new Error(`validate: ${JSON.stringify(v.errors)}`);
  const comp = await call("get_composition", {});
  writeFileSync(join(HERE, "composition.json"), JSON.stringify(comp.composition ?? comp, null, 1) + "\n");
  mkdirSync(dirname(out), { recursive: true });
  const r = await call("render_to_video", { outputPath: out });
  process.stdout.write(`${r.outputPath ?? out}  ${r.result?.frameCount ?? "?"} frames, sam walks ${Math.round(x1 - x0)} px and stops\n`);
} finally {
  await client.close();
}
