// davidup v1.1 showcase — 30 s, 1920×1080, every v1.1 feature on screen.
//
//   node examples/showcase-v1.1/build.mjs [selfVideo] [outFile]
//
// Writes an *authored* composition (templates, scenes, $repeat, $behavior,
// expressions — not the compiled form) next to this script. `selfVideo` is the
// clip the closing "screen" plays: the Droste pass script (render.sh) feeds
// each pass's own output back in, so the ending shows the film rendering
// itself, one level deeper per pass, with the Mandelbrot at the bottom.
//
// The cut grid is on the music: 120 BPM, first drop at t=3.5, second at 25.5.

import { writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const selfArg = process.argv[2] ?? "assets/mandelbrot.mp4";
const outFile = resolve(HERE, process.argv[3] ?? "composition.json");
const rel = (p) => relative(dirname(outFile), resolve(HERE, p)) || ".";

// ── palette ────────────────────────────────────────────────────────────────
const BG = "#06070d";
const INK = "#eef1ff";
const DIM = "#8a93b8";
const CYAN = "#3de8ff";
const MAG = "#ff3d9a";
const AMB = "#ffc23d";
const VIO = "#8b6cff";
const LIME = "#7dff9a";

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
const beh = (behavior, target, start, duration, params = {}, easing) =>
  tweens.push({ $behavior: behavior, target, start, duration, params, ...(easing ? { easing } : {}) });

const text = (txt, font, fontSize, color, transform, extra = {}) => ({
  type: "text", text: txt, font, fontSize, color, transform, ...extra,
});
const rect = (w, h, fillColor, transform, extra = {}) => ({
  type: "shape", kind: "rect", width: w, height: h, fillColor, transform, ...extra,
});
const circle = (d, fillColor, transform, extra = {}) => ({
  type: "shape", kind: "circle", width: d, height: d, ...(fillColor ? { fillColor } : {}), transform, ...extra,
});
const group = (children, transform, extra = {}) => ({ type: "group", items: children, transform, ...extra });

const DISPLAY = "font-display";
const MONO = "font-mono";
const SANS = "font:default"; // bundled Inter — no asset registration (R-30)

// ════════════════════════════════════════════════════════════════════════════
// ACT 0 — IGNITION (0 → 3.5): a grid of 312 dots ripples out from the centre,
// an orb focus-pulls out of a 50 px blur, then implodes into the first drop.
// ════════════════════════════════════════════════════════════════════════════
items.grid = group(["dot"], T(960, 540));
items.dot = {
  $repeat: { count: 13, as: "r" },
  item: {
    $repeat: { count: 24, as: "c", id: "dot${r}_${c}" },
    item: circle(6, CYAN, {
      x: "${c * 80 - 920}", y: "${r * 80 - 480}",
      scaleX: 0, scaleY: 0, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 0,
    }),
  },
};
const ripple = "${0.25 + (max(c - 11.5, 11.5 - c) + max(r - 6, 6 - r)) * 0.075}";
for (const [prop, to, dur, easing] of [
  ["transform.opacity", 0.6, 0.35, "easeOutQuad"],
  ["transform.scaleX", 1, 0.5, "easeOutBack"],
  ["transform.scaleY", 1, 0.5, "easeOutBack"],
]) {
  tweens.push({
    $repeat: { count: 13, as: "r" },
    item: {
      $repeat: { count: 24, as: "c" },
      item: {
        id: `dot_${prop.split(".")[1]}_\${r}_\${c}`, target: "dot${r}_${c}",
        property: prop, from: 0, to, start: ripple, duration: dur, easing,
      },
    },
  });
}
// the drop kicks the whole grid outward, then it settles as a backdrop
scaleTw("grid", 1.18, 1, 3.5, 0.9, "easeOutExpo");
tw("grid", "transform.opacity", 1, 0.3, 3.5, 1.2, "easeOutQuad");

items.orb = circle(180, "#ffffff", C(960, 540, { o: 0, s: 0.6 }), {
  exit: 3.5,
  effects: [{ type: "blur", radius: 50 }, { type: "glow", color: CYAN, radius: 36 }],
});
tw("orb", "effects.0.radius", 50, 0, 0, 1.8, "easeInOutCubic");
tw("orb", "transform.opacity", 0, 1, 0, 0.6, "easeOutQuad");
scaleTw("orb", 0.6, 1, 0, 1.8, "easeOutCubic");
scaleTw("orb", 1, 0.06, 2.65, 0.85, { bezier: [0.6, -0.5, 0.9, 0.4] });
tw("orb", "effects.1.radius", 36, 110, 2.65, 0.85, "easeInQuad");

items.formula = text("frame = render(json, t)", MONO, 34, DIM, C(960, 770, { o: 0 }), {
  align: "center", letterSpacing: 26, exit: 3.5,
});
tw("formula", "letterSpacing", 26, 3, 0.6, 1.8, "easeOutCubic");
tw("formula", "transform.opacity", 0, 1, 0.6, 0.6, "easeOutQuad");
tw("formula", "transform.opacity", 1, 0, 2.7, 0.4, "easeInQuad");

// ════════════════════════════════════════════════════════════════════════════
// ACT 1 — LOGO SLAM (3.5 → 6.5): three additive R/G/B copies of the wordmark
// converge into white inside an isolated group, then glitch on the beat.
// ════════════════════════════════════════════════════════════════════════════
items.logo = group(["logoMix"], C(960, 500, { s: 1.5 }), {
  isolate: true, enter: 3.5, exit: 6.5,
  effects: [{ type: "glow", color: MAG, radius: 26 }],
});
items.logoMix = group(["logoR", "logoG", "logoB"], T(0, 0), { blendMode: "lighter" });
const logoText = (color, x, y) =>
  text("DAVIDUP", DISPLAY, 340, color, C(x, y), { align: "center", letterSpacing: 90 });
items.logoR = logoText("#ff1e3c", -70, 0);
items.logoG = logoText("#1eff8c", 0, 36);
items.logoB = logoText("#1e6bff", 70, 0);
for (const id of ["logoR", "logoG", "logoB"]) tw(id, "letterSpacing", 90, 14, 3.5, 0.9, "easeOutExpo");
tw("logoR", "transform.x", -70, 0, 3.5, 0.7, "easeOutExpo");
tw("logoB", "transform.x", 70, 0, 3.5, 0.7, "easeOutExpo");
tw("logoG", "transform.y", 36, 0, 3.5, 0.7, "easeOutExpo");
scaleTw("logo", 1.5, 1, 3.5, 0.6, "easeOutExpo");
tw("logo", "effects.0.radius", 60, 14, 3.5, 1.0, "easeOutCubic");
// glitches on the beat
beh("shake", "logoR", 5.0, 0.3, { amplitude: 16, cycles: 3, axis: "x", center: 0 });
beh("shake", "logoB", 5.0, 0.3, { amplitude: 12, cycles: 2, axis: "y", center: 0 });
beh("shake", "logoG", 5.5, 0.25, { amplitude: 14, cycles: 3, axis: "x", center: 0 });
// zoom-through exit
scaleTw("logo", 1, 3.2, 6.05, 0.45, "easeInExpo");
tw("logo", "transform.opacity", 1, 0, 6.2, 0.3, "easeInQuad");

items.tagline = text(
  "programmable video  ·  rendered from JSON  ·  driven by AI agents",
  SANS, 36, DIM, C(960, 720, { o: 0 }), { align: "center", letterSpacing: 5, enter: 3.5, exit: 6.5 },
);
tw("tagline", "transform.opacity", 0, 1, 4.1, 0.5, "easeOutQuad");
tw("tagline", "transform.y", 750, 720, 4.1, 0.6, "easeOutCubic");
tw("tagline", "transform.opacity", 1, 0, 6.0, 0.3, "easeInQuad");

items.pill = group(["pillBox", "pillText"], C(960, 815, { o: 0 }), { enter: 3.5, exit: 6.5 });
items.pillBox = rect(190, 54, "#3de8ff14", C(0, 0), { cornerRadius: 27, strokeColor: CYAN, strokeWidth: 2 });
items.pillText = text("v1.1", MONO, 28, CYAN, C(0, 1), { align: "center" });
beh("popIn", "pill", 4.4, 0.5, {}, "easeOutBack");
tw("pill", "transform.opacity", 1, 0, 6.0, 0.3, "easeInQuad");

// ════════════════════════════════════════════════════════════════════════════
// ACT 2 — TYPE (6.5 → 10): text v2 — wrap, breathing line height, tracking,
// stroke-then-fill, hard shadow, metric anchors; exits with a motion blur.
// ════════════════════════════════════════════════════════════════════════════
items.type = group(["head", "outline", "tracking", "para"], T(300, 0), {
  enter: 6.5, exit: 10,
  effects: [{ type: "blur", radius: 24 }],
});
tw("type", "transform.x", 300, 0, 6.5, 0.55, "easeOutCubic");
tw("type", "effects.0.radius", 24, 0, 6.5, 0.45, "easeOutQuad");
tw("type", "transform.x", 0, -380, 9.6, 0.4, "easeInCubic");
tw("type", "effects.0.radius", 0, 30, 9.6, 0.4, "easeInQuad");
tw("type", "transform.opacity", 1, 0, 9.7, 0.3, "easeInQuad");

items.head = text("Words that wrap, breathe & glow.", DISPLAY, 150, INK, T(110, 150), {
  maxWidth: 820, lineHeight: 1.6, letterSpacing: 30,
  shadow: { color: MAG, blur: 0, offsetX: 8, offsetY: 8 },
});
tw("head", "lineHeight", 1.6, 0.86, 6.6, 1.2, "easeOutExpo");
tw("head", "letterSpacing", 30, 2, 6.6, 1.0, "easeOutExpo");

items.outline = text("OUTLINE", DISPLAY, 260, "#3de8ff00", C(1410, 330, { r: -0.3, s: 0.7 }), {
  align: "center", strokeColor: CYAN, strokeWidth: 0,
});
tw("outline", "strokeWidth", 0, 5, 6.9, 0.5, "easeOutQuad");
tw("outline", "transform.rotation", -0.3, 0, 6.9, 0.8, "easeOutBack");
scaleTw("outline", 0.7, 1, 6.9, 0.8, "easeOutBack");
tw("outline", "color", "#3de8ff00", "#3de8ffff", 8.4, 0.6, "easeInOutQuad");
tw("outline", "strokeWidth", 5, 0, 8.4, 0.6, "easeInOutQuad");

items.tracking = text("TRACKING", DISPLAY, 130, AMB, C(1410, 590, { o: 0 }), {
  align: "center", letterSpacing: 0,
});
tw("tracking", "transform.opacity", 0, 1, 7.3, 0.4, "easeOutQuad");
tw("tracking", "letterSpacing", 0, 48, 7.3, 1.0, "easeInOutSine");
tw("tracking", "letterSpacing", 48, 8, 8.3, 1.0, "easeInOutSine");

items.para = text(
  "Text v2 measures every glyph: multiline, word-wrap, metric anchors, tracking, stroke and shadow — identical in the browser preview and in the final render.",
  SANS, 32, DIM, T(114, 760, { o: 0 }), { maxWidth: 760, lineHeight: 1.45 },
);
tw("para", "transform.opacity", 0, 1, 7.6, 0.6, "easeOutQuad");
tw("para", "transform.y", 790, 760, 7.6, 0.7, "easeOutCubic");

// ════════════════════════════════════════════════════════════════════════════
// ACT 3 — LIGHT (10 → 13.5): one white disc focus-pulls in and splits into an
// additive RGB Venn (isolated group + lighter children + glow); a card lifts
// on a tweened drop shadow; isolate:false vs isolate:true side by side.
// ════════════════════════════════════════════════════════════════════════════
items.light = group(["venn", "card", "isoOff", "isoOn", "isoOffLbl", "isoOnLbl"], T(0, 0), {
  enter: 10, exit: 13.5,
});
items.venn = group(["vennMix"], C(640, 560, { s: 0.4 }), {
  isolate: true,
  effects: [{ type: "blur", radius: 40 }, { type: "glow", color: VIO, radius: 30 }],
});
items.vennMix = group(["vR", "vG", "vB"], T(0, 0), { blendMode: "lighter" });
const vennPos = { vR: [0, -125], vG: [108, 62], vB: [-108, 62] };
const vennCol = { vR: "#ff2a4a", vG: "#2aff7a", vB: "#2a6aff" };
for (const [id, [x, y]] of Object.entries(vennPos)) {
  items[id] = circle(430, vennCol[id], C(0, 0));
  tw(id, "transform.x", 0, x, 10.3, 0.8, "easeOutBack");
  tw(id, "transform.y", 0, y, 10.3, 0.8, "easeOutBack");
  tw(id, "transform.x", x, 0, 12.8, 0.45, "easeInCubic");
  tw(id, "transform.y", y, 0, 12.8, 0.45, "easeInCubic");
}
tw("venn", "effects.0.radius", 40, 0, 10.0, 0.9, "easeOutCubic");
scaleTw("venn", 0.4, 1, 10.0, 0.9, "easeOutBack");
tw("venn", "transform.rotation", 0, 1.4, 10.0, 3.2, "easeInOutSine");
scaleTw("venn", 1, 0, 13.2, 0.3, "easeInBack");

items.card = group(["cardBox", "cardTitle", "cardSub"], C(1420, 470, { o: 0 }), {
  effects: [{ type: "shadow", color: "#ff3d9ab0", blur: 8, offsetX: 0, offsetY: 4 }],
});
items.cardBox = rect(540, 300, "#151b31", C(0, 0), { cornerRadius: 28, strokeColor: "#ffffff30", strokeWidth: 2 });
items.cardTitle = text("DROP SHADOW", DISPLAY, 96, INK, C(0, -38), { align: "center", letterSpacing: 4 });
items.cardSub = text("effects.0.offsetY  4 → 56", MONO, 26, DIM, C(0, 62), { align: "center" });
tw("card", "transform.opacity", 0, 1, 10.3, 0.4, "easeOutQuad");
tw("card", "effects.0.offsetY", 4, 56, 10.5, 1.3, "easeOutCubic");
tw("card", "effects.0.blur", 8, 70, 10.5, 1.3, "easeOutCubic");
tw("card", "transform.y", 500, 440, 10.5, 1.3, "easeOutCubic");
tw("card", "transform.y", 440, 452, 11.8, 1.4, "easeInOutSine");
tw("card", "transform.opacity", 1, 0, 13.1, 0.35, "easeInQuad");

// isolate demo: two diamonds at 55 % — the seam shows unless isolated
const diamonds = (id, x, isolate) => {
  items[id] = group([`${id}A`, `${id}B`], T(x, 860, { o: 0 }), isolate ? { isolate: true } : {});
  items[`${id}A`] = rect(130, 130, AMB, C(-48, 0, { r: Math.PI / 4 }));
  items[`${id}B`] = rect(130, 130, AMB, C(48, 0, { r: Math.PI / 4 }));
  tw(id, "transform.opacity", 0, 0.55, 11.0, 0.5, "easeOutQuad");
  tw(id, "transform.opacity", 0.55, 0, 13.1, 0.35, "easeInQuad");
};
diamonds("isoOff", 1250, false);
diamonds("isoOn", 1600, true);
items.isoOffLbl = text("isolate: false", MONO, 24, DIM, C(1250, 985, { o: 0 }), { align: "center" });
items.isoOnLbl = text("isolate: true", MONO, 24, CYAN, C(1600, 985, { o: 0 }), { align: "center" });
for (const id of ["isoOffLbl", "isoOnLbl"]) {
  tw(id, "transform.opacity", 0, 1, 11.2, 0.4, "easeOutQuad");
  tw(id, "transform.opacity", 1, 0, 13.1, 0.35, "easeInQuad");
}

// ════════════════════════════════════════════════════════════════════════════
// ACT 4 — MOTION (13.5 → 17): six easings race; the same scene then plays in
// `reverse`, which mirrors every easing (easeOut ↔ easeIn) on the way back.
// ════════════════════════════════════════════════════════════════════════════
const LANES = [
  ["linear", "linear", INK],
  ["easeOutBack", "easeOutBack", CYAN],
  ["easeInOutExpo", "easeInOutExpo", VIO],
  ["bezier(.7, -.6, .3, 1.6)", { bezier: [0.7, -0.6, 0.3, 1.6] }, MAG],
  ["bezier(.1, 1.5, .3, 1)", { bezier: [0.1, 1.5, 0.3, 1] }, LIME],
  ["steps(8)", { steps: 8 }, AMB],
];
const laneY = (k) => 300 + k * 112;
const RACE_X0 = 520, RACE_X1 = 1760, RACE_DUR = 1.5;
const motionChildren = ["motionTitle", "track"];
items.motionTitle = text("TIMING IS EVERYTHING.", DISPLAY, 96, INK, T(110, 190, { o: 0 }), { letterSpacing: 2 });
tw("motionTitle", "transform.opacity", 0, 1, 13.5, 0.35, "easeOutQuad");
items.track = {
  $repeat: { count: LANES.length, as: "k", id: "track${k}" },
  item: rect(RACE_X1 - RACE_X0, 2, "#ffffff22", {
    x: RACE_X0, y: "${300 + k * 112}", scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0.5, opacity: 1,
  }),
};
LANES.forEach(([label], k) => {
  const id = `laneLbl${k}`;
  items[id] = text(label, MONO, 26, LANES[k][2], T(RACE_X0 - 40, laneY(k) + 9, { o: 0 }), { align: "right" });
  motionChildren.push(id);
  tw(id, "transform.opacity", 0, 1, 13.55 + k * 0.05, 0.3, "easeOutQuad");
});
items.motion = group(motionChildren, T(0, 0), { enter: 13.5, exit: 17 });
tw("motion", "transform.opacity", 1, 0, 16.7, 0.3, "easeInQuad");

const raceScene = {
  id: "race",
  description: "Six balls crossing their lanes, one easing each.",
  duration: RACE_DUR,
  size: { width: 1920, height: 1080 },
  background: "transparent",
  params: [],
  items: Object.fromEntries(
    LANES.map(([, , color], k) => [
      `ball${k}`,
      circle(44, color, C(RACE_X0, laneY(k)), { effects: [{ type: "glow", color, radius: 14 }] }),
    ]),
  ),
  tweens: LANES.map(([, easing], k) => ({
    id: `run${k}`, target: `ball${k}`, property: "transform.x",
    from: RACE_X0, to: RACE_X1, start: 0, duration: RACE_DUR, easing,
  })),
};
items.raceThere = { type: "scene", scene: "race", start: 13.9, transform: T(0, 0) };
items.raceBack = { type: "scene", scene: "race", start: 15.4, time: { mode: "reverse" }, transform: T(0, 0) };
items.reverseTag = text("time: { mode: \"reverse\" }  — easings mirror on the way back", MONO, 24, DIM,
  T(RACE_X0, 1000, { o: 0 }), { enter: 13.5, exit: 17 });
tw("reverseTag", "transform.opacity", 0, 1, 15.4, 0.3, "easeOutQuad");
tw("reverseTag", "transform.opacity", 1, 0, 16.7, 0.3, "easeInQuad");

// ════════════════════════════════════════════════════════════════════════════
// ACT 5 — TIME (17 → 21): one orrery scene, five time mappings.
// ════════════════════════════════════════════════════════════════════════════
const ORR = 1.6;
const orrery = {
  id: "orrery",
  description: "Sun, planet and moon; a progress bar shows the scene's own clock.",
  duration: ORR,
  size: { width: 300, height: 360 },
  background: "transparent",
  params: [],
  // `arm` pivots on the sun and carries the planet; the nested `moonArm`
  // pivots on the planet and carries the moon and its orbit ring.
  items: {
    ring: circle(220, null, C(150, 150), { strokeColor: "#ffffff26", strokeWidth: 2 }),
    sun: circle(56, AMB, C(150, 150), { effects: [{ type: "glow", color: AMB, radius: 18 }] }),
    arm: group(["planet", "moonArm"], T(150, 150)),
    planet: circle(30, CYAN, C(110, 0), { effects: [{ type: "glow", color: CYAN, radius: 10 }] }),
    moonArm: group(["ring2", "moon"], T(110, 0)),
    ring2: circle(56, null, C(0, 0), { strokeColor: "#ffffff1a", strokeWidth: 2 }),
    moon: circle(12, INK, C(28, 0)),
    barBg: rect(240, 6, "#ffffff1a", T(30, 320), { cornerRadius: 3 }),
    bar: rect(0, 6, MAG, T(30, 320), { cornerRadius: 3 }),
  },
  tweens: [
    { id: "orbit", target: "arm", property: "transform.rotation", from: 0, to: 2 * Math.PI, start: 0, duration: ORR, easing: "easeInOutSine" },
    { id: "moonOrbit", target: "moonArm", property: "transform.rotation", from: 0, to: -4 * Math.PI, start: 0, duration: ORR, easing: "linear" },
    { id: "clock", target: "bar", property: "width", from: 0, to: 240, start: 0, duration: ORR, easing: "linear" },
  ],
};
const MODES = [
  ["identity", "as authored", { mode: "identity" }],
  ["timeScale: 0.5", "half speed", { mode: "timeScale", scale: 0.5 }],
  ["loop: 2", "twice, back to back", { mode: "loop", count: 2 }],
  ["reverse", "backwards", { mode: "reverse" }],
  ["clip: [0.3, 1.3]", "trimmed, auto-resampled", { mode: "clip", fromTime: 0.3, toTime: 1.3 }],
];
const timeChildren = ["timeTitle"];
items.timeTitle = text("ONE SCENE. FIVE CLOCKS.", DISPLAY, 110, INK, C(960, 200, { o: 0 }), { align: "center", letterSpacing: 3 });
tw("timeTitle", "transform.opacity", 0, 1, 17.0, 0.35, "easeOutQuad");
MODES.forEach(([label, sub, time], k) => {
  const cx = 260 + k * 350;
  items[`orr${k}`] = { type: "scene", scene: "orrery", start: 17.4, time, exit: 21, transform: T(cx - 150, 330) };
  items[`orrLbl${k}`] = text(label, MONO, 28, k === 0 ? INK : CYAN, C(cx, 750, { o: 0 }), { align: "center" });
  items[`orrSub${k}`] = text(sub, SANS, 24, DIM, C(cx, 796, { o: 0 }), { align: "center" });
  timeChildren.push(`orrLbl${k}`, `orrSub${k}`);
  tw(`orrLbl${k}`, "transform.opacity", 0, 1, 17.2 + k * 0.08, 0.3, "easeOutQuad");
  tw(`orrSub${k}`, "transform.opacity", 0, 1, 17.3 + k * 0.08, 0.3, "easeOutQuad");
});
items.time = group(timeChildren, T(0, 0), { enter: 17, exit: 21 });
tw("time", "transform.opacity", 1, 0, 20.65, 0.35, "easeInQuad");
for (let k = 0; k < MODES.length; k++) tw(`orr${k}`, "transform.opacity", 1, 0, 20.65, 0.35, "easeInQuad");

// ════════════════════════════════════════════════════════════════════════════
// ACT 6 — FOOTAGE (21 → 24.5): real video items — Game of Life b-roll with its
// own sound (keepAudio), a Mandelbrot zoom under contain / cover / a mask.
// ════════════════════════════════════════════════════════════════════════════
items.lifeWrap = group(["lifeBg"], T(0, 0, { o: 0 }), { blendMode: "screen", enter: 21, exit: 25.5 });
items.lifeBg = {
  type: "video", asset: "life", width: 1920, height: 1080, start: 21, fit: "cover", keepAudio: true,
  transform: T(0, 0),
};
tw("lifeWrap", "transform.opacity", 0, 0.4, 21, 0.6, "easeOutQuad");
tw("lifeWrap", "transform.opacity", 0.4, 0, 24.3, 0.5, "easeInQuad");

const footChildren = ["footTitle"];
items.footTitle = text("REAL FOOTAGE. COMPOSITED.", DISPLAY, 110, INK, C(960, 190, { o: 0 }), { align: "center", letterSpacing: 3 });
tw("footTitle", "transform.opacity", 0, 1, 21.0, 0.35, "easeOutQuad");
const BOX = 440;
const cards = [
  ["contain", 400, "fit: \"contain\""],
  ["cover", 960, "fit: \"cover\""],
  ["mask", 1520, "isolate + destination-in"],
];
cards.forEach(([kind, cx, label], k) => {
  const id = `foot_${kind}`;
  const vid = `${id}_v`;
  if (kind === "mask") {
    items[id] = group([vid, `${id}_m`], C(cx, 540, { s: 0.2, o: 0 }), {
      isolate: true, effects: [{ type: "glow", color: VIO, radius: 22 }],
    });
    items[`${id}_m`] = group([`${id}_disc`], T(0, 0), { blendMode: "destination-in" });
    items[`${id}_disc`] = circle(BOX, "#ffffff", C(0, 0));
    tw(id, "transform.rotation", 0, 0.5, 21.4, 3.0, "linear");
  } else {
    items[id] = group([`${id}_frame`, vid], C(cx, 540, { s: 0.2, o: 0 }));
    items[`${id}_frame`] = rect(BOX + 8, BOX + 8, "#0b0e1a", C(0, 0), { strokeColor: "#ffffff40", strokeWidth: 2 });
  }
  items[vid] = {
    type: "video", asset: "fractal", width: BOX, height: BOX, start: 21.2,
    trimIn: kind === "mask" ? 3.5 : 1.2, fit: kind === "contain" ? "contain" : "cover",
    transform: C(0, 0),
  };
  beh("popIn", id, 21.2 + k * 0.2, 0.55, {}, "easeOutBack");
  items[`${id}_lbl`] = text(label, MONO, 28, k === 2 ? VIO : CYAN, C(cx, 822, { o: 0 }), { align: "center" });
  tw(`${id}_lbl`, "transform.opacity", 0, 1, 21.5 + k * 0.2, 0.3, "easeOutQuad");
  footChildren.push(id, `${id}_lbl`);
});
items.footage = group(footChildren, T(0, 0), { enter: 21, exit: 24.5 });
tw("footage", "transform.opacity", 1, 0, 24.2, 0.3, "easeInQuad");

// the hush before the second drop: three words, one per beat
const NO = [["NO TIMELINE.", DIM, 24.5], ["NO KEYFRAMES.", DIM, 24.83], ["JUST JSON.", CYAN, 25.17]];
NO.forEach(([word, color, at], k) => {
  const id = `no${k}`;
  items[id] = text(word, DISPLAY, 210, color, C(960, 540), {
    align: "center", letterSpacing: 6, enter: at, exit: k === 2 ? 25.5 : NO[k + 1][2],
    ...(k === 2 ? { effects: [{ type: "glow", color: CYAN, radius: 20 }] } : {}),
  });
  scaleTw(id, 1.25, 1, at, 0.3, "easeOutExpo");
});

// ════════════════════════════════════════════════════════════════════════════
// ACT 7 — REVEAL (25.5 → 30): the frame shrinks into a tilted screen that is
// playing *this* video at this very moment — rendered N passes deep, the
// Mandelbrot at the bottom of the recursion.
// ════════════════════════════════════════════════════════════════════════════
items.screen = group(["screenVid", "screenFrame"], C(960, 540), {
  enter: 25.5,
  effects: [{ type: "shadow", color: "#000000c0", blur: 50, offsetX: 0, offsetY: 24 }],
});
items.screenVid = {
  type: "video", asset: "self", width: 1920, height: 1080, start: 25.5, fit: "fill", transform: C(0, 0),
};
items.screenFrame = rect(1920, 1080, null, C(0, 0), { strokeColor: INK, strokeWidth: 10, cornerRadius: 6 });
delete items.screenFrame.fillColor;
tw("screen", "transform.x", 960, 700, 25.5, 1.6, "easeInOutCubic");
tw("screen", "transform.y", 540, 500, 25.5, 1.6, "easeInOutCubic");
scaleTw("screen", 1, 0.58, 25.5, 1.6, { bezier: [0.65, 0, 0.35, 1] });
tw("screen", "transform.rotation", 0, 0.11, 25.5, 1.6, "easeInOutCubic");
tw("screen", "transform.rotation", 0.11, 0.14, 27.1, 2.9, "linear");

const revealKids = ["rvA", "rvB", "rvC", "rvD", "rvE", "rvScreenLbl"];
items.reveal = group(revealKids, T(0, 0), { enter: 25.5 });
items.rvA = text("THIS ENTIRE FILM", DISPLAY, 72, DIM, T(1340, 280, { o: 0 }), { letterSpacing: 4 });
items.rvB = text("IS ONE JSON FILE.", DISPLAY, 128, INK, T(1336, 330, { o: 0 }), {
  maxWidth: 560, lineHeight: 0.9, effects: [{ type: "glow", color: CYAN, radius: 16 }],
});
tw("rvA", "transform.opacity", 0, 1, 26.7, 0.35, "easeOutQuad");
tw("rvB", "transform.opacity", 0, 1, 26.9, 0.35, "easeOutQuad");
tw("rvB", "letterSpacing", 24, 2, 26.9, 0.7, "easeOutExpo");
items.rvC = text("__STATS__", MONO, 26, DIM, T(1340, 620, { o: 0 }), { maxWidth: 540, lineHeight: 1.55 });
tw("rvC", "transform.opacity", 0, 1, 27.4, 0.4, "easeOutQuad");
tw("rvC", "transform.y", 640, 620, 27.4, 0.5, "easeOutCubic");
items.rvScreenLbl = text("↑ this video, playing inside itself", MONO, 24, DIM, C(700, 905, { o: 0 }), { align: "center" });
tw("rvScreenLbl", "transform.opacity", 0, 1, 27.6, 0.4, "easeOutQuad");

// sign-off: the RGB wordmark converges once more
items.rvD = group(["rvDMix"], T(1340, 915, { o: 0 }), { isolate: true });
items.rvDMix = group(["rvDR", "rvDG", "rvDB"], T(0, 0), { blendMode: "lighter" });
const small = (color, x) => text("DAVIDUP", DISPLAY, 120, color, T(x, 0), { letterSpacing: 8 });
items.rvDR = small("#ff1e3c", -24);
items.rvDG = small("#1eff8c", 0);
items.rvDB = small("#1e6bff", 24);
tw("rvD", "transform.opacity", 0, 1, 28.0, 0.25, "easeOutQuad");
tw("rvDR", "transform.x", -24, 0, 28.0, 0.5, "easeOutExpo");
tw("rvDB", "transform.x", 24, 0, 28.0, 0.5, "easeOutExpo");
items.rvE = text("$ npx davidup", MONO, 30, CYAN, T(1344, 985, { o: 0 }));
tw("rvE", "transform.opacity", 0, 1, 28.4, 0.3, "easeOutQuad");

// ════════════════════════════════════════════════════════════════════════════
// HUD — frame counter ($repeat ×900 with enter/exit windows), act captions via
// an inline template, and a timeline bar.
// ════════════════════════════════════════════════════════════════════════════
items.hud = {
  $repeat: { count: 900, as: "i", id: "frame${i}" },
  item: text("frame ${i + 1} / 900", MONO, 22, "#5d6690", T(1856, 62), {
    align: "right", enter: "${i / 30}", exit: "${(i + 1) / 30}",
  }),
};
items.rec = circle(12, "#ff3b4e", C(1588, 55));
tw("rec", "transform.opacity", 1, 0.15, 0, 30, { steps: 30 });
items.timebar = rect(0, 4, CYAN, T(0, 1076, { o: 0.8 }));
tw("timebar", "width", 0, 1920, 0, 30, "linear");

const captionTemplate = {
  id: "actCaption",
  description: "Top-left JSON-ish caption naming the feature on screen.",
  params: [
    { name: "text", type: "string", required: true },
    { name: "dur", type: "number", required: true },
    { name: "color", type: "color", default: CYAN },
  ],
  items: {
    label: text("${params.text}", MONO, 24, "${params.color}", T(80, 70, { o: 0 })),
    tick: rect(4, 26, "${params.color}", T(64, 50, { o: 0 })),
  },
  tweens: [
    { target: "label", property: "transform.opacity", from: 0, to: 1, start: 0, duration: 0.25, easing: "easeOutQuad" },
    { target: "label", property: "letterSpacing", from: 10, to: 0, start: 0, duration: 0.5, easing: "easeOutExpo" },
    { target: "label", property: "transform.opacity", from: 1, to: 0, start: "${params.dur - 0.25}", duration: 0.25, easing: "easeInQuad" },
    { target: "tick", property: "transform.opacity", from: 0, to: 1, start: 0, duration: 0.25, easing: "easeOutQuad" },
    { target: "tick", property: "transform.opacity", from: 1, to: 0, start: "${params.dur - 0.25}", duration: 0.25, easing: "easeInQuad" },
  ],
};
const CAPTIONS = [
  [0.2, 3.3, '"$repeat": 13 × 24 dots  ·  "effects": [{ "type": "blur" }]'],
  [3.7, 2.7, '"isolate": true  ·  "blendMode": "lighter"  ·  { "$behavior": "shake" }'],
  [6.7, 3.2, '"text": maxWidth · lineHeight · letterSpacing · stroke · shadow'],
  [10.2, 3.2, '"effects": [ blur, glow, shadow ]  ·  isolated group compositing'],
  [13.7, 3.2, '"easing": { "bezier": [.7, -.6, .3, 1.6] }  ·  { "steps": 8 }'],
  [17.2, 3.7, '"scenes" + "time": identity | timeScale | loop | reverse | clip'],
  [21.2, 3.2, '"type": "video"  ·  "fit"  ·  masks  ·  "keepAudio": true'],
  [25.7, 4.1, '"composition": { "duration": 30, "fps": 30 }  →  900 frames'],
];
const captionIds = CAPTIONS.map((_, k) => `cap${k}`);
CAPTIONS.forEach(([start, dur, txt], k) => {
  items[`cap${k}`] = { $template: "actCaption", start, params: { text: txt, dur } };
});

// last 0.35 s: fade to black
items.fadeOut = rect(1920, 1080, "#000000", T(0, 0, { o: 0 }), { enter: 29.6 });
tw("fadeOut", "transform.opacity", 0, 1, 29.65, 0.35, "easeInQuad");

// shockwaves + flashes on the two drops
for (const [id, at, color] of [["shock1", 3.5, "#ffffff"], ["shock2", 25.5, CYAN]]) {
  items[id] = circle(200, null, C(960, 540, { s: 0.1 }), {
    strokeColor: color, strokeWidth: 30, enter: at, exit: at + 1,
  });
  scaleTw(id, 0.1, 9, at, 1.0, "easeOutExpo");
  tw(id, "strokeWidth", 30, 0.5, at, 1.0, "easeOutQuad");
  tw(id, "transform.opacity", 1, 0, at, 1.0, "easeInQuad");
  items[`${id}Flash`] = rect(1920, 1080, "#ffffff", T(0, 0, { o: 0 }), { enter: at, exit: at + 0.45 });
  tw(`${id}Flash`, "transform.opacity", 0.8, 0, at, 0.45, "easeOutQuad");
}

// ── assembly ───────────────────────────────────────────────────────────────
// Ticks under the steps(8) lane: one per step, both races.
const ticks = [];
for (const base of [13.9, 15.4]) {
  for (let k = 1; k <= 8; k++) ticks.push(+(base + (k * RACE_DUR) / 8).toFixed(4));
}
const audio = [
  { id: "musicA", asset: "music", start: 0, end: 22, trimIn: 12.62, volume: 1, fadeIn: 0.6, fadeOut: 1.5 },
  { id: "musicB", asset: "music", start: 20.5, end: 30, trimIn: 37.35, volume: 1, fadeIn: 1.5, fadeOut: 1.0 },
  { id: "riser1", asset: "riser", start: 2.3, volume: 0.9 },
  { id: "boom1", asset: "boom", start: 3.5, volume: 1 },
  { id: "riser2", asset: "riser", start: 24.3, volume: 0.9 },
  { id: "boom2", asset: "boom", start: 25.5, volume: 1 },
  ...ticks.map((t, k) => ({ id: `tick${k}`, asset: "tick", start: t, volume: 0.5 })),
];

const composition = {
  $comment:
    "davidup v1.1 showcase — every v1.1 feature in 30 s. Authored JSON: templates, scenes, $repeat, $behavior and expressions all compile down at render. Build: node examples/showcase-v1.1/build.mjs · Render: examples/showcase-v1.1/render.sh",
  version: "0.1",
  composition: {
    width: 1920, height: 1080, fps: 30, duration: 30, background: BG,
    audioMaster: { limiter: true, targetLufs: -14 },
  },
  assets: [
    { id: "font-display", type: "font", src: rel("../fonts/BebasNeue-Regular.ttf"), family: "ShowDisplay" },
    { id: "font-mono", type: "font", src: rel("../fonts/JetBrainsMono-Bold.ttf"), family: "ShowMono" },
    { id: "music", type: "audio", src: rel("assets/music.mp3") },
    { id: "boom", type: "audio", src: rel("assets/boom.wav") },
    { id: "riser", type: "audio", src: rel("assets/riser.wav") },
    { id: "tick", type: "audio", src: rel("assets/tick.wav") },
    { id: "life", type: "video", src: rel("assets/life.mp4"), hasAudio: true },
    { id: "fractal", type: "video", src: rel("assets/mandelbrot.mp4") },
    { id: "self", type: "video", src: rel(selfArg) },
  ],
  templates: { actCaption: captionTemplate },
  scenes: { race: raceScene, orrery },
  layers: [
    { id: "backdrop", z: 0, opacity: 1, blendMode: "normal", items: ["grid", "lifeWrap"], name: "backdrop" },
    {
      id: "acts", z: 10, opacity: 1, blendMode: "normal", name: "acts",
      items: [
        "orb", "formula", "logo", "tagline", "pill", "type", "light",
        "motion", "raceThere", "raceBack", "reverseTag",
        "time", ...MODES.map((_, k) => `orr${k}`),
        "footage", "no0", "no1", "no2", "screen", "reveal",
      ],
    },
    { id: "hud", z: 20, opacity: 1, blendMode: "normal", name: "hud", items: ["hud", "rec", "timebar", ...captionIds] },
    { id: "fx", z: 30, opacity: 1, blendMode: "normal", name: "fx", items: ["shock1", "shock1Flash", "shock2", "shock2Flash", "fadeOut"] },
  ],
  items,
  tweens,
  audio,
};

if (process.env.SHOWCASE_STATS) items.rvC.text = process.env.SHOWCASE_STATS;
const json = JSON.stringify(composition, null, 1);
writeFileSync(outFile, json + "\n");
console.log(`wrote ${outFile} (${(json.length / 1024).toFixed(1)} KB, ${Object.keys(items).length} authored items, ${tweens.length} authored tweens)`);
