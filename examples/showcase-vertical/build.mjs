// davidup vertical showcase — 30 s, 1080×1920 (9:16), 30 fps.
//
//   node examples/showcase-vertical/build.mjs [selfVideo] [outFile]
//
// Writes an *authored* composition (templates, scenes, $repeat, $behavior,
// expressions, global-library assets — not the compiled form). `selfVideo` is
// the clip the closing "phone screen" plays: render.ts feeds each Droste
// pass's own output back in, so the ending shows the film playing inside
// itself before it collapses into the author's avatar.
//
// Also writes `alpha-badge.json` next to it: an overlay rendered on its own
// to ProRes 4444 (transparent background) and composited back into the
// footage act as an ordinary video item.
//
// Cut grid is on the music: 120 BPM, drops at t = 3.5 and t = 24.

import { writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const selfArg = process.argv[2] ?? "../showcase-v1.1/assets/mandelbrot.mp4";
const outFile = resolve(HERE, process.argv[3] ?? "composition.json");
const rel = (p) => relative(dirname(outFile), resolve(HERE, p)) || ".";
const SHARED = "../showcase-v1.1/assets"; // footage, music, SFX

const W = 1080, H = 1920, CX = 540;
const DROP1 = 3.5, DROP2 = 24;

// ── palette ────────────────────────────────────────────────────────────────
const BG = "#05060c";
const INK = "#eef1ff";
const DIM = "#8a93b8";
const CYAN = "#3de8ff";
const MAG = "#ff3d9a";
const AMB = "#ffc23d";
const VIO = "#8b6cff";
const LIME = "#7dff9a";
const XBLUE = "#1d9bf0";

// ── helpers ────────────────────────────────────────────────────────────────
const T = (x, y, o = {}) => ({
  x, y,
  scaleX: o.s ?? o.sx ?? 1,
  scaleY: o.s ?? o.sy ?? 1,
  rotation: o.r ?? 0,
  anchorX: o.ax ?? o.a ?? 0,
  anchorY: o.ay ?? o.a ?? 0,
  opacity: o.o ?? 1,
});
const C = (x, y, o = {}) => T(x, y, { a: 0.5, ...o });

const items = {};
const tweens = [];
let tid = 0;
const tw = (target, property, from, to, start, duration, easing = "easeOutCubic") =>
  tweens.push({ id: `t${tid++}_${target}`, target, property, from, to, start, duration, easing });
const scaleTw = (target, from, to, start, duration, easing) => {
  tw(target, "transform.scaleX", from, to, start, duration, easing);
  tw(target, "transform.scaleY", from, to, start, duration, easing);
};
const fadeIn = (id, at, d = 0.3) => tw(id, "transform.opacity", 0, 1, at, d, "easeOutQuad");
const fadeOut = (id, at, d = 0.3) => tw(id, "transform.opacity", 1, 0, at, d, "easeInQuad");
const beh = (behavior, target, start, duration, params = {}, easing) =>
  tweens.push({ $behavior: behavior, target, start, duration, params, ...(easing ? { easing } : {}) });

const text = (txt, font, fontSize, color, transform, extra = {}) => ({
  type: "text", text: txt, font, fontSize, color, transform, ...extra,
});
const rect = (w, h, fillColor, transform, extra = {}) => ({
  type: "shape", kind: "rect", width: w, height: h, ...(fillColor ? { fillColor } : {}), transform, ...extra,
});
const circle = (d, fillColor, transform, extra = {}) => ({
  type: "shape", kind: "circle", width: d, height: d, ...(fillColor ? { fillColor } : {}), transform, ...extra,
});
const poly = (points, fillColor, transform, extra = {}) => ({
  type: "shape", kind: "polygon", points, fillColor, transform, ...extra,
});
const group = (children, transform, extra = {}) => ({ type: "group", items: children, transform, ...extra });

// Fonts: five straight out of the global library (woff2, `global:` srcs), the
// bundled Inter that needs no asset at all, and nothing else.
const DISPLAY = "f-anton";
const MONO = "f-mono";
const SERIF = "f-serif";
const HAND = "f-hand";
const BOLD = "f-bold";
const SANS = "font:default";

// ════════════════════════════════════════════════════════════════════════════
// AMBIENT — three huge blurred blobs drifting behind everything; their colours
// shift act by act. One isolated group, one blur per frame.
// ════════════════════════════════════════════════════════════════════════════
items.aurora = group(["blobA", "blobB", "blobC"], T(0, 0, { o: 0.3 }), {
  isolate: true, effects: [{ type: "blur", radius: 140 }],
});
items.blobA = circle(900, VIO, C(160, 380));
items.blobB = circle(1000, MAG, C(980, 1560));
items.blobC = circle(700, CYAN, C(540, 980, { o: 0.6 }));
tw("blobA", "transform.x", 160, 900, 0, 30, "easeInOutSine");
tw("blobA", "transform.y", 380, 1300, 0, 30, "easeInOutSine");
tw("blobB", "transform.x", 980, 160, 0, 30, "easeInOutSine");
tw("blobB", "transform.y", 1560, 600, 0, 30, "easeInOutSine");
tw("blobC", "transform.rotation", 0, 1, 0, 30, "linear");
const AURORA = [
  // [at, A, B, C]
  [DROP1, MAG, VIO, CYAN],
  [6, AMB, MAG, VIO],
  [9, VIO, CYAN, MAG],
  [12, CYAN, AMB, VIO],
  [15, MAG, VIO, AMB],
  [18.5, LIME, CYAN, VIO],
  [DROP2, CYAN, MAG, XBLUE],
  [26.4, XBLUE, VIO, XBLUE],
];
let prevAurora = [VIO, MAG, CYAN];
for (const [at, ...cols] of AURORA) {
  ["blobA", "blobB", "blobC"].forEach((id, k) =>
    tw(id, "fillColor", prevAurora[k], cols[k], at, 0.8, "easeInOutSine"));
  prevAurora = cols;
}

// ════════════════════════════════════════════════════════════════════════════
// ACT 0 — HOOK (0 → 3.5): 960 dots — one nested $repeat — burst out of the
// centre into a twisted iris around the headline, then implode on the drop.
// Each dot sits on the iris centre and is pushed out along its own rotation
// by tweening `anchorX` (the expression language has no sin/cos, so the
// polar layout is done by the transform instead).
// ════════════════════════════════════════════════════════════════════════════
const RINGS = 20, SPOKES = 48;
const ringR = "(250 + k * 13)";
const dotD = "(5 + k * 0.55)";
items.iris = group(["irisDot"], C(CX, 960, { s: 0.7, r: -1.4 }), {
  effects: [{ type: "glow", color: CYAN, radius: 14 }],
});
items.irisDot = {
  $repeat: { count: RINGS, as: "k" },
  item: {
    $repeat: { count: SPOKES, as: "j", id: "iris${k}_${j}" },
    item: circle(`\${${dotD}}`, "rgb(${round(61 + k * 10)}, ${round(232 - k * 9)}, ${round(255 - k * 5)})", {
      x: 0, y: 0, scaleX: 1, scaleY: 1,
      rotation: `\${j * ${(2 * Math.PI / SPOKES).toFixed(6)} + k * 0.105}`,
      anchorX: 0.5, anchorY: 0.5, opacity: 1,
    }),
  },
};
tweens.push({
  $repeat: { count: RINGS, as: "k" },
  item: {
    $repeat: { count: SPOKES, as: "j" },
    item: {
      id: "irisOut${k}_${j}", target: "iris${k}_${j}", property: "transform.anchorX",
      from: 0.5, to: `\${0.5 - ${ringR} / ${dotD}}`,
      start: "${0.15 + k * 0.03 + j * 0.002}", duration: 1.2, easing: "easeOutExpo",
    },
  },
});
tw("iris", "transform.rotation", -1.4, 0.35, 0.1, 3.2, "easeOutCubic");
scaleTw("iris", 0.7, 1, 0.1, 1.4, "easeOutExpo");
scaleTw("iris", 1, 0.02, 2.75, 0.75, { bezier: [0.6, -0.5, 0.9, 0.4] });
tw("iris", "effects.0.radius", 14, 60, 2.75, 0.75, "easeInQuad");
items.iris.exit = DROP1;

items.hook1 = text("THIS VIDEO", DISPLAY, 168, INK, C(CX, 885, { s: 1.4, o: 0 }), {
  align: "center", letterSpacing: 4, exit: DROP1,
  shadow: { color: "#000000cc", blur: 30, offsetX: 0, offsetY: 6 },
});
items.hook2 = text("IS A JSON FILE.", DISPLAY, 128, CYAN, C(CX, 1045, { o: 0 }), {
  align: "center", letterSpacing: 40, exit: DROP1,
  shadow: { color: "#000000cc", blur: 30, offsetX: 0, offsetY: 6 },
  effects: [{ type: "glow", color: CYAN, radius: 16 }],
});
fadeIn("hook1", 0.05, 0.2);
scaleTw("hook1", 1.4, 1, 0.05, 0.5, "easeOutExpo");
fadeIn("hook2", 0.45, 0.25);
tw("hook2", "letterSpacing", 40, 3, 0.45, 0.8, "easeOutExpo");
for (const id of ["hook1", "hook2"]) {
  scaleTw(id, 1, 2.6, 2.95, 0.55, "easeInExpo");
  tw(id, "transform.opacity", 1, 0, 3.15, 0.35, "easeInQuad");
}
items.hookSub = text("every frame · every pixel · deterministic", MONO, 30, DIM, C(CX, 1560, { o: 0 }), {
  align: "center", exit: DROP1,
});
fadeIn("hookSub", 1.1, 0.4);
tw("hookSub", "transform.y", 1590, 1560, 1.1, 0.5, "easeOutCubic");
fadeOut("hookSub", 2.8, 0.3);

// ════════════════════════════════════════════════════════════════════════════
// ACT 1 — LOGO (3.5 → 6): additive R/G/B wordmark converging in an isolated
// group, glitching on the beat; tagline as explicit multiline text.
// ════════════════════════════════════════════════════════════════════════════
items.logo = group(["logoMix"], C(CX, 860, { s: 1.6 }), {
  isolate: true, enter: DROP1, exit: 6,
  effects: [{ type: "glow", color: MAG, radius: 28 }],
});
items.logoMix = group(["logoR", "logoG", "logoB"], T(0, 0), { blendMode: "lighter" });
const logoText = (color, x, y) =>
  text("DAVIDUP", DISPLAY, 230, color, C(x, y), { align: "center", letterSpacing: 60 });
items.logoR = logoText("#ff1e3c", -60, 0);
items.logoG = logoText("#1eff8c", 0, 40);
items.logoB = logoText("#1e6bff", 60, 0);
for (const id of ["logoR", "logoG", "logoB"]) tw(id, "letterSpacing", 60, 6, DROP1, 0.9, "easeOutExpo");
tw("logoR", "transform.x", -60, 0, DROP1, 0.7, "easeOutExpo");
tw("logoB", "transform.x", 60, 0, DROP1, 0.7, "easeOutExpo");
tw("logoG", "transform.y", 40, 0, DROP1, 0.7, "easeOutExpo");
scaleTw("logo", 1.6, 1, DROP1, 0.6, "easeOutExpo");
tw("logo", "effects.0.radius", 70, 16, DROP1, 1.0, "easeOutCubic");
beh("shake", "logoR", 4.5, 0.3, { amplitude: 18, cycles: 3, axis: "x", center: 0 });
beh("shake", "logoB", 4.5, 0.3, { amplitude: 12, cycles: 2, axis: "y", center: 0 });
beh("shake", "logoG", 5.0, 0.25, { amplitude: 16, cycles: 3, axis: "x", center: 0 });
scaleTw("logo", 1, 3.4, 5.6, 0.4, "easeInExpo");
tw("logo", "transform.opacity", 1, 0, 5.75, 0.25, "easeInQuad");

items.tagline = text("Programmable video.\nRendered from JSON.\nDriven by AI agents.", BOLD, 58, INK,
  C(CX, 1170, { o: 0 }), { align: "center", lineHeight: 1.25, enter: DROP1, exit: 6 });
fadeIn("tagline", 4.0, 0.4);
tw("tagline", "transform.y", 1210, 1170, 4.0, 0.6, "easeOutCubic");
fadeOut("tagline", 5.6, 0.3);

items.pill = group(["pillBox", "pillText"], C(CX, 1400, { o: 0 }), { enter: DROP1, exit: 6 });
items.pillBox = rect(400, 78, "#3de8ff14", C(0, 0), { cornerRadius: 39, strokeColor: CYAN, strokeWidth: 3 });
items.pillText = text("$ npx davidup", MONO, 34, CYAN, C(0, 1), { align: "center" });
beh("popIn", "pill", 4.4, 0.5, {}, "easeOutBack");
fadeOut("pill", 5.6, 0.3);

// ════════════════════════════════════════════════════════════════════════════
// ACT 2 — TYPE (6 → 9): text v2 — wrap + breathing line height (serif), an
// outline that fills in, tracking, a handwritten library font, a paragraph.
// ════════════════════════════════════════════════════════════════════════════
items.type = group(["head", "outline", "tracking", "hand", "para"], T(260, 0), {
  enter: 6, exit: 9,
  effects: [{ type: "blur", radius: 26 }],
});
tw("type", "transform.x", 260, 0, 6, 0.5, "easeOutCubic");
tw("type", "effects.0.radius", 26, 0, 6, 0.45, "easeOutQuad");
tw("type", "transform.x", 0, -420, 8.6, 0.4, "easeInCubic");
tw("type", "effects.0.radius", 0, 34, 8.6, 0.4, "easeInQuad");
tw("type", "transform.opacity", 1, 0, 8.7, 0.3, "easeInQuad");

items.head = text("Words that wrap, breathe & glow.", SERIF, 112, INK, T(80, 330), {
  maxWidth: 900, lineHeight: 1.7, letterSpacing: 24,
  shadow: { color: MAG, blur: 0, offsetX: 7, offsetY: 7 },
});
tw("head", "lineHeight", 1.7, 1.02, 6.1, 1.1, "easeOutExpo");
tw("head", "letterSpacing", 24, 0, 6.1, 1.0, "easeOutExpo");

items.outline = text("OUTLINE", DISPLAY, 250, "#3de8ff00", C(CX, 930, { r: -0.25, s: 0.7 }), {
  align: "center", strokeColor: CYAN, strokeWidth: 0,
});
tw("outline", "strokeWidth", 0, 5, 6.4, 0.5, "easeOutQuad");
tw("outline", "transform.rotation", -0.25, 0, 6.4, 0.8, "easeOutBack");
scaleTw("outline", 0.7, 1, 6.4, 0.8, "easeOutBack");
tw("outline", "color", "#3de8ff00", "#3de8ffff", 7.7, 0.5, "easeInOutQuad");
tw("outline", "strokeWidth", 5, 0, 7.7, 0.5, "easeInOutQuad");

items.tracking = text("TRACKING", DISPLAY, 120, AMB, C(CX, 1150, { o: 0 }), {
  align: "center", letterSpacing: 0,
});
fadeIn("tracking", 6.8, 0.3);
tw("tracking", "letterSpacing", 0, 40, 6.8, 0.8, "easeInOutSine");
tw("tracking", "letterSpacing", 40, 6, 7.6, 0.8, "easeInOutSine");

items.hand = text("…in any font from your library", HAND, 76, MAG, C(CX, 1300, { r: -0.05, o: 0 }), {
  align: "center",
});
fadeIn("hand", 7.1, 0.3);
tw("hand", "transform.rotation", -0.12, -0.05, 7.1, 0.6, "easeOutBack");

items.para = text(
  "Text v2 measures every glyph: word-wrap, metric anchors, tracking, stroke and shadow — the same pixels in the browser preview and in the final render.",
  SANS, 36, DIM, T(90, 1420, { o: 0 }), { maxWidth: 900, lineHeight: 1.45 },
);
fadeIn("para", 7.3, 0.5);
tw("para", "transform.y", 1450, 1420, 7.3, 0.6, "easeOutCubic");

// ════════════════════════════════════════════════════════════════════════════
// ACT 3 — LIGHT (9 → 12): additive RGB Venn that flickers on like a neon tube
// (an executable *user* behavior the composition defines itself), a card
// lifting on a tweened drop shadow, isolate: false vs true.
// ════════════════════════════════════════════════════════════════════════════

// A neon tube striking: N hard opacity flashes settling on full, written as a
// `$repeat` tween body over the block's window. Composition-scoped — the
// `behaviors` block in the assembly below registers it for this compile only,
// so `davidup render` expands it with no session state (L-1).
const neonFlicker = {
  description: "Neon-tube strike: `flashes` hard opacity flickers settling on 1.",
  params: [{ name: "flashes", type: "number", default: 4 }],
  tweens: [
    {
      $repeat: { count: "${params.flashes}", as: "i" },
      item: {
        suffix: "f${i}",
        property: "transform.opacity",
        from: "${0.1 + i * 0.12}",
        to: 1,
        start: "${$.start + i * $.duration / params.flashes}",
        duration: "${$.duration / params.flashes}",
        easing: { steps: 2 },
      },
    },
  ],
};

items.light = group(["venn", "card", "isoOff", "isoOn", "isoOffLbl", "isoOnLbl"], T(0, 0), {
  enter: 9, exit: 12,
});
items.venn = group(["vennMix"], C(CX, 640, { s: 0.4 }), {
  isolate: true,
  effects: [{ type: "blur", radius: 40 }, { type: "glow", color: VIO, radius: 30 }],
});
items.vennMix = group(["vR", "vG", "vB"], T(0, 0), { blendMode: "lighter" });
const vennPos = { vR: [0, -105], vG: [92, 52], vB: [-92, 52] };
const vennCol = { vR: "#ff2a4a", vG: "#2aff7a", vB: "#2a6aff" };
for (const [id, [x, y]] of Object.entries(vennPos)) {
  items[id] = circle(360, vennCol[id], C(0, 0));
  tw(id, "transform.x", 0, x, 9.3, 0.8, "easeOutBack");
  tw(id, "transform.y", 0, y, 9.3, 0.8, "easeOutBack");
  tw(id, "transform.x", x, 0, 11.35, 0.4, "easeInCubic");
  tw(id, "transform.y", y, 0, 11.35, 0.4, "easeInCubic");
}
beh("neonFlicker", "venn", 9.0, 0.6, { flashes: 5 });
tw("venn", "effects.0.radius", 40, 0, 9.0, 0.9, "easeOutCubic");
scaleTw("venn", 0.4, 1, 9.0, 0.9, "easeOutBack");
tw("venn", "transform.rotation", 0, 1.3, 9.0, 2.6, "easeInOutSine");
scaleTw("venn", 1, 0, 11.7, 0.3, "easeInBack");

items.card = group(["cardBox", "cardTitle", "cardSub"], C(CX, 1140, { o: 0 }), {
  effects: [{ type: "shadow", color: "#ff3d9ab0", blur: 8, offsetX: 0, offsetY: 4 }],
});
items.cardBox = rect(760, 250, "#151b31", C(0, 0), { cornerRadius: 30, strokeColor: "#ffffff30", strokeWidth: 2 });
items.cardTitle = text("DROP SHADOW", DISPLAY, 100, INK, C(0, -30), { align: "center", letterSpacing: 4 });
items.cardSub = text("effects.0.offsetY  4 → 56", MONO, 30, DIM, C(0, 64), { align: "center" });
fadeIn("card", 9.3, 0.4);
tw("card", "effects.0.offsetY", 4, 56, 9.5, 1.2, "easeOutCubic");
tw("card", "effects.0.blur", 8, 70, 9.5, 1.2, "easeOutCubic");
tw("card", "transform.y", 1170, 1110, 9.5, 1.2, "easeOutCubic");
fadeOut("card", 11.65, 0.35);

const diamonds = (id, x, isolate) => {
  items[id] = group([`${id}A`, `${id}B`], T(x, 1470, { o: 0 }), isolate ? { isolate: true } : {});
  items[`${id}A`] = rect(120, 120, AMB, C(-44, 0, { r: Math.PI / 4 }));
  items[`${id}B`] = rect(120, 120, AMB, C(44, 0, { r: Math.PI / 4 }));
  tw(id, "transform.opacity", 0, 0.55, 9.9, 0.5, "easeOutQuad");
  tw(id, "transform.opacity", 0.55, 0, 11.65, 0.35, "easeInQuad");
};
diamonds("isoOff", 300, false);
diamonds("isoOn", 780, true);
items.isoOffLbl = text("isolate: false", MONO, 30, DIM, C(300, 1600, { o: 0 }), { align: "center" });
items.isoOnLbl = text("isolate: true", MONO, 30, CYAN, C(780, 1600, { o: 0 }), { align: "center" });
for (const id of ["isoOffLbl", "isoOnLbl"]) {
  fadeIn(id, 10.1, 0.4);
  fadeOut(id, 11.65, 0.35);
}

// ════════════════════════════════════════════════════════════════════════════
// ACT 4 — MOTION (12 → 15): six balls drop down their lanes, one easing each;
// the same scene then plays with `time: reverse`, mirroring every easing.
// ════════════════════════════════════════════════════════════════════════════
const LANES = [
  ["linear", "linear", INK],
  ["easeOutBack", "easeOutBack", CYAN],
  ["easeInOutExpo", "easeInOutExpo", VIO],
  ["bezier(.7,-.6,.3,1.6)", { bezier: [0.7, -0.6, 0.3, 1.6] }, MAG],
  ["bezier(.1,1.5,.3,1)", { bezier: [0.1, 1.5, 0.3, 1] }, LIME],
  ["steps(8)", { steps: 8 }, AMB],
];
const laneX = (k) => 165 + k * 150;
const RACE_Y0 = 640, RACE_Y1 = 1500, RACE_DUR = 1.2;
const motionChildren = ["motionTitle", "track"];
items.motionTitle = text("TIMING IS EVERYTHING.", DISPLAY, 132, INK, C(CX, 420, { o: 0 }), {
  align: "center", maxWidth: 900, lineHeight: 0.95, letterSpacing: 2,
});
fadeIn("motionTitle", 12, 0.3);
scaleTw("motionTitle", 1.2, 1, 12, 0.5, "easeOutExpo");
items.track = {
  $repeat: { count: LANES.length, as: "k", id: "track${k}" },
  item: rect(3, RACE_Y1 - RACE_Y0, "#ffffff22", {
    x: "${165 + k * 150}", y: RACE_Y0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0, opacity: 1,
  }),
};
LANES.forEach(([label, , color], k) => {
  const id = `laneLbl${k}`;
  // labels run up the lane, rotated a quarter turn
  items[id] = text(label, MONO, 26, color, T(laneX(k) - 22, RACE_Y1, { r: -Math.PI / 2, o: 0 }), {});
  motionChildren.push(id);
  fadeIn(id, 12.1 + k * 0.05, 0.3);
});
items.motion = group(motionChildren, T(0, 0), { enter: 12, exit: 15 });
fadeOut("motion", 14.7, 0.3);

const raceScene = {
  id: "race",
  description: "Six balls dropping down their lanes, one easing each.",
  duration: RACE_DUR,
  size: { width: W, height: H },
  background: "transparent",
  params: [],
  items: Object.fromEntries(
    LANES.map(([, , color], k) => [
      `ball${k}`,
      circle(54, color, C(laneX(k), RACE_Y0), { effects: [{ type: "glow", color, radius: 16 }] }),
    ]),
  ),
  tweens: LANES.map(([, easing], k) => ({
    id: `run${k}`, target: `ball${k}`, property: "transform.y",
    from: RACE_Y0, to: RACE_Y1, start: 0, duration: RACE_DUR, easing,
  })),
};
items.raceThere = { type: "scene", scene: "race", start: 12.35, transform: T(0, 0) };
items.raceBack = { type: "scene", scene: "race", start: 13.6, time: { mode: "reverse" }, exit: 15, transform: T(0, 0) };
fadeOut("raceBack", 14.7, 0.3);
items.reverseTag = text('time: { mode: "reverse" }\neasings mirror on the way back', MONO, 30, DIM,
  C(CX, 1640, { o: 0 }), { align: "center", lineHeight: 1.4, enter: 12, exit: 15 });
fadeIn("reverseTag", 13.6, 0.3);
fadeOut("reverseTag", 14.7, 0.3);

// ════════════════════════════════════════════════════════════════════════════
// ACT 5 — TIME (15 → 18.5): one orrery scene — a group inside a group inside
// the scene (sun → planet arm → moon arm) — under five time mappings.
// ════════════════════════════════════════════════════════════════════════════
const ORR = 1.6;
const orrery = {
  id: "orrery",
  description: "Sun, planet and moon on nested arms; a bar shows the scene's own clock.",
  duration: ORR,
  size: { width: 300, height: 340 },
  background: "transparent",
  params: [],
  items: {
    ring: circle(220, null, C(150, 150), { strokeColor: "#ffffff26", strokeWidth: 2 }),
    sun: circle(56, AMB, C(150, 150), { effects: [{ type: "glow", color: AMB, radius: 18 }] }),
    arm: group(["planet", "moonArm"], T(150, 150)),
    planet: circle(30, CYAN, C(110, 0), { effects: [{ type: "glow", color: CYAN, radius: 10 }] }),
    moonArm: group(["ring2", "moon"], T(110, 0)),
    ring2: circle(56, null, C(0, 0), { strokeColor: "#ffffff1a", strokeWidth: 2 }),
    moon: circle(12, INK, C(28, 0)),
    barBg: rect(240, 6, "#ffffff1a", T(30, 318), { cornerRadius: 3 }),
    bar: rect(0, 6, MAG, T(30, 318), { cornerRadius: 3 }),
  },
  tweens: [
    { id: "orbit", target: "arm", property: "transform.rotation", from: 0, to: 2 * Math.PI, start: 0, duration: ORR, easing: "easeInOutSine" },
    { id: "moonOrbit", target: "moonArm", property: "transform.rotation", from: 0, to: -4 * Math.PI, start: 0, duration: ORR, easing: "linear" },
    { id: "clock", target: "bar", property: "width", from: 0, to: 240, start: 0, duration: ORR, easing: "linear" },
  ],
};
const MODES = [
  ["identity", "as authored", { mode: "identity" }, CX, 510],
  ["timeScale: 0.5", "half speed", { mode: "timeScale", scale: 0.5 }, 290, 910],
  ["loop: 2", "twice, back to back", { mode: "loop", count: 2 }, 790, 910],
  ["reverse", "backwards", { mode: "reverse" }, 290, 1310],
  ["clip: [0.3, 1.3]", "trimmed + resampled", { mode: "clip", fromTime: 0.3, toTime: 1.3 }, 790, 1310],
];
const timeChildren = ["timeTitle"];
items.timeTitle = text("ONE SCENE.\nFIVE CLOCKS.", DISPLAY, 120, INK, C(CX, 365, { o: 0 }), {
  align: "center", lineHeight: 0.95, letterSpacing: 3,
});
fadeIn("timeTitle", 15, 0.3);
scaleTw("timeTitle", 1.2, 1, 15, 0.5, "easeOutExpo");
MODES.forEach(([label, sub, time, cx, top], k) => {
  // v1.3 (L-2/L-3): the instance lives inside the `time` group and pivots on
  // the scene's own `size` box, so the pop-in is one plain scale — `x`/`y`
  // name where the box *centre* goes (local (150, 170)) and stay put while
  // the scale runs.
  const s0 = 0.001, at = 15.3 + k * 0.06;
  items[`orr${k}`] = {
    type: "scene", scene: "orrery", start: 15.4, time, exit: 18.5,
    transform: T(cx, top + 170, { s: s0, a: 0.5 }),
  };
  scaleTw(`orr${k}`, s0, 1, at, 0.45, "easeOutBack");
  items[`orrLbl${k}`] = text(label, MONO, 32, k === 0 ? INK : CYAN, C(cx, top + 345, { o: 0 }), { align: "center" });
  items[`orrSub${k}`] = text(sub, SANS, 28, DIM, C(cx, top + 390, { o: 0 }), { align: "center" });
  timeChildren.push(`orr${k}`, `orrLbl${k}`, `orrSub${k}`);
  fadeIn(`orrLbl${k}`, 15.35 + k * 0.06, 0.3);
  fadeIn(`orrSub${k}`, 15.45 + k * 0.06, 0.3);
});
// The five instances are children of this group, so its fade-out takes them
// with it — no per-instance copy of the same tween.
items.time = group(timeChildren, T(0, 0), { enter: 15, exit: 18.5 });
fadeOut("time", 18.15, 0.35);

// ════════════════════════════════════════════════════════════════════════════
// ACT 6 — FOOTAGE (18.5 → 22.5): Game-of-Life b-roll `cover`-cropped to
// portrait with its own sound (keepAudio); a Mandelbrot under contain / cover
// / a circular mask; an overlay rendered by davidup itself to ProRes 4444 and
// composited back with its alpha.
// ════════════════════════════════════════════════════════════════════════════
items.lifeWrap = group(["lifeBg"], T(0, 0, { o: 0 }), { blendMode: "screen", enter: 18.5, exit: 22.5 });
items.lifeBg = {
  type: "video", asset: "life", width: W, height: H, start: 18.5, fit: "cover", keepAudio: true,
  transform: T(0, 0),
};
tw("lifeWrap", "transform.opacity", 0, 0.22, 18.5, 0.5, "easeOutQuad");
tw("lifeWrap", "transform.opacity", 0.22, 0, 22.0, 0.5, "easeInQuad");

const footChildren = ["footTitle"];
items.footTitle = text("REAL FOOTAGE.\nCOMPOSITED.", DISPLAY, 120, INK, C(CX, 365, { o: 0 }), {
  align: "center", lineHeight: 0.95, letterSpacing: 3,
  shadow: { color: "#000000", blur: 24, offsetX: 0, offsetY: 4 },
});
fadeIn("footTitle", 18.5, 0.3);
scaleTw("footTitle", 1.2, 1, 18.5, 0.5, "easeOutExpo");
const BOX = 420;
const cards = [
  ["contain", 290, 740, 'fit: "contain"'],
  ["cover", 790, 740, 'fit: "cover"'],
  ["mask", CX, 1180, "isolate + destination-in"],
];
cards.forEach(([kind, cx, cy, label], k) => {
  const id = `foot_${kind}`;
  const vid = `${id}_v`;
  if (kind === "mask") {
    items[id] = group([vid, `${id}_m`], C(cx, cy, { s: 0.2, o: 0 }), {
      isolate: true, effects: [{ type: "glow", color: VIO, radius: 24 }],
    });
    items[`${id}_m`] = group([`${id}_disc`], T(0, 0), { blendMode: "destination-in" });
    items[`${id}_disc`] = circle(BOX, "#ffffff", C(0, 0));
    tw(id, "transform.rotation", 0, 0.6, 18.9, 3.4, "linear");
  } else {
    items[id] = group([`${id}_frame`, vid], C(cx, cy, { s: 0.2, o: 0 }));
    items[`${id}_frame`] = rect(BOX + 8, BOX + 8, "#0b0e1a", C(0, 0), { strokeColor: "#ffffff40", strokeWidth: 2 });
  }
  items[vid] = {
    type: "video", asset: "fractal", width: BOX, height: BOX, start: 18.7,
    trimIn: kind === "mask" ? 3.5 : 1.2, fit: kind === "contain" ? "contain" : "cover",
    transform: C(0, 0),
  };
  beh("popIn", id, 18.7 + k * 0.18, 0.5, {}, "easeOutBack");
  items[`${id}_lbl`] = text(label, MONO, 30, k === 2 ? VIO : CYAN,
    C(cx, cy + BOX / 2 + 42, { o: 0 }), { align: "center", shadow: { color: "#000000", blur: 12, offsetX: 0, offsetY: 2 } });
  fadeIn(`${id}_lbl`, 19.0 + k * 0.18, 0.3);
  footChildren.push(id, `${id}_lbl`);
});
// the overlay: a transparent ProRes 4444 clip rendered from alpha-badge.json
items.alphaBadge = {
  type: "video", asset: "badge", width: W, height: 300, start: 19.6, fit: "contain",
  transform: T(0, 1470),
};
footChildren.push("alphaBadge");
items.footage = group(footChildren, T(0, 0), { enter: 18.5, exit: 22.5 });
fadeOut("footage", 22.15, 0.3);

// the hush before the second drop: three lines stack up, one per beat
const NO = [["NO TIMELINE.", DIM, 22.5, 760], ["NO KEYFRAMES.", DIM, 23.0, 960], ["JUST JSON.", CYAN, 23.5, 1160]];
NO.forEach(([word, color, at, y], k) => {
  const id = `no${k}`;
  items[id] = text(word, DISPLAY, 170, color, C(CX, y), {
    align: "center", letterSpacing: 4, enter: at, exit: DROP2,
    ...(k === 2 ? { effects: [{ type: "glow", color: CYAN, radius: 22 }] } : {}),
  });
  scaleTw(id, 1.35, 1, at, 0.3, "easeOutExpo");
});

// ════════════════════════════════════════════════════════════════════════════
// ACT 7 — REVEAL (24 → 26.4): the frame shrinks into a rounded phone screen
// that is playing *this* video at this very moment (N Droste passes deep),
// next to what it compiles to.
// ════════════════════════════════════════════════════════════════════════════
const SCREEN_S = 0.46;
items.screen = group(["screenVid", "screenMask", "screenFrame"], C(CX, 960), {
  isolate: true, enter: DROP2,
  effects: [{ type: "shadow", color: "#000000c0", blur: 60, offsetX: 0, offsetY: 30 }],
});
items.screenVid = {
  type: "video", asset: "self", width: W, height: H, start: DROP2, fit: "fill", transform: C(0, 0),
};
items.screenMask = group(["screenMaskRect"], T(0, 0), { blendMode: "destination-in" });
items.screenMaskRect = rect(W, H, "#ffffff", C(0, 0), { cornerRadius: 0 });
items.screenFrame = rect(W, H, null, C(0, 0), { strokeColor: INK, strokeWidth: 0, cornerRadius: 0 });
tw("screen", "transform.y", 960, 700, DROP2, 1.4, "easeInOutCubic");
scaleTw("screen", 1, SCREEN_S, DROP2, 1.4, { bezier: [0.65, 0, 0.35, 1] });
tw("screen", "transform.rotation", 0, 0.07, DROP2, 1.4, "easeInOutCubic");
tw("screenMaskRect", "cornerRadius", 0, 90, DROP2, 1.4, "easeInOutCubic");
tw("screenFrame", "cornerRadius", 0, 90, DROP2, 1.4, "easeInOutCubic");
tw("screenFrame", "strokeWidth", 0, 16, DROP2, 1.4, "easeInOutCubic");

const revealKids = ["rvA", "rvB", "rvC"];
items.reveal = group(revealKids, T(0, 0), { enter: DROP2, exit: 26.4 });
items.rvA = text("THIS ENTIRE FILM", DISPLAY, 72, DIM, C(CX, 1250, { o: 0 }), { align: "center", letterSpacing: 4 });
items.rvB = text("IS ONE JSON FILE.", DISPLAY, 132, INK, C(CX, 1360, { o: 0 }), {
  align: "center", effects: [{ type: "glow", color: CYAN, radius: 18 }],
});
fadeIn("rvA", 24.9, 0.3);
fadeIn("rvB", 25.05, 0.3);
tw("rvB", "letterSpacing", 24, 2, 25.05, 0.6, "easeOutExpo");
items.rvC = text("__STATS__", MONO, 30, DIM, C(CX, 1540, { o: 0 }), { align: "center", lineHeight: 1.5 });
fadeIn("rvC", 25.3, 0.35);
tw("rvC", "transform.y", 1560, 1540, 25.3, 0.4, "easeOutCubic");
fadeOut("reveal", 26.1, 0.3);

// ════════════════════════════════════════════════════════════════════════════
// ACT 8 — CTA (26.4 → 30): the screen's rounded mask closes into a circle and
// becomes the author's avatar — `global:assets/X_profile.png`, cropped by an
// isolated destination-in disc — then name, handle and a Follow button built
// from the global library's `ctaButton` template.
// ════════════════════════════════════════════════════════════════════════════
const AV_Y = 700;
const AV_D = 440; // on-screen avatar diameter
const MORPH = 26.0, MORPH_D = 0.5;
// mask + frame close from a 1080×1920 rounded rect into a circle (in the
// screen group's local units: diameter / final scale)
const SCREEN_S2 = 0.5;
const LOCAL_D = AV_D / SCREEN_S2;
for (const id of ["screenMaskRect", "screenFrame"]) {
  tw(id, "width", W, LOCAL_D, MORPH, MORPH_D, "easeInOutCubic");
  tw(id, "height", H, LOCAL_D, MORPH, MORPH_D, "easeInOutCubic");
  tw(id, "cornerRadius", 90, LOCAL_D / 2, MORPH, MORPH_D, "easeInOutCubic");
}
scaleTw("screen", SCREEN_S, SCREEN_S2, MORPH, MORPH_D, "easeInOutCubic");
tw("screen", "transform.rotation", 0.07, 0, MORPH, MORPH_D, "easeInOutCubic");
tw("screenFrame", "strokeColor", INK, XBLUE, MORPH, MORPH_D, "easeInOutCubic");
tw("screenFrame", "strokeWidth", 16, 14, MORPH, MORPH_D, "easeInOutCubic");

// the avatar: the source PNG is a 218×272 profile-card crop whose photo is a
// circle centred at (111, 99), radius ≈ 84
const AV_SRC_R = 80;
const AV_S = AV_D / 2 / AV_SRC_R;
items.avatar = group(["avatarImg", "avatarMask"], C(CX, AV_Y, { o: 0 }), { isolate: true, enter: MORPH });
items.avatarImg = {
  type: "sprite", asset: "xProfile", width: 218 * AV_S, height: 272 * AV_S,
  transform: T(-111 * AV_S, -99 * AV_S),
};
items.avatarMask = group(["avatarDisc"], T(0, 0), { blendMode: "destination-in" });
items.avatarDisc = circle(AV_D, "#ffffff", C(0, 0));
fadeIn("avatar", MORPH + 0.3, 0.35);
items.avatarRing = circle(AV_D + 14, null, C(CX, AV_Y, { o: 0 }), {
  strokeColor: XBLUE, strokeWidth: 14, enter: MORPH,
  effects: [{ type: "glow", color: XBLUE, radius: 26 }],
});
fadeIn("avatarRing", MORPH + 0.45, 0.2);
fadeOut("screen", MORPH + 0.55, 0.15);
// pulses radiating from the avatar, one per beat: one $repeat for items and
// one for their tweens
items.pulse = {
  $repeat: { count: 6, as: "p", id: "pulse${p}" },
  item: circle(AV_D + 14, null, C(CX, AV_Y, { o: 0 }), {
    strokeColor: XBLUE, strokeWidth: 6, enter: "${26.5 + p * 0.5}", exit: "${27.5 + p * 0.5}",
  }),
};
for (const [prop, from, to, easing] of [
  ["transform.scaleX", 1, 1.55, "easeOutCubic"],
  ["transform.scaleY", 1, 1.55, "easeOutCubic"],
  ["transform.opacity", 0.9, 0, "easeOutQuad"],
]) {
  tweens.push({
    $repeat: { count: 6, as: "p" },
    item: {
      id: `pulse_${prop.split(".")[1]}_\${p}`, target: "pulse${p}", property: prop,
      from, to, start: "${26.5 + p * 0.5}", duration: 1, easing,
    },
  });
}
scaleTw("avatar", 1, 1.04, 27.0, 0.25, "easeOutQuad");
scaleTw("avatar", 1.04, 1, 27.25, 0.4, "easeOutBack");

// name + verified badge + handle
items.who = group(["whoName", "badge"], T(0, 0, { o: 0 }), { enter: 26.4 });
items.whoName = text("Narcissus", BOLD, 96, INK, C(CX - 34, 1045));
const rosette = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * 2 * Math.PI - Math.PI / 2;
  const r = i % 2 === 0 ? 34 : 29;
  rosette.push([+(r * Math.cos(a)).toFixed(2), +(r * Math.sin(a)).toFixed(2)]);
}
items.badge = group(["badgeRose", "badgeCheck"], C(CX + 262, 1043));
items.badgeRose = poly(rosette, XBLUE, T(0, 0));
items.badgeCheck = poly([[-15, -1], [-5, 9], [14, -11], [19, -6], [-5, 18], [-20, 4]], "#ffffff", T(0, 0));
fadeIn("who", 26.6, 0.3);
tw("who", "transform.y", 30, 0, 26.6, 0.45, "easeOutCubic");
scaleTw("badge", 0, 1, 26.9, 0.4, "easeOutBack");

