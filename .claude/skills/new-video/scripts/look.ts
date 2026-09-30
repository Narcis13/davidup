// look: the agent's eyes on a davidup composition, without encoding a video. Every command writes pictures
// into <project>/.look/ and prints their paths; open them (Read) and say what you see before changing code.
//
//   bun look.ts sheet  <project> [--n 12 | --at 1,2.5,4 | --markers] [--from a --to b] [--cols 4] [--width 480]
//        a contact sheet; tiles that changed since the last sheet at the same times are badged CHANGED and
//        shown before/after in diff.jpg; every sheet is kept in .look/history/ for `progress`
//   bun look.ts frame  <project> --at 2.5[,4]            full-size PNGs, for type and alignment
//   bun look.ts motion <project> --from a --to b [--n 8] a strip and an onion skin of a move
//   bun look.ts rhythm <project> [--fps 10] [--ref <refs/name>] [--full]
//        motion over time with scene changes, markers and beats (and a reference's curve under it)
//   bun look.ts check  <project> [--fps 4] [--safe broadcast|social|none] [--strict]
//        legibility (contrast under each word), size, safe area, reading time, overlaps, crops, still spans,
//        blank frames, validation; an annotated sheet of the frames with findings; exit 1 on an error
//   bun look.ts boxes  <project> --at t [--ids a,b]        the on-screen box of items at t (text by default)
//   bun look.ts accents <project>                          resolve hdf/accents.json targets to boxes (nv build)
//   bun look.ts progress <project> --at t                  the frame nearest t in every kept sheet, oldest first
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Canvas, loadImage } from "skia-canvas";
import {
  openComposition, Renderer, only, without, itemAt, stateAt, parentsOf, rgba, shrink, alphaBox, parseColor, wordsOf,
} from "./lib/comp.ts";
import { sheet, strip, onion, rhythm as rhythmChart, save } from "./lib/draw.mjs";
import { frameStats, motion as motionOf, holds as holdsOf, arc, lumaOf, pixelDiff, relLum, contrast } from "./lib/signal.mjs";

type Flags = Record<string, any>;

