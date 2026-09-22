// A title in the film's own hand, set by davidup (hand-drawn film 4.0, D3).
// `hdf hand --export-ttf` writes a stored hand as a TrueType font; a davidup
// MCP server spawned on stdio then gets the calls an agent would make —
// register_asset with `type: "font"`, add_text in that font, a fade — and
// renders a frame through davidup's own text path (skia's FontLibrary and
// fillText, no handdrawn code). The frame lands next to hdf's proof of the
// same hand, lettered by handText, to compare by eye.
//
//   node examples/hdf-font/agent.mjs [--hand test] [--out examples/hdf-font/output]
//
// --hand is any hand in handdrawn's store (yours, once `hdf hand <photos>
// --name <you>` has read your sheet), or house. The font lands in assets/ and
// the composition beside this file; neither is committed (see .gitignore).

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const W = 1280, H = 720;
const flag = (name, dflt) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : dflt; };
const hand = flag("hand", "test");
const outDir = resolve(flag("out", join(HERE, "output")));

// 1. The font: the hand swept by its pen into out/<hand>.ttf (and out/<hand>-ttf.png, hdf's proof).
const hdf = spawnSync(process.execPath, ["cli/hdf.mjs", "hand", "--export-ttf", hand, "--out", "out",
  "--text", "The hedgehog and the moon"], { cwd: join(REPO, "handdrawn"), encoding: "utf8" });
if (hdf.status !== 0) throw new Error(`hdf hand --export-ttf: ${hdf.stderr || hdf.stdout}`);
process.stdout.write(hdf.stdout);
mkdirSync(join(HERE, "assets"), { recursive: true });
const ttf = join(HERE, "assets", `${hand}.ttf`);
copyFileSync(join(REPO, "handdrawn", "out", `${hand}.ttf`), ttf);

// 2. The agent's calls, to a davidup MCP server of its own.
const client = new Client({ name: "hdf-font-agent", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "bun", args: ["run", join(REPO, "src", "mcp", "bin.ts")], cwd: REPO, stderr: "inherit" }));
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.find((c) => c.type === "text")?.text ?? "{}";
  if (r.isError) throw new Error(`${name}: ${text}`);
  process.stdout.write(`  ${name} ${JSON.stringify(args).slice(0, 110)}\n`);
  const image = r.content?.find((c) => c.type === "image");
  if (image) return { image: Buffer.from(image.data, "base64") };
  try { return JSON.parse(text); } catch { return text; }
}

try {
  await call("create_composition", { width: W, height: H, fps: 24, duration: 3, background: "#f4efe4" });
  await call("register_asset", { id: "hand", type: "font", src: ttf, family: `hdf-${hand}` });
  await call("add_layer", { id: "titles", z: 0 });
  await call("add_text", { layerId: "titles", id: "title", text: "The hedgehog and the moon", font: "hand", fontSize: 96,
    color: "#1b1a17", x: W / 2, y: 300, anchorX: 0.5, anchorY: 0.5, align: "center" });
  await call("add_text", { layerId: "titles", id: "sub", text: "a film in one hand, set by davidup", font: "hand", fontSize: 44,
    color: "#8a3b2e", x: W / 2, y: 430, anchorX: 0.5, anchorY: 0.5, align: "center" });
  await call("add_tween", { target: "title", property: "transform.opacity", from: 0, to: 1, start: 0, duration: 0.8 });
  const v = await call("validate", {});
  if (!v.valid) throw new Error(`validate: ${JSON.stringify(v.errors)}`);
  const comp = await call("get_composition", {});
  writeFileSync(join(HERE, "composition.json"), JSON.stringify(comp.composition ?? comp, null, 1) + "\n");
  const frame = await call("render_preview_frame", { time: 2, format: "png" });
  mkdirSync(outDir, { recursive: true });
  const png = join(outDir, `title-${hand}.png`);
  writeFileSync(png, frame.image);
  copyFileSync(join(REPO, "handdrawn", "out", `${hand}-ttf.png`), join(outDir, `proof-${hand}.png`));
  process.stdout.write(`${png}  the title as davidup draws it\n${join(outDir, `proof-${hand}.png`)}  the font (top) over handText (bottom)\n`);
} finally {
  await client.close();
}