items.handle = text("@13_narcissus", MONO, 50, DIM, C(CX, 1140, { o: 0 }), { align: "center", enter: 26.4 });
fadeIn("handle", 26.75, 0.3);
tw("handle", "letterSpacing", 12, 0, 26.75, 0.5, "easeOutExpo");

items.pitch = text("I build davidup in public —\nAI agents that direct video.", SANS, 40, INK,
  C(CX, 1265, { o: 0 }), { align: "center", lineHeight: 1.35, enter: 26.4 });
fadeIn("pitch", 26.95, 0.35);

// Follow button: the global library's `ctaButton` template, named straight
// from the library by id (L-1), plus the 𝕏 mark drawn as two polygons.
// Since B-8 the library's label is centred on its measured box, so the word
// sits on the pill's centre line and the mark only needs its own room to the
// left of it (before G4 the showcase patched the template's label to the
// right, which this can't do from a `params` block). Needs a library seeded
// at pack v2 — `bun run seed:library`.
const BTN_Y = 1450;
items.follow = {
  $template: "global:ctaButton", start: 27.2,
  params: {
    label: "Follow", x: CX, y: BTN_Y, width: 460, height: 124, cornerRadius: 62,
    fillColor: "#ffffff", textColor: "#0a0a0a", font: BOLD, fontSize: 56,
  },
};
items.xMark = group(["xThick", "xThin"], C(CX - 137, BTN_Y + 2, { o: 0 }), { enter: 27.2 });
// the 𝕏 glyph, drawn in a 60×60 box centred on the origin
items.xThick = poly([[-27, -28], [-9, -28], [27, 28], [9, 28]], "#0a0a0a", T(0, 0));
items.xThin = poly([[20, -28], [27, -28], [-20, 28], [-27, 28]], "#0a0a0a", T(0, 0));
fadeIn("xMark", 27.35, 0.25);
// a tap lands on the button
items.tap = circle(90, "#ffffff", C(CX + 120, BTN_Y + 20, { o: 0 }), { enter: 28.3, exit: 29.2 });
scaleTw("tap", 0.3, 2.4, 28.3, 0.7, "easeOutCubic");
tw("tap", "transform.opacity", 0.7, 0, 28.3, 0.7, "easeOutQuad");
items.tapHint = text("for more of this ↑", HAND, 64, CYAN, C(CX + 30, 1600, { r: -0.04, o: 0 }), {
  align: "center", enter: 26.4,
});
fadeIn("tapHint", 28.0, 0.35);
tw("tapHint", "transform.y", 1625, 1600, 28.0, 0.5, "easeOutBack");
items.signoff = text("davidup  ·  $ npx davidup", MONO, 30, DIM, C(CX, 1745, { o: 0 }), {
  align: "center", enter: 26.4,
});
fadeIn("signoff", 28.4, 0.4);