function parse(argv: string[]) {
  const pos: string[] = [], flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const nums = (s: any) => String(s).split(",").map(Number).filter((x) => Number.isFinite(x));
const fmt = (t: number) => `${t.toFixed(2)}s`;
const r2 = (x: number) => Math.round(x * 100) / 100;

function lookDir(dir: string) {
  const d = join(dir, ".look");
  mkdirSync(d, { recursive: true });
  return d;
}

function nearestMarker(markers: any[], t: number, tol = 0.2) {
  let best: any = null;
  for (const m of markers) if (Math.abs(m.t - t) <= tol && (!best || Math.abs(m.t - t) < Math.abs(best.t - t))) best = m;
  return best;
}

function sampleTimes(dur: number, flags: Flags, markers: any[]): number[] {
  const fps = 30, end = dur - 1 / fps;
  if (flags.at) return nums(flags.at).map((t) => Math.min(end, Math.max(0, t)));
  if (flags.markers) {
    const ts = [...new Set(markers.map((m) => r2(m.t)))].filter((t) => t >= 0 && t < dur);
    // a beat grid is too many: keep the named moments, else thin to 24
    const named = markers.filter((m) => !/^beat$/i.test(m.name)).map((m) => r2(m.t));
    const pick = named.length ? [...new Set(named)] : ts;
    const step = Math.max(1, Math.ceil(pick.length / 24));
    return pick.filter((_, k) => k % step === 0).map((t) => Math.min(end, t + 0.35));
  }
  const n = Number(flags.n ?? 12), from = Number(flags.from ?? 0), to = Math.min(dur, Number(flags.to ?? dur));
  if (n <= 1) return [(from + to) / 2];
  // centres of n equal slices: never the black first frame, never past the end
  return Array.from({ length: n }, (_, k) => r2(from + ((k + 0.5) * (to - from)) / n));
}

// ---------- sheet ----------

async function cmdSheet(dir: string, flags: Flags) {
  const o = await openComposition(dir), look = lookDir(o.dir), dur = o.comp.composition.duration;
  const r = await new Renderer(o).init();
  const times = sampleTimes(dur, flags, o.markers), width = Number(flags.width ?? 480);
  const last = existsSync(join(look, "last", "sheet.json")) ? JSON.parse(readFileSync(join(look, "last", "sheet.json"), "utf8")) : null;
  const sameTimes = last && last.times.length === times.length && last.times.every((t: number, k: number) => Math.abs(t - times[k]) < 1e-6);
  mkdirSync(join(look, "last"), { recursive: true });
  const tiles: any[] = [], changed: number[] = [], thumbs: string[] = [];
  for (let k = 0; k < times.length; k++) {
    const t = times[k], full = await r.frame(t), small = shrink(full, width);
    const path = join(look, "last", `t${k}.png`), prev = join(look, "last", `t${k}.prev.png`);
    let badge: string | undefined;
    if (sameTimes && existsSync(path)) {
      copyFileSync(path, prev);
      const before = await loadImage(path), bc = new Canvas(small.width, small.height);
      bc.getContext("2d").drawImage(before, 0, 0);
      const d = pixelDiff(lumaOf(rgba(bc), 4), lumaOf(rgba(small), 4));
      if (d > 0.002) { badge = "CHANGED"; changed.push(k); }
    }
    await save(small, path);
    thumbs.push(path);
    const m = nearestMarker(o.markers, t, 0.4);
    tiles.push({ img: small, label: fmt(t), sub: m ? `marker: ${m.name}` : undefined, badge });
  }
  writeFileSync(join(look, "last", "sheet.json"), JSON.stringify({ times, at: new Date().toISOString() }) + "\n");
  // history: every sheet, numbered, with its tiles, for `progress`
  const hist = join(look, "history");
  mkdirSync(hist, { recursive: true });
  const nth = readdirSync(hist).filter((f) => /^\d+$/.test(f)).length + 1, hdir = join(hist, String(nth).padStart(3, "0"));
  mkdirSync(hdir, { recursive: true });
  thumbs.forEach((p, k) => copyFileSync(p, join(hdir, `${times[k].toFixed(2)}.png`)));
  const out = join(look, "sheet.jpg");
  const sub = `${o.comp.composition.width}x${o.comp.composition.height} · ${dur}s · ${times.length} frames`
    + (sameTimes ? ` · ${changed.length} changed since the last sheet` : last ? " · new times, no comparison" : "")
    + (o.errors.length ? ` · ${o.errors.length} VALIDATION ERRORS` : "");
  await sheet(tiles, { cols: Number(flags.cols ?? 4), tileW: width, title: `${basename(o.dir)}: sheet #${nth}`, sub, out });
  copyFileSync(out, join(hdir, "sheet.jpg"));
  const lines = [out];
  if (sameTimes && changed.length) {
    const pairs: any[] = [];
    for (const k of changed) {
      pairs.push({ img: join(look, "last", `t${k}.prev.png`), label: `${fmt(times[k])} before`, dim: false });
      pairs.push({ img: join(look, "last", `t${k}.png`), label: `${fmt(times[k])} after`, badge: "NOW" , badgeColor: "#3de8ff" });
    }
    const d = join(look, "diff.jpg");
    await sheet(pairs, { cols: 4, tileW: Math.min(width, 420), title: `${basename(o.dir)}: what changed since the last sheet`, sub: `${changed.length} of ${times.length} frames`, out: d });
    lines.push(d);
  }
  for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
  for (const e of o.errors) process.stderr.write(`error: ${e.code} ${e.path ?? ""} ${e.message}\n`);
  process.stdout.write(lines.join("\n") + "\n");
  if (sameTimes) process.stdout.write(changed.length ? `changed: ${changed.map((k) => fmt(times[k])).join(", ")}\n` : "nothing changed at these times\n");
}

// ---------- frame ----------

async function cmdFrame(dir: string, flags: Flags) {
  const o = await openComposition(dir), look = lookDir(o.dir);
  const r = await new Renderer(o).init();
  const at = flags.at ? nums(flags.at) : [o.comp.composition.duration / 2];
  // --hide a,b draws the frame without those items; --only a,b with nothing else (groups keep their children;
  // a layer id stands for its items): to find what paints a patch
  const expand = (ids: string[]) => ids.flatMap((id) => o.comp.layers.find((l: any) => l.id === id)?.items ?? [id]);
  const hide = flags.hide ? new Set(expand(String(flags.hide).split(","))) : null;
  const keep = flags.only ? new Set(expand(String(flags.only).split(","))) : null;
  const comp = keep ? only(o.comp, keep, { transparent: false }) : hide ? without(o.comp, hide) : o.comp;
  const tag = keep ? `-only-${flags.only}` : hide ? `-hide-${flags.hide}` : "";
  for (const t of at) {
    const out = join(look, `frame-${t.toFixed(2)}${tag.replace(/[^a-z0-9,._-]/gi, "")}.png`);
    await save(await r.frame(t, comp), out);
    process.stdout.write(`${out}\n`);
  }
}

// ---------- motion ----------

async function cmdMotion(dir: string, flags: Flags) {
  const o = await openComposition(dir), look = lookDir(o.dir), dur = o.comp.composition.duration;
  const from = Number(flags.from ?? 0), to = Math.min(dur - 1e-3, Number(flags.to ?? Math.min(dur, from + 1))), n = Number(flags.n ?? 8);
  if (!(to > from)) throw new Error("motion wants --from < --to");
  const r = await new Renderer(o).init();
  const times = Array.from({ length: n }, (_, k) => from + (k * (to - from)) / Math.max(1, n - 1));
  const frames: any[] = [];
  for (const t of times) frames.push(shrink(await r.frame(t), 960));
  const tag = `${from}-${to}`, s = join(look, `motion-${tag}-strip.jpg`), on = join(look, `motion-${tag}-onion.jpg`);
  const sub = `${n} frames, ${fmt(from)} to ${fmt(to)}, ${((to - from) / Math.max(1, n - 1) * 1000).toFixed(0)} ms apart`;
  await strip(frames, times.map(fmt), { cols: Math.min(4, n), tileW: 420, title: `${basename(o.dir)}: motion ${tag}s`, sub, out: s });
  await onion(frames, { title: `${basename(o.dir)}: onion skin ${tag}s (faint = earlier, solid = later)`, sub, out: on });
  process.stdout.write(`${s}\n${on}\n`);
}

// ---------- rhythm ----------

async function analyse(o: any, { fps = 10, full = false } = {}) {
  const dur = o.comp.composition.duration, n = Math.max(2, Math.floor(dur * fps));
  const r = await new Renderer(o, { scale: full ? 1 : 0.25 }).init();
  const stats: any[] = [], thumbs: any[] = [], every = Math.max(1, Math.round(n / 16));
  let w = 160, h = 90;
  for (let i = 0; i < n; i++) {
    const t = i / fps, fr = await r.frame(t), small = shrink(fr, 160);
    w = small.width; h = small.height;
    stats.push(frameStats(rgba(small), w, h, 4));
    if (i % every === Math.floor(every / 2) && thumbs.length < 16) thumbs.push({ t, img: shrink(fr, 240) });
  }
  const mo = motionOf(stats, fps, { w, h });
  return { dur, fps, stats, mo, thumbs, holds: holdsOf(mo.energy, fps), brightness: stats.map((s: any) => s.mean), warnings: r.warnings };
}

async function cmdRhythm(dir: string, flags: Flags) {
  const o = await openComposition(dir), look = lookDir(o.dir);
  const fps = Number(flags.fps ?? 10);
  const A = await analyse(o, { fps, full: !!flags.full });
  let ref: any;
  if (flags.ref) {
    const p = resolve(String(flags.ref)), f = p.endsWith(".json") ? p : join(p, "decomposition.json");
    const R = JSON.parse(readFileSync(f, "utf8"));
    ref = { energy: R.series.energy, fps: R.series.fps, duration: R.duration, cuts: R.cuts, label: R.name, R };
  }
  const beats = o.markers.filter((m: any) => /beat/i.test(m.name)).map((m: any) => m.t);
  const named = o.markers.filter((m: any) => !/^beat$/i.test(m.name));
  const out = join(look, "rhythm.png");
  const changes = A.mo.changes, shots = changes.length + 1, asl = r2(A.dur / shots);
  const onMarker = named.length ? changes.filter((c: number) => named.some((m: any) => Math.abs(m.t - c) <= 0.15)).length : 0;
  const onBeat = beats.length ? changes.filter((c: number) => beats.some((b: number) => Math.abs(b - c) <= 0.1)).length : 0;
  const sub = `${A.dur}s · ${shots} shots, average ${asl}s · ${changes.length} scene changes`
    + (named.length ? ` · ${onMarker}/${changes.length} within 0.15s of a marker` : "")
    + (beats.length ? ` · ${onBeat}/${changes.length} on a beat` : "")
    + (ref ? ` · reference ${ref.R.pacing.count} shots, average ${ref.R.pacing.averageShot}s` : "")
    + (flags.full ? "" : " · drawn at 1/4 size (--full for exact effects)");
  await rhythmChart({
    duration: A.dur, fps, energy: A.mo.energy, brightness: A.brightness, cuts: A.mo.cuts, changes, beats, markers: named,
    thumbs: A.thumbs, ref, holds: A.holds, title: `${basename(o.dir)}: rhythm`, sub, out,
  });
  const a = arc(A.mo.energy);
  const lines = [
    out,
    `scene changes at: ${changes.map((c: number) => c.toFixed(2)).join(", ") || "none"}`,
    `motion by fifths (% of busiest): ${a.norm.map((v: number) => Math.round(v * 100)).join(" / ")}; it ${a.words}`,
    `still spans (nothing moves 1.5 s+): ${A.holds.length ? A.holds.map((x: any) => `${x.t0.toFixed(2)}s for ${x.dur.toFixed(2)}s`).join(", ") : "none"}`,
  ];
  if (named.length) {
    const lonely = named.filter((m: any) => m.t >= 0.2 && !changes.some((c: number) => Math.abs(m.t - c) <= 0.15) && !A.mo.energy.some((e: number, i: number) => Math.abs(i / fps - m.t) <= 0.15 && e > 0.01));
    if (lonely.length) lines.push(`markers with nothing happening on them: ${lonely.map((m: any) => `${m.name}@${m.t}`).join(", ")}`);
  }
  if (ref) {
    const ra = ref.R.energy.arc.norm.map((v: number) => Math.round(v * 100)).join(" / ");
    lines.push(`reference motion by fifths: ${ra}; average shot ${ref.R.pacing.averageShot}s against ${asl}s here`);
  }
  for (const w of A.warnings) process.stderr.write(`warning: ${w}\n`);
  process.stdout.write(lines.join("\n") + "\n");
  writeFileSync(join(look, "rhythm.json"), JSON.stringify({ changes, cuts: A.mo.cuts, holds: A.holds, arc: a, fps, energy: Array.from(A.mo.energy, (v: number) => +v.toFixed(4)) }) + "\n");
}

// ---------- boxes ----------

// The on-screen box of each id at t, from what it paints alone (alpha), in composition pixels.
async function boxesAt(o: any, r: any, t: number, ids: string[], { plain = true } = {}) {
  const out: Record<string, any> = {};
  for (const id of ids) {
    const c = await r.frame(t, only(o.comp, new Set([id]), { plain }));
    const b = alphaBox(rgba(c), c.width, c.height);
    out[id] = b ? [Math.round(b.x / r.scale), Math.round(b.y / r.scale), Math.round(b.w / r.scale), Math.round(b.h / r.scale)] : null;
  }
  return out;
}

async function cmdBoxes(dir: string, flags: Flags) {
  const o = await openComposition(dir), look = lookDir(o.dir);
  const t = Number(flags.at ?? 0), r = await new Renderer(o).init();
  const ids = flags.ids ? String(flags.ids).split(",") : Object.entries<any>(o.comp.items).filter(([, it]) => it.type === "text").map(([id]) => id);
  const scene = stateAt(o.comp, t, r.index), up = parentsOf(o.comp);
  const vis = ids.filter((id) => { const s = itemAt(o.comp, scene, id, up); return s.visible && s.opacity > 0.02; });
  const boxes = await boxesAt(o, r, t, vis);
  writeFileSync(join(look, `boxes-${t.toFixed(2)}.json`), JSON.stringify(boxes, null, 1) + "\n");
  for (const [id, b] of Object.entries(boxes)) process.stdout.write(`${id}\t${b ? `[${b.join(", ")}]` : "draws nothing"}\t${o.comp.items[id]?.text ? JSON.stringify(o.comp.items[id].text).slice(0, 50) : ""}\n`);
  if (!vis.length) process.stdout.write(`nothing of ${ids.join(", ")} is visible at ${t}s\n`);
}

// hdf/accents.json: [{ kind, of?: id, box?: [x,y,w,h], to?: id|[x,y]|box, at, boxAt?, ... }] -> the same with
// `box` (and `toBox`) filled in from what `of` (and `to`) paints at `boxAt ?? at`.
async function cmdAccents(dir: string) {
  const o = await openComposition(dir);
  const spec = join(o.dir, "hdf", "accents.json");
  if (!existsSync(spec)) { process.stdout.write("no hdf/accents.json\n"); return; }
  const S = JSON.parse(readFileSync(spec, "utf8"));
  const r = await new Renderer(o).init();
  for (const a of S.marks) {
    const t = a.boxAt ?? a.at;
    for (const [key, dest] of [["of", "box"], ["to", "toBox"]] as const) {
      const ref = a[key];
      if (typeof ref !== "string") continue;
      if (!o.comp.items[ref]) throw new Error(`accent ${a.kind} at ${a.at}s: no item '${ref}' in the composition`);
      let b = (await boxesAt(o, r, t, [ref]))[ref];
      if (!b) throw new Error(`accent ${a.kind} at ${a.at}s: '${ref}' draws nothing at ${t}s (set boxAt to a time it is on screen)`);
      // grow (around the centre) and nudge [dx, dy] adjust what the mark hugs
      const g = key === "of" ? (a.grow ?? 1) : 1, [dx, dy] = key === "of" ? (a.nudge ?? [0, 0]) : [0, 0];
      if (g !== 1 || dx || dy) b = [Math.round(b[0] + (b[2] * (1 - g)) / 2 + dx), Math.round(b[1] + (b[3] * (1 - g)) / 2 + dy), Math.round(b[2] * g), Math.round(b[3] * g)];
      a[dest] = b;
    }
  }
  const out = join(o.dir, "hdf", "accents.resolved.json");
  writeFileSync(out, JSON.stringify(S, null, 1) + "\n");
  process.stdout.write(`${out}\n`);
}

// ---------- check ----------

const SAFE: Record<string, (W: number, H: number) => [number, number, number, number]> = {
  broadcast: (W, H) => [W * 0.05, H * 0.05, W * 0.9, H * 0.9],
  social: (W, H) => [W * 0.06, H * 0.12, W * 0.88, H * 0.66],   // 9:16 feeds: caption and buttons cover the bottom fifth
  none: (W, H) => [0, 0, W, H],
};

async function cmdCheck(dir: string, flags: Flags) {
  const o = await openComposition(dir), look = lookDir(o.dir), comp = o.comp;
  const { width: W, height: H, duration: dur } = comp.composition;
  const fps = Number(flags.fps ?? 4), scale = Number(flags.scale ?? 0.5);
  const vertical = H > W, safeName = String(flags.safe ?? (vertical ? "social" : "broadcast"));
  const safe = (SAFE[safeName] ?? SAFE.broadcast)(W, H);
  const minPx = vertical ? W * 0.037 : Math.min(W, H) * 0.026;
  const r = await new Renderer(o, { scale }).init();
  const up = parentsOf(comp);
  const texts = Object.entries<any>(comp.items).filter(([, it]) => it.type === "text").map(([id]) => id);
  const findings: any[] = [];
  const add = (level: string, rule: string, t: number | null, id: string | null, detail: string, box?: number[]) =>
    findings.push({ level, rule, t, id, detail, box });
  for (const e of o.errors) add("error", "validate", null, null, `${e.code} ${e.path ?? ""}: ${e.message}`);
  for (const w of o.warnings) add("warning", "validate", null, null, `${w.code} ${w.path ?? ""}: ${w.message}`);

  const n = Math.max(1, Math.floor(dur * fps));
  const per: Record<string, { readable: number; samples: any[] }> = {};
  const stats: any[] = [];
  let sw = 160, sh = 90;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / fps;
    const scene = stateAt(comp, t, r.index);
    const vis = texts.filter((id) => { const s = itemAt(comp, scene, id, up); return s.visible && s.opacity > 0.05; });
    const full = await r.frame(t), fsmall = shrink(full, 160);
    sw = fsmall.width; sh = fsmall.height;
    stats.push({ t, ...frameStats(rgba(fsmall), sw, sh, 4) });
    if (!vis.length) continue;
    const bg = rgba(await r.frame(t, without(comp, new Set(texts))));
    const boxes: Record<string, any> = {};
    for (const id of vis) {
      const it = scene.items[id], st = itemAt(comp, scene, id, up);
      const c = await r.frame(t, only(comp, new Set([id]))), px = rgba(c), Wc = c.width, Hc = c.height;
      const b = alphaBox(px, Wc, Hc, 128);
      if (!b || b.n < 12) continue;
      const box = [b.x / scale, b.y / scale, b.w / scale, b.h / scale];
      boxes[id] = box;
      // contrast under the glyphs: the fill's own pixels against the background at the same place
      const fill = parseColor(it.color), fillA = parseColor(it.color) && !/^#[0-9a-f]{6}00$/i.test(it.color ?? "") ? fill : parseColor(it.strokeColor);
      const cs: number[] = [];
      for (let p = 0; p < Wc * Hc; p++) {
        const a = px[p * 4 + 3];
        if (a < 200) continue;
        const tr = px[p * 4], tg = px[p * 4 + 1], tb = px[p * 4 + 2];
        if (fillA && Math.abs(tr - fillA[0]) + Math.abs(tg - fillA[1]) + Math.abs(tb - fillA[2]) > 90) continue;
        cs.push(contrast([tr, tg, tb], [bg[p * 4], bg[p * 4 + 1], bg[p * 4 + 2]]));
      }
      if (cs.length < 8) continue;
      cs.sort((x, y) => x - y);
      const med = cs[cs.length >> 1], low = cs.filter((x) => x < 2).length / cs.length;
      const px_ = (it.fontSize ?? 0) * st.scale;
      const big = px_ >= Math.min(W, H) * 0.045;
      const need = big ? 3 : 4.5, helped = (it.strokeWidth ?? 0) > 0 || !!it.shadow || (it.effects ?? []).some((e: any) => e.type === "shadow" || e.type === "glow");
      const settled = st.opacity >= 0.6;
      const inFrame = box[0] >= -2 && box[1] >= -2 && box[0] + box[2] <= W + 2 && box[1] + box[3] <= H + 2;
      const ok = med >= need * (helped ? 0.8 : 1) && low < 0.3;
      per[id] ??= { readable: 0, samples: [] };
      if (settled && inFrame && ok) per[id].readable += 1 / fps;
      per[id].samples.push({ t, med, low, box, settled, inFrame, px: px_, big, helped, need });
    }
    // overlaps between different words on screen together
    const ids = Object.keys(boxes);
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const A = boxes[ids[a]], B = boxes[ids[b]];
      if (comp.items[ids[a]].text === comp.items[ids[b]].text) continue;
      const ix = Math.max(0, Math.min(A[0] + A[2], B[0] + B[2]) - Math.max(A[0], B[0])), iy = Math.max(0, Math.min(A[1] + A[3], B[1] + B[3]) - Math.max(A[1], B[1]));
      const inter = ix * iy, small = Math.min(A[2] * A[3], B[2] * B[3]);
      if (small > 0 && inter / small > 0.15) {
        const sa = per[ids[a]]?.samples.at(-1), sb = per[ids[b]]?.samples.at(-1);
        if (sa?.settled && sb?.settled) add("warning", "overlap", t, `${ids[a]}+${ids[b]}`, `"${String(comp.items[ids[a]].text).slice(0, 24)}" and "${String(comp.items[ids[b]].text).slice(0, 24)}" cross (${Math.round((inter / small) * 100)}% of the smaller)`, [Math.max(A[0], B[0]), Math.max(A[1], B[1]), ix, iy]);
      }
    }
  }
  // per text item: each rule once, on what lasts (a flash that whites out a title for a beat is a choice)
  const family = (id: string) => id.replace(/(__r\d+|_?\d+)+$/, "");
  const famSize = new Map<string, number>();
  for (const id of Object.keys(per)) famSize.set(family(id), (famSize.get(family(id)) ?? 0) + 1);
  for (const [id, P] of Object.entries(per)) {
    const it = comp.items[id], words = wordsOf(it.text), label = `"${String(it.text).replace(/\s+/g, " ").slice(0, 32)}"`;
    const settled = P.samples.filter((s) => s.settled), shown = settled.filter((s) => s.inFrame);
    const bad = shown.filter((s) => s.med < s.need * (s.helped ? 0.8 : 1) || s.low >= 0.3);
    if (bad.length / fps >= 0.5 && bad.length >= 0.25 * shown.length) {
      const worst = [...bad].sort((a, b) => a.med - b.med)[0], meds = bad.map((s) => s.med).sort((a, b) => a - b), med = meds[meds.length >> 1];
      const lvl = med < 2 && bad.length / fps >= 1 ? "error" : "warning";
      const why = med < worst.need * (worst.helped ? 0.8 : 1)
        ? `reads at ${med.toFixed(1)}:1 on what is behind it for ${(bad.length / fps).toFixed(1)}s (needs ${worst.need}:1${worst.helped ? ", less with its stroke/shadow/glow" : ""})`
        : `has ${Math.round(worst.low * 100)}% of its letters on a background under 2:1 (a busy or matching patch) for ${(bad.length / fps).toFixed(1)}s`;
      add(lvl, "contrast", worst.t, id, `${label} ${why}`, worst.box);
    }
    const tiny = settled.filter((s) => s.px > 0 && s.px < minPx);
    if (tiny.length / fps >= 0.5 || (tiny.length && tiny.length === settled.length)) {
      const s = tiny[0];
      add(s.px < minPx * 0.7 ? "error" : "warning", "size", s.t, id, `${label} is ${Math.round(s.px)} px (fontSize x scale); under ${Math.round(minPx)} px it will not read on a ${vertical ? "phone" : "small screen"}`, s.box);
    }
    const outSafe = settled.filter((s) => s.box[0] < safe[0] - 1 || s.box[1] < safe[1] - 1 || s.box[0] + s.box[2] > safe[0] + safe[2] + 1 || s.box[1] + s.box[3] > safe[1] + safe[3] + 1);
    if (outSafe.length / fps >= 0.5 && safeName !== "none") add("warning", "safe-area", outSafe[0].t, id, `${label} sits outside the ${safeName} safe area for ${(outSafe.length / fps).toFixed(1)}s`, outSafe[0].box);
    const cropped = settled.filter((s) => !s.inFrame);
    if (cropped.length / fps >= 0.5) add("warning", "cropped", cropped[0].t, id, `${label} is cut by the frame edge for ${(cropped.length / fps).toFixed(1)}s`, cropped[0].box);
    const need = words <= 2 ? 0.3 : 0.2 + 0.28 * words;
    const flicker = P.samples.length / fps < 0.3 && (famSize.get(family(id)) ?? 1) >= 5;   // a counter's digits, one frame each
    if (!flicker && P.readable + 1e-9 < need) {
      const s = settled[0] ?? P.samples[0];
      add("warning", "reading-time", s?.t ?? null, id, `${label} (${words} word${words === 1 ? "" : "s"}) is readable for ${P.readable.toFixed(2)}s; it needs ~${need.toFixed(1)}s`, s?.box);
    }
  }
  // many items of one family ($repeat products) with the same finding are one finding
  {
    const seen = new Map<string, any>(), kept: any[] = [];
    for (const f of findings) {
      if (!f.id || f.id.includes("+")) { kept.push(f); continue; }
      const key = `${f.level}|${f.rule}|${family(f.id)}`;
      const first = seen.get(key);
      if (first && (famSize.get(family(f.id)) ?? 1) > 1) { first.more = (first.more ?? 0) + 1; continue; }
      seen.set(key, f);
      kept.push(f);
    }
    for (const f of kept) if (f.more) { f.detail += ` (and ${f.more} more of ${family(f.id)}*)`; f.id = `${family(f.id)}*`; }
    findings.length = 0;
    findings.push(...kept);
  }
  // pictures that stand still, frames that are blank
  const mo = motionOf(stats, fps, { w: sw, h: sh });
  for (const h of holdsOf(mo.energy, fps, { min: 1.75 })) {
    const atEnd = h.t0 + h.dur >= dur - 0.3;
    add(atEnd && h.dur <= 3 ? "note" : "warning", "still", h.t0 + h.dur / 2, null, `nothing moves from ${h.t0.toFixed(2)}s for ${h.dur.toFixed(2)}s${atEnd ? " (the end hold)" : ": add a drift, a push-in or cut sooner"}`);
  }
  // a flat frame for one sample is a wipe or a flash covering a cut; for half a second it is a hole
  for (let i = 0, run = 0; i < stats.length; i++) {
    const flat = stats[i].std < 0.012 && stats[i].t > 0.3 && stats[i].t < dur - 0.3;
    run = flat ? run + 1 : 0;
    if (run / fps >= 0.5) { add("warning", "blank", stats[i - run + 1].t, null, `the frame is one flat colour from ${stats[i - run + 1].t.toFixed(2)}s (mean luma ${stats[i].mean.toFixed(2)})`); break; }
  }
  // the report
  const order: Record<string, number> = { error: 0, warning: 1, note: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level] || (a.t ?? -1) - (b.t ?? -1));
  const errs = findings.filter((f) => f.level === "error").length, warns = findings.filter((f) => f.level === "warning").length;
  writeFileSync(join(look, "check.json"), JSON.stringify({ at: new Date().toISOString(), safe: safeName, minPx: Math.round(minPx), findings }, null, 1) + "\n");
  const MAXL = Number(flags.max ?? 40);
  const lines = findings.slice(0, MAXL).map((f) => `${f.level.padEnd(7)} ${f.rule.padEnd(12)} ${f.t !== null ? fmt(f.t).padStart(7) : "      -"}  ${f.id ?? ""}${f.id ? "  " : ""}${f.detail}`);
  if (findings.length > MAXL) lines.push(`... ${findings.length - MAXL} more in .look/check.json`);
  const tally: Record<string, number> = {};
  for (const f of findings) tally[`${f.level} ${f.rule}`] = (tally[`${f.level} ${f.rule}`] ?? 0) + 1;
  lines.push(`by rule: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing"}`);
  // the annotated sheet: frames with findings, their boxes drawn
  const byT = new Map<number, any[]>();
  for (const f of findings) if (f.t !== null && f.level !== "note") { const k = r2(f.t); if (!byT.has(k)) byT.set(k, []); byT.get(k)!.push(f); }
  const ts = [...byT.keys()].sort((a, b) => a - b).slice(0, 12);
  if (ts.length) {
    const fr = await new Renderer(o).init(), tiles: any[] = [];
    for (const t of ts) {
      const c = shrink(await fr.frame(t), 640), k = 640 / W;
      const fs = byT.get(t)!;
      tiles.push({
        img: c, label: `${fmt(t)}  ${fs.map((f) => f.rule).join(", ")}`, sub: fs[0].detail,
        boxes: [
          { x: safe[0] * k, y: safe[1] * k, w: safe[2] * k, h: safe[3] * k, color: "rgba(255,194,61,0.5)" },
          ...fs.filter((f) => f.box).map((f) => ({ x: f.box[0] * k, y: f.box[1] * k, w: f.box[2] * k, h: f.box[3] * k, label: f.rule, color: f.level === "error" ? "#ff4d5e" : "#ffc23d" })),
        ],
      });
    }
    const out = join(look, "check.jpg");
    await sheet(tiles, { cols: 3, tileW: 640, title: `${basename(o.dir)}: check — ${errs} errors, ${warns} warnings`, sub: `boxes: red error, amber warning; the thin amber frame is the ${safeName} safe area`, out });
    lines.unshift(out);
  }
  lines.push(`${errs} errors, ${warns} warnings, ${findings.length - errs - warns} notes (sampled ${n} frames at ${fps}/s; ${Object.keys(per).length} of ${texts.length} text items measured on screen)`);
  for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
  process.stdout.write(lines.join("\n") + "\n");
  return errs > 0 || (flags.strict && warns > 0) ? 1 : 0;
}

