// handdrawn × davidup — 20 s, 1920×1080. Two films from the handdrawn package
// (the same three scenes in two looks) and the fox's model sheet, bridged in
// with scripts/hdf-to-davidup.ts and composed as ordinary davidup assets.
//
//   bun run scripts/hdf-to-davidup.ts fox-and-teapot --project examples/hdf-interop
//   bun run scripts/hdf-to-davidup.ts cutout-fox --project examples/hdf-interop --no-sheets
//   node examples/hdf-interop/build.mjs
//   bun run src/cli/bin.ts render examples/hdf-interop/composition.json -o examples/hdf-interop/output/hdf-interop.mp4

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "composition.json");

const BG = "#14110f", CREAM = "#f3ead8", DIM = "#9a8f7c", ORANGE = "#ff8a3d", PINK = "#ff6fae";
const W = 1920, H = 1080;

const T = (x, y, o = {}) => ({
  x, y, scaleX: o.s ?? 1, scaleY: o.s ?? 1, rotation: o.r ?? 0,
  anchorX: o.ax ?? o.a ?? 0.5, anchorY: o.ay ?? o.a ?? 0.5, opacity: o.o ?? 1,
});
const items = {}, tweens = [], layers = {};
const add = (layer, id, item) => { items[id] = item; (layers[layer] ??= []).push(id); };
let n = 0;
const tw = (target, property, from, to, start, duration, easing = "easeOutCubic") =>
  tweens.push({ id: `tw${n++}`, target, property, from, to, start, duration, easing });
const fade = (id, a, b, inDur = 0.5, outDur = 0.5) => {
  tw(id, "transform.opacity", 0, 1, a, inDur);
  tw(id, "transform.opacity", 1, 0, b - outDur, outDur, "easeInCubic");
};
const text = (s, font, size, color, x, y, o = {}) => ({
  type: "text", text: s, font, fontSize: size, color, align: o.align ?? "center",
  letterSpacing: o.ls, transform: T(x, y, { o: 0, ...o }),
});
const rect = (w, h, fill, x, y, o = {}) => ({
  type: "shape", kind: "rect", width: w, height: h, fillColor: fill, cornerRadius: o.cr ?? 0,
  transform: T(x, y, { o: 0, ...o }),
});

// ── 0–3 s: title ───────────────────────────────────────────────────────────
add("text", "t-kicker", text("HAND-DRAWN FILM 3.0  →  DAVIDUP", "font-mono", 26, ORANGE, W / 2, 400, { ls: 4 }));
add("text", "t-title", text("A FILM IS JUST ANOTHER CLIP", "font-display", 150, CREAM, W / 2, 520));
add("text", "t-sub", text("drawn on twos by the handdrawn package · composed by davidup", "font-mono", 28, DIM, W / 2, 640));
fade("t-kicker", 0.2, 3); fade("t-title", 0.4, 3); fade("t-sub", 0.8, 3);
tw("t-title", "transform.y", 560, 520, 0.4, 0.8);
add("fx", "t-rule", rect(600, 4, ORANGE, W / 2, 590, {}));
fade("t-rule", 0.6, 3);
tw("t-rule", "transform.scaleX", 0, 1, 0.6, 0.8, "easeOutQuart");

// ── 3–11 s: one film, two looks, side by side ──────────────────────────────
const P = 720, LX = 520, RX = 1400, PY = 520;
add("text", "h2", text("ONE FILM MODULE · TWO LOOKS", "font-display", 72, CREAM, W / 2, 90));
fade("h2", 3.2, 11);
for (const [side, x, asset, look, color, end, trimOut] of [
  ["l", LX, "hdf-fox-and-teapot", "look: doodlePastel", PINK, 16.5, 13.5],
  ["r", RX, "hdf-cutout-fox", "look: cutout", ORANGE, 11, 8],
]) {
  add("frames", `frame-${side}`, rect(P + 16, P + 16, color, x, PY, { cr: 10 }));
  add("video", `film-${side}`, {
    type: "video", asset, width: P, height: P, start: 3, end, trimIn: 0, trimOut,
    fit: "cover", loop: false, transform: T(x, PY, { o: 0 }),
  });
  add("text", `cap-${side}`, text(look, "font-mono", 30, color, x, PY + P / 2 + 50));
  const d = side === "l" ? 0 : 0.15;
  for (const id of [`frame-${side}`, `film-${side}`]) {
    tw(id, "transform.opacity", 0, 1, 3 + d, 0.4);
    tw(id, "transform.y", PY + 300, PY, 3 + d, 0.7, "easeOutBack");
  }
  fade(`cap-${side}`, 3.5 + d, 11);
}
// cutout panel leaves; the doodle film slides left to make room for the sheet
for (const id of ["frame-r", "film-r"]) {
  tw(id, "transform.x", RX, W + 500, 10.6, 0.5, "easeInCubic");
}
for (const id of ["frame-l", "film-l"]) {
  tw(id, "transform.x", LX, 600, 11, 0.8, "easeInOutCubic");
  tw(id, "transform.opacity", 1, 0, 16, 0.5, "easeInCubic");
}