// ════════════════════════════════════════════════════════════════════════════
// HUD — REC dot (steps easing), a 900-entry frame counter from ONE $repeat
// (per-compile budget, v1.2), code captions from an inline template, progress.
// ════════════════════════════════════════════════════════════════════════════
items.rec = circle(18, "#ff3b4e", C(84, 118));
tw("rec", "transform.opacity", 1, 0.15, 0, 30, { steps: 30 });
items.brand = text("DAVIDUP", MONO, 28, INK, T(110, 118, { ay: 0.5 }), { letterSpacing: 6 });
items.hud = {
  $repeat: { count: 900, as: "i", id: "frame${i}" },
  item: text("frame ${i + 1} / 900", MONO, 28, "#6a74a0", T(996, 118, { ax: 1, ay: 0.5 }), {
    enter: "${i / 30}", exit: "${(i + 1) / 30}",
  }),
};
items.timebar = rect(0, 8, CYAN, T(0, 1912, { o: 0.85 }));
tw("timebar", "width", 0, W, 0, 30, "linear");

const chipTemplate = {
  id: "codeChip",
  description: "Monospace caption under the HUD naming the JSON on screen.",
  params: [
    { name: "text", type: "string", required: true },
    { name: "dur", type: "number", required: true },
    { name: "color", type: "color", default: CYAN },
  ],
  items: {
    tick: rect(6, 34, "${params.color}", T(72, 186, { o: 0 })),
    label: text("${params.text}", MONO, 28, "${params.color}", T(96, 184, { o: 0 }), { maxWidth: 900, lineHeight: 1.3 }),
  },
  tweens: [
    { target: "label", property: "transform.opacity", from: 0, to: 1, start: 0, duration: 0.25, easing: "easeOutQuad" },
    { target: "label", property: "letterSpacing", from: 8, to: 0, start: 0, duration: 0.5, easing: "easeOutExpo" },
    { target: "label", property: "transform.opacity", from: 1, to: 0, start: "${params.dur - 0.25}", duration: 0.25, easing: "easeInQuad" },
    { target: "tick", property: "transform.opacity", from: 0, to: 1, start: 0, duration: 0.25, easing: "easeOutQuad" },
    { target: "tick", property: "transform.opacity", from: 1, to: 0, start: "${params.dur - 0.25}", duration: 0.25, easing: "easeInQuad" },
  ],
};
const CAPTIONS = [
  [0.3, 3.1, '"$repeat": 20 rings × 48 dots → 960 items'],
  [3.7, 2.2, '"isolate": true · "blendMode": "lighter"'],
  [6.15, 2.75, "text v2: maxWidth · lineHeight · letterSpacing"],
  [9.15, 2.75, '"effects": [blur, glow, shadow] · user behavior'],
  [12.15, 2.75, '"easing": { "bezier": [...] } · { "steps": 8 }'],
  [15.15, 3.25, 'nested groups in a scene · "time": { mode }'],
  [18.65, 3.75, '"type": "video" · fit · keepAudio · alpha'],
  [25.0, 1.3, "--from 24 --to 30 → fed back into itself"],
  [26.5, 3.5, '"src": "global:assets/X_profile.png"', XBLUE],
];
const captionIds = CAPTIONS.map((_, k) => `cap${k}`);
CAPTIONS.forEach(([start, dur, txt, color], k) => {
  items[`cap${k}`] = { $template: "codeChip", start, params: { text: txt, dur, ...(color ? { color } : {}) } };
});