// ---------- progress ----------

async function cmdProgress(dir: string, flags: Flags) {
  const look = lookDir(resolve(dir)), hist = join(look, "history"), t = Number(flags.at ?? 0);
  if (!existsSync(hist)) throw new Error("no sheets yet: run `sheet` first");
  const runs = readdirSync(hist).filter((f) => /^\d+$/.test(f)).sort();
  const tiles: any[] = [];
  for (const run of runs) {
    const files = readdirSync(join(hist, run)).filter((f) => f.endsWith(".png"));
    if (!files.length) continue;
    const best = files.map((f) => ({ f, d: Math.abs(parseFloat(f) - t) })).sort((a, b) => a.d - b.d)[0];
    tiles.push({ img: join(hist, run, best.f), label: `sheet #${Number(run)}`, sub: `at ${parseFloat(best.f).toFixed(2)}s` });
  }
  const out = join(look, `progress-${t.toFixed(2)}.jpg`);
  await sheet(tiles, { cols: Math.min(5, tiles.length), tileW: 360, title: `${basename(resolve(dir))}: the frame near ${fmt(t)} across ${tiles.length} sheets`, out });
  process.stdout.write(`${out}\n`);
}

// ---------- main ----------

const USAGE = `usage: bun look.ts <sheet|frame|motion|rhythm|check|boxes|accents|progress> <project|composition.json> [flags]`;

export async function main(argv: string[]) {
  const { pos, flags } = parse(argv);
  const [cmd, dir] = pos;
  if (!cmd || !dir) { process.stderr.write(USAGE + "\n"); return 2; }
  switch (cmd) {
    case "sheet": await cmdSheet(dir, flags); return 0;
    case "frame": await cmdFrame(dir, flags); return 0;
    case "motion": await cmdMotion(dir, flags); return 0;
    case "rhythm": await cmdRhythm(dir, flags); return 0;
    case "check": return await cmdCheck(dir, flags);
    case "boxes": await cmdBoxes(dir, flags); return 0;
    case "accents": await cmdAccents(dir); return 0;
    case "progress": await cmdProgress(dir, flags); return 0;
    default: process.stderr.write(USAGE + "\n"); return 2;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
    process.stderr.write(`look: ${process.env.NV_DEBUG ? e?.stack ?? e : e?.message ?? e}\n`);
    process.exit(1);
  });
}
