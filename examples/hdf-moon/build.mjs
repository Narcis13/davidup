// Sam and the real moon (hand-drawn film 4.0, the acceptance film's davidup half; RE-10) — 12 s, 1920×1080.
// A photograph of the full moon, and sam from handdrawn/films/moon.js drawn on no stock beside it
// (handdrawn/films/sam-moon.js as a VP9 alpha clip, D1), cut to the markers on a night pad (D4) and
// captioned by davidup in the film's own hand, exported as a font (D3). Every step is an MCP call an agent
// would make, to a davidup server of its own (D5: render_hdf_clip places the clip).
//
//   node examples/hdf-moon/build.mjs
//
// 1. Makes the pad with ffmpeg: a 12 s night chord, a bell on each cut, the cuts as `cut` markers.
// 2. Exports the film's hand (`HAND` in handdrawn/films/moon.js: hershey-script until yours is read,
//    RE-16) as a font with `hdf hand --export-ttf`.
// 3. Builds the composition through the MCP server: the photo, the pad with its markers, the clip placed
//    by render_hdf_clip (cut to the pad's markers), a caption a shot in the hand; validates it and writes
//    composition.json.
// 4. Renders it with davidup (output/moon-real.mp4).
// 5. Checks it: every cut of the clip, on the composition timeline, is within half a drawn frame (1/24 s)
//    of a `cut` marker. Exits 1 if not.
//
// full-moon.jpg is committed (Gregory H. Revera, CC BY-SA 3.0; see README.md) and registered with that
// credit and licence (RE-14), so validate is clean. Nothing the script writes is committed (see .gitignore).

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", ".."), HDF = join(REPO, "handdrawn");
const W = 1920, H = 1080, DUR = 12, CUTS = [3.5, 7.5];
const PHOTO = { w: 1290, h: 1226 }, MOON_H = 940;   // full-moon.jpg's size; drawn MOON_H tall, right of centre
const MOON_CREDIT = "\"FullMoon2010.jpg\" by Gregory H. Revera, CC BY-SA 3.0, via Wikimedia Commons";

function run(cmd, args, cwd = REPO) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) { process.stderr.write(`${cmd} ${args.join(" ")} failed\n${r.stdout ?? ""}`); process.exit(1); }
  return r.stdout;
}
mkdirSync(join(HERE, "assets"), { recursive: true });
mkdirSync(join(HERE, "output"), { recursive: true });

// 1. The pad: A minor with a ninth, breathing every 4 s, faded in and out; a soft bell on each cut.
const pad = "0.07*(sin(2*PI*110*t)+sin(2*PI*130.81*t)+sin(2*PI*164.81*t)+0.6*sin(2*PI*246.94*t))"
  + `*(0.7+0.3*sin(2*PI*0.25*t))*min(t/1.5\\,1)*min((${DUR}-t)/1.5\\,1)`;
const bells = CUTS.map((c) => `gte(t\\,${c})*0.18*sin(2*PI*880*(t-${c}))*exp(-3*(t-${c}))`).join("+");
const padWav = join(HERE, "assets", "night-pad.wav");
run(process.env.FFMPEG ?? "ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
  `aevalsrc='${pad}+${bells}':s=44100:d=${DUR}`, "-ac", "2", padWav]);
process.stdout.write(`${padWav}  ${DUR}s, cuts at ${CUTS.join(", ")}s\n`);

// 2. The hand, as the film letters its sign-off.
const { HAND } = await import(pathToFileURL(join(HDF, "films", "moon.js")).href);
process.stdout.write(run(process.execPath, ["cli/hdf.mjs", "hand", "--export-ttf", HAND, "--out", "out"], HDF));
const ttf = join(HERE, "assets", `${HAND}.ttf`);
copyFileSync(join(HDF, "out", `${HAND}.ttf`), ttf);

// 3. The agent's calls.
const client = new Client({ name: "hdf-moon", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "bun", args: ["run", join(REPO, "src", "mcp", "bin.ts")], cwd: REPO, stderr: "inherit" }));
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.find((c) => c.type === "text")?.text ?? "{}";
  if (r.isError) throw new Error(`${name}: ${text}`);
  process.stdout.write(`  ${name} ${JSON.stringify(args).slice(0, 110)}\n`);
  try { return JSON.parse(text); } catch { return text; }
}