// shockwaves + flashes on the two drops
for (const [id, at, color, y] of [["shock1", DROP1, "#ffffff", 860], ["shock2", DROP2, CYAN, 960]]) {
  items[id] = circle(200, null, C(CX, y, { s: 0.1 }), {
    strokeColor: color, strokeWidth: 30, enter: at, exit: at + 1,
  });
  scaleTw(id, 0.1, 12, at, 1.0, "easeOutExpo");
  tw(id, "strokeWidth", 30, 0.5, at, 1.0, "easeOutQuad");
  tw(id, "transform.opacity", 1, 0, at, 1.0, "easeInQuad");
  items[`${id}Flash`] = rect(W, H, "#ffffff", T(0, 0, { o: 0 }), { enter: at, exit: at + 0.45 });
  tw(`${id}Flash`, "transform.opacity", 0.8, 0, at, 0.45, "easeOutQuad");
}

// ── assembly ───────────────────────────────────────────────────────────────
const ticks = [];
for (const base of [12.35, 13.6]) {
  for (let k = 1; k <= 8; k++) ticks.push(+(base + (k * RACE_DUR) / 8).toFixed(4));
}
// music: the 120 BPM bed, cut so its two drops land on DROP1 and DROP2
// (the drops sit at 16.12 s and 42.35 s into music.mp3)
const audio = [
  { id: "musicA", asset: "music", start: 0, end: 21, trimIn: 16.12 - DROP1, volume: 1, fadeIn: 0.6, fadeOut: 1.5 },
  { id: "musicB", asset: "music", start: 19.5, end: 30, trimIn: 42.35 - (DROP2 - 19.5), volume: 1, fadeIn: 1.5, fadeOut: 1.2 },
  { id: "riser1", asset: "riser", start: DROP1 - 1.2, volume: 0.9 },
  { id: "boom1", asset: "boom", start: DROP1, volume: 1 },
  { id: "riser2", asset: "riser", start: DROP2 - 1.2, volume: 0.9 },
  { id: "boom2", asset: "boom", start: DROP2, volume: 1 },
  { id: "tapClick", asset: "tick", start: 28.3, volume: 0.9 },
  ...ticks.map((t, k) => ({ id: `tick${k}`, asset: "tick", start: t, volume: 0.5 })),
];