// ── 11–16.5 s: the puppet's model sheet as an image asset ──────────────────
const SW = 760, SH = Math.round(SW * 4590 / 2640);
add("sheet", "sheet", {
  type: "sprite", asset: "hdf-fox-model", width: SW, height: SH,
  transform: T(1380, 0, { ax: 0.5, ay: 0, o: 0 }),
});
tw("sheet", "transform.opacity", 0, 1, 11.2, 0.5);
tw("sheet", "transform.y", 0, H - SH, 11.4, 4.8, "easeInOutSine");
tw("sheet", "transform.opacity", 1, 0, 16, 0.5, "easeInCubic");
add("text", "cap-sheet", text("hdf-fox-model · image asset", "font-mono", 26, CREAM, 1380, 1030));
add("fx", "cap-sheet-bg", rect(520, 50, BG, 1380, 1030, { cr: 8 }));
fade("cap-sheet-bg", 11.6, 16.5); fade("cap-sheet", 11.6, 16.5);
add("text", "cap-video", text("hdf-fox-and-teapot · video asset", "font-mono", 30, PINK, 600, PY + P / 2 + 50));
fade("cap-video", 11.6, 16.5);
add("text", "h3", text("PUPPETS COME ALONG TOO", "font-display", 72, CREAM, 600, 90));
fade("h3", 11.4, 16.5);

// ── 16.5–20 s: the bridge, one command ─────────────────────────────────────
add("text", "o-title", text("HANDDRAWN × DAVIDUP", "font-display", 140, CREAM, W / 2, 470));
add("fx", "o-cmd-bg", rect(1500, 90, "#221d19", W / 2, 620, { cr: 12 }));
add("text", "o-cmd", text("$ bun run scripts/hdf-to-davidup.ts fox-and-teapot --project my-video", "font-mono", 30, ORANGE, W / 2, 620));
add("text", "o-sub", text("render · register · place — re-run replaces in place", "font-mono", 26, DIM, W / 2, 720));
fade("o-title", 16.7, 20, 0.6, 0.6); fade("o-cmd-bg", 17.1, 20, 0.5, 0.6);
fade("o-cmd", 17.2, 20, 0.5, 0.6); fade("o-sub", 17.6, 20, 0.5, 0.6);
tw("o-title", "transform.scaleX", 0.92, 1, 16.7, 1.2); tw("o-title", "transform.scaleY", 0.92, 1, 16.7, 1.2);

// ── assemble ───────────────────────────────────────────────────────────────
const prev = JSON.parse(readFileSync(FILE, "utf8"));
const bridged = prev.assets.filter((a) => a.id.startsWith("hdf-"));
const order = ["frames", "video", "sheet", "fx", "text"];
const comp = {
  version: "0.1",
  composition: { width: W, height: H, fps: 30, duration: 20, background: BG },
  assets: [
    { id: "font-display", type: "font", src: "../fonts/BebasNeue-Regular.ttf", family: "ShowDisplay" },
    { id: "font-mono", type: "font", src: "../fonts/JetBrainsMono-Bold.ttf", family: "ShowMono" },
    { id: "score", type: "audio", src: "assets/hdf/fox-and-teapot.wav" },
    ...bridged,
  ],
  layers: order.map((id, z) => ({ id, z: z * 10, opacity: 1, blendMode: "normal", items: layers[id] ?? [] })),
  items, tweens,
  audio: [{ id: "score", asset: "score", start: 3, end: 18.5, trimIn: 0, volume: 1, fadeIn: 0.2, fadeOut: 2 }],
};
writeFileSync(FILE, JSON.stringify(comp, null, 1) + "\n");
console.log(`wrote ${FILE}: ${Object.keys(items).length} items, ${tweens.length} tweens`);