const file = join(HERE, "composition.json");
let clip;
try {
  await call("create_composition", { width: W, height: H, fps: 24, duration: DUR, background: "#000000" });
  await call("register_asset", { id: "moon", type: "image", src: join(HERE, "full-moon.jpg"), licence: "CC-BY-SA", credit: MOON_CREDIT });
  await call("register_asset", { id: "hand", type: "font", src: ttf, family: `hdf-${HAND}` });
  await call("register_asset", { id: "pad", type: "audio", src: padWav });
  await call("add_audio_track", { id: "pad", asset: "pad", start: 0, end: DUR, volume: 0.8, markers: CUTS.map((t) => ({ t, name: "cut" })) });

  await call("add_layer", { id: "photo", z: 0 });
  const k = MOON_H / PHOTO.h;
  await call("add_sprite", { layerId: "photo", id: "moon", asset: "moon", x: 1330, y: 550, width: Math.round(PHOTO.w * k), height: MOON_H, anchorX: 0.5, anchorY: 0.5 });

  // sam: the clip's 1080 square on the left, his feet on the photo's floor; cut to the pad's markers.
  await call("add_layer", { id: "sam", z: 10 });
  clip = await call("render_hdf_clip", { film: "sam-moon", alpha: "webm", width: 1080, place: { layerId: "sam", id: "sam", x: -60, y: 20, width: 1080, height: 1080 } });

  // A caption a shot, in the hand, faded in on its cut and out before the next.
  await call("add_layer", { id: "captions", z: 20 });
  const lines = [["this is the real moon", "#f4efe4"], ["the sun lights up half of it", "#f3cf73"], ["good night!", "#f4efe4"]];
  const edges = [0, ...CUTS, DUR];
  for (const [j, [text, color]] of lines.entries()) {
    const id = `caption${j + 1}`, t0 = edges[j], t1 = edges[j + 1];
    await call("add_text", { layerId: "captions", id, text, font: "hand", fontSize: 100, color, x: 110, y: 130, anchorX: 0, anchorY: 0, maxWidth: 620, lineHeight: 1.25, opacity: 0 });
    await call("add_tween", { target: id, property: "transform.opacity", from: 0, to: 1, start: t0 + 0.2, duration: 0.6, easing: "easeOutCubic" });
    if (t1 < DUR) await call("add_tween", { target: id, property: "transform.opacity", from: 1, to: 0, start: t1 - 0.35, duration: 0.3, easing: "easeInCubic" });
  }

  const v = await call("validate", {});
  process.stdout.write(`validate: ${v.errors.length} errors, ${v.warnings.length} warnings${v.warnings.map((w) => `\n  ${w.code} ${w.message}`).join("")}\n`);
  if (!v.valid) throw new Error("the composition does not validate");
  // Written with its files relative to this folder, so the render reads them from here.
  const { json } = await call("get_composition", {});
  for (const a of json.assets) if (isAbsolute(a.src)) a.src = relative(HERE, a.src);
  writeFileSync(file, JSON.stringify(json, null, 1) + "\n");
  process.stdout.write(`${file}\n`);
} finally {
  await client.close();
}

// 4. davidup renders it.
const mp4 = join(HERE, "output", "moon-real.mp4");
run("bun", ["run", "src/cli/bin.ts", "render", file, "-o", mp4]);
process.stdout.write(`${mp4}\n`);

// 5. The check: the clip's cuts, as hdf plays them against this composition, on the pad's markers.
const doc = JSON.parse(readFileSync(file, "utf8")), item = doc.items[clip.itemId];
const at = (item.start ?? 0) - (item.trimIn ?? 0);
const printed = run(process.execPath, ["cli/hdf.mjs", "cues", "films/sam-moon.js", "--cues-from", file, "--at", clip.itemId, "--out", "out"], HDF);
const cues = JSON.parse(readFileSync(printed.trim().split("\n").map((l) => l.trim().split(/\s+/)[0]).find((f) => f.endsWith(".json")), "utf8"));
const marks = doc.audio.flatMap((a) => (a.markers ?? []).filter((m) => m.name === "cut").map((m) => a.start + m.t - (a.trimIn ?? 0)));
let ok = cues.cuts.length === marks.length;
process.stdout.write("\ncut      composition  nearest marker  off\n");
for (const t of cues.cuts) {
  const c = at + t, near = marks.reduce((a, m) => (Math.abs(m - c) < Math.abs(a - c) ? m : a));
  const off = c - near, good = Math.abs(off) <= 1 / 24 + 1e-6;
  ok &&= good;
  process.stdout.write(`${t.toFixed(3)}s   ${c.toFixed(3)}s       ${near.toFixed(3)}s          ${(off * 1000).toFixed(1)} ms${good ? "" : "  (off the marker)"}\n`);
}
process.stdout.write(ok ? `\nsam's ${cues.cuts.length} cuts are on the pad's ${marks.length} markers\n` : "\nFAILED\n");
process.exit(ok ? 0 : 1);