const composition = {
  $comment:
    "davidup vertical showcase — 30 s, 9:16. Authored JSON: templates, scenes, $repeat, $behavior, expressions and global-library assets all compile down at render. Build: node examples/showcase-vertical/build.mjs · Render: bun run examples/showcase-vertical/render.ts",
  version: "0.1",
  composition: {
    width: W, height: H, fps: 30, duration: 30, background: BG,
    audioMaster: { targetLufs: -14, limiter: true },
  },
  assets: [
    { id: DISPLAY, type: "font", src: "global:fonts/anton-400.woff2", family: "Anton" },
    { id: MONO, type: "font", src: "global:fonts/jetbrains-mono-500.woff2", family: "JetBrains Mono" },
    { id: SERIF, type: "font", src: "global:fonts/playfair-display-700.woff2", family: "Playfair Display" },
    { id: HAND, type: "font", src: "global:fonts/caveat-700.woff2", family: "Caveat" },
    { id: BOLD, type: "font", src: "global:fonts/inter-700.woff2", family: "InterBold" },
    { id: "xProfile", type: "image", src: "global:assets/X_profile.png" },
    { id: "music", type: "audio", src: rel(`${SHARED}/music.mp3`) },
    { id: "boom", type: "audio", src: rel(`${SHARED}/boom.wav`) },
    { id: "riser", type: "audio", src: rel(`${SHARED}/riser.wav`) },
    { id: "tick", type: "audio", src: rel(`${SHARED}/tick.wav`) },
    { id: "life", type: "video", src: rel(`${SHARED}/life.mp4`), hasAudio: true },
    { id: "fractal", type: "video", src: rel(`${SHARED}/mandelbrot.mp4`) },
    { id: "badge", type: "video", src: rel("output/alpha-badge.mov") },
    { id: "self", type: "video", src: rel(selfArg) },
  ],
  templates: { codeChip: chipTemplate },
  behaviors: { neonFlicker },
  scenes: { race: raceScene, orrery },
  layers: [
    { id: "backdrop", z: 0, opacity: 1, blendMode: "normal", items: ["aurora", "lifeWrap"], name: "backdrop" },
    {
      id: "acts", z: 10, opacity: 1, blendMode: "normal", name: "acts",
      items: [
        "iris", "hook1", "hook2", "hookSub",
        "logo", "tagline", "pill", "type", "light",
        "motion", "raceThere", "raceBack", "reverseTag",
        "time", // the five orrery instances are inside it (L-2)
        "footage", "no0", "no1", "no2", "screen", "reveal",
        "pulse", "avatar", "avatarRing", "who", "handle", "pitch", "follow", "xMark", "tap", "tapHint", "signoff",
      ],
    },
    { id: "hud", z: 20, opacity: 1, blendMode: "normal", name: "hud", items: ["rec", "brand", "hud", "timebar", ...captionIds] },
    { id: "fx", z: 30, opacity: 1, blendMode: "normal", name: "fx", items: ["shock1", "shock1Flash", "shock2", "shock2Flash"] },
  ],
  items,
  tweens,
  audio,
};

if (process.env.SHOWCASE_STATS) items.rvC.text = process.env.SHOWCASE_STATS;
const json = JSON.stringify(composition, null, 1);
writeFileSync(outFile, json + "\n");
console.log(`wrote ${outFile} (${(json.length / 1024).toFixed(1)} KB, ${Object.keys(items).length} authored items, ${tweens.length} authored tweens)`);

// ── the alpha overlay (rendered on its own to ProRes 4444) ──────────────────
const badge = {
  $comment: "Overlay for the vertical showcase's footage act; rendered with a transparent background to ProRes 4444.",
  version: "0.1",
  composition: { width: W, height: 300, fps: 30, duration: 3, background: "transparent" },
  assets: [
    { id: DISPLAY, type: "font", src: "global:fonts/anton-400.woff2", family: "Anton" },
    { id: MONO, type: "font", src: "global:fonts/jetbrains-mono-500.woff2", family: "JetBrains Mono" },
  ],
  layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["bar", "ring", "title", "sub"] }],
  items: {
    bar: rect(0, 150, "#0b0e1acc", T(60, 75), { cornerRadius: 22, strokeColor: LIME, strokeWidth: 3 }),
    ring: circle(96, null, C(142, 150, { o: 0 }), { strokeColor: LIME, strokeWidth: 10 }),
    title: text("PRORES 4444 · ALPHA", DISPLAY, 64, INK, T(214, 150, { ay: 0.5, o: 0 }), { letterSpacing: 3 }),
    sub: text("rendered by davidup, composited back in", MONO, 26, LIME, T(216, 202, { ay: 0.5, o: 0 })),
  },
  tweens: [
    { id: "b0", target: "bar", property: "width", from: 0, to: 960, start: 0, duration: 0.5, easing: "easeOutExpo" },
    { id: "r0", target: "ring", property: "transform.opacity", from: 0, to: 1, start: 0.2, duration: 0.2, easing: "easeOutQuad" },
    { id: "r1", target: "ring", property: "transform.scaleX", from: 0.2, to: 1, start: 0.2, duration: 0.5, easing: "easeOutBack" },
    { id: "r2", target: "ring", property: "transform.scaleY", from: 0.2, to: 1, start: 0.2, duration: 0.5, easing: "easeOutBack" },
    { id: "t0", target: "title", property: "transform.opacity", from: 0, to: 1, start: 0.3, duration: 0.3, easing: "easeOutQuad" },
    { id: "t1", target: "title", property: "letterSpacing", from: 20, to: 3, start: 0.3, duration: 0.6, easing: "easeOutExpo" },
    { id: "s0", target: "sub", property: "transform.opacity", from: 0, to: 1, start: 0.5, duration: 0.3, easing: "easeOutQuad" },
    { id: "b1", target: "bar", property: "transform.opacity", from: 1, to: 0, start: 2.6, duration: 0.3, easing: "easeInQuad" },
    { id: "r3", target: "ring", property: "transform.opacity", from: 1, to: 0, start: 2.6, duration: 0.3, easing: "easeInQuad" },
    { id: "t2", target: "title", property: "transform.opacity", from: 1, to: 0, start: 2.6, duration: 0.3, easing: "easeInQuad" },
    { id: "s1", target: "sub", property: "transform.opacity", from: 1, to: 0, start: 2.6, duration: 0.3, easing: "easeInQuad" },
  ],
};
writeFileSync(join(HERE, "alpha-badge.json"), JSON.stringify(badge, null, 1) + "\n");
