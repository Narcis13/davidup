// A davidup composition opened for looking at: read, precompiled, validated, its asset srcs resolved the way
// `davidup render` resolves them, and a renderer that draws any frame through the engine itself
// (renderFrame on skia-canvas, video items from the same frame cache). Runs under bun, so `davidup/*`
// resolves to src/ and what you look at is what the current code renders.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Canvas } from "skia-canvas";
import { precompile } from "davidup/compose";
import { indexTweens, prepareVideoFrames, renderFrame, computeStateAt } from "davidup/engine";
import {
  NodeAssetLoader, assetProjectOf, isAssetSrc, resolveAssetSrcAgainst, resolveLibraryAsset, withBundledAssets,
} from "davidup/assets";
import { validateComposition, timelineMarkers } from "davidup/schema";
import {
  buildVideoFrameProvider, collectVideoExtractSpecs, compositionHasVideo, defaultFrameCacheRoot, preExtractVideoFrames,
} from "davidup/node";
import * as skia from "skia-canvas";

export type Comp = any;

export interface Opened {
  comp: Comp;             // precompiled, srcs absolute
  authored: any;          // the JSON as written
  source: string;         // composition.json
  dir: string;            // the project (its folder)
  project?: string;       // the asset shelf's project, when the folder has one
  errors: any[];
  warnings: any[];
  markers: { t: number; name: string; track?: string }[];
}

// A project folder (its composition.json) or a composition file.
export async function openComposition(input: string): Promise<Opened> {
  const p = resolve(input);
  if (!existsSync(p)) throw new Error(`not found: ${p}`);
  const source = statSync(p).isDirectory() ? join(p, "composition.json") : p;
  if (!existsSync(source)) throw new Error(`${p} has no composition.json (run the build first)`);
  const authored = JSON.parse(readFileSync(source, "utf8"));
  const compiled: Comp = await precompile(authored, { sourcePath: source, readFile: async (f: string) => readFileSync(f, "utf8") });
  const v: any = validateComposition(compiled);
  const dir = dirname(source);
  const project = assetProjectOf(dir);
  const comp = JSON.parse(JSON.stringify(compiled));
  const errors = [...(v.errors ?? [])];
  for (const a of comp.assets ?? []) {
    if (typeof a.src !== "string") continue;
    if (isAssetSrc(a.src)) {
      try { resolveLibraryAsset(a.src, project !== undefined ? { project } : {}); }
      catch (e: any) { errors.push({ code: e.code ?? "E_ASSET_MISSING", path: `assets.${a.id}`, message: e.message }); }
    }
    a.src = resolveAssetSrcAgainst(a.src, dir);
  }
  let markers: Opened["markers"] = [];
  try { markers = timelineMarkers(comp) as any; } catch { markers = comp.composition.markers ?? []; }
  return { comp, authored, source, dir, ...(project !== undefined ? { project } : {}), errors, warnings: v.warnings ?? [], markers };
}

// Items that only cut others out (a mask): kept in any partial pass, or the masked thing draws whole.
const MASK_MODES = new Set(["destination-in", "destination-out", "source-in", "source-out", "destination-atop", "xor"]);

export function parentsOf(comp: Comp): Map<string, string> {
  const up = new Map<string, string>();
  for (const [id, it] of Object.entries<any>(comp.items)) if (it.type === "group") for (const c of it.items ?? []) up.set(c, id);
  return up;
}

export function layerOf(comp: Comp): Map<string, any> {
  const m = new Map<string, any>();
  for (const l of comp.layers ?? []) for (const id of l.items ?? []) m.set(id, l);
  return m;
}

function maskish(comp: Comp, id: string, up: Map<string, string>): boolean {
  for (let cur: string | undefined = id; cur; cur = up.get(cur)) if (MASK_MODES.has(comp.items[cur]?.blendMode)) return true;
  return false;
}

// A copy of the composition with every drawing leaf hidden except `keep` (and masks); groups stay so the
// kept items keep their transforms and effects. `transparent` clears the background.
export function only(comp: Comp, keepIds: Set<string>, { transparent = true, plain = false } = {}): Comp {
  const up = parentsOf(comp), items: Record<string, any> = {};
  // a kept group keeps everything in it
  const keep = new Set<string>(), walk = (id: string) => {
    if (keep.has(id)) return;
    keep.add(id);
    const it = comp.items[id];
    if (it?.type === "group") for (const c of it.items ?? []) walk(c);
  };
  for (const id of keepIds) walk(id);
  for (const [id, it] of Object.entries<any>(comp.items)) {
    // plain: without effects, so a drop shadow or a glow does not count as the thing's own box
    if (it.type === "group" || keep.has(id) || maskish(comp, id, up)) items[id] = plain && it.effects && keep.has(id) ? { ...it, effects: undefined } : it;
    else items[id] = { ...it, visible: false };
  }
  return { ...comp, items, composition: { ...comp.composition, background: transparent ? "transparent" : comp.composition.background } };
}

// A copy with `hide` hidden.
export function without(comp: Comp, hide: Set<string>): Comp {
  const items: Record<string, any> = {};
  for (const [id, it] of Object.entries<any>(comp.items)) items[id] = hide.has(id) ? { ...it, visible: false } : it;
  return { ...comp, items };
}

// What an item looks like at t: visible (lifespan, flags, layer), its opacity through every parent and its
// layer, its scale through every parent (for the size type reads at).
export function itemAt(comp: Comp, scene: any, id: string, up = parentsOf(comp), layers = layerOf(scene)) {
  let opacity = 1, scale = 1, visible = true, top = id;
  for (let cur: string | undefined = id; cur; cur = up.get(cur)) {
    const it = scene.items[cur];
    if (!it) { visible = false; break; }
    if (it.visible === false) visible = false;   // its own flag or its lifespan (computeStateAt sets it)
    opacity *= it.transform?.opacity ?? 1;
    scale *= Math.abs(it.transform?.scaleY ?? 1);
    top = cur;
  }
  const layer = layers.get(top);   // the scene's layers carry their lifespan as `visible`
  if (!layer) visible = false;
  else {
    if (layer.visible === false) visible = false;
    opacity *= layer.opacity ?? 1;
  }
  return { visible, opacity, scale, item: scene.items[id] };
}

export function stateAt(comp: Comp, t: number, index?: any) {
  const s: any = computeStateAt(comp, t, index);
  s.__t = t;
  return s;
}

export class Renderer {
  o: Opened;
  scale: number;
  loader: any;
  video: any;
  index: any;
  warnings: string[] = [];
  W: number;
  H: number;
  constructor(o: Opened, { scale = 1 } = {}) {
    this.o = o;
    this.scale = scale;
    this.W = Math.round(o.comp.composition.width * scale);
    this.H = Math.round(o.comp.composition.height * scale);
  }

  async init() {
    const { comp, project } = this.o;
    this.loader = new NodeAssetLoader({ skiaCanvas: skia as any, ...(project !== undefined ? { project } : {}) });
    await this.loader.preloadAll(withBundledAssets(comp));
    this.index = indexTweens(comp);
    if (compositionHasVideo(comp)) {
      const shelf = project !== undefined ? { project } : {};
      // A clip whose file is not there yet (an accents film before its first render) draws nothing.
      const present = { ...comp, items: Object.fromEntries(Object.entries<any>(comp.items).filter(([, it]) => {
        if (it.type !== "video") return true;
        const a = comp.assets.find((x: any) => x.id === it.asset);
        const ok = a && (isAssetSrc(a.src) || existsSync(a.src));
        if (!ok) this.warnings.push(`video item ${it.name ?? it.asset}: ${a?.src ?? "no asset"} is not there; drawn as nothing`);
        return ok;
      })) };
      try {
        collectVideoExtractSpecs(present, shelf);
        const res = await preExtractVideoFrames(present, { cacheRoot: defaultFrameCacheRoot(), ...shelf });
        this.video = await buildVideoFrameProvider(res, skia as any);
      } catch (e: any) {
        this.warnings.push(`video frames unavailable: ${e.message}`);
      }
    }
    return this;
  }

  // The frame at t, as a canvas W x H (the composition's size times scale). Scratch surfaces are wired as
  // the node driver wires them: without `createOffscreen` the engine cannot isolate a group, so masks,
  // blur, glow and tints would draw differently from the render.
  async frame(t: number, comp: Comp = this.o.comp): Promise<any> {
    const c = new Canvas(this.W, this.H), ctx: any = c.getContext("2d");
    if (this.video) await prepareVideoFrames(comp, t, this.video);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const createOffscreen = (w: number, h: number) => { const off = new Canvas(w, h); return { context: off.getContext("2d"), source: off }; };
    renderFrame(comp, t, ctx, { assets: this.loader, index: this.index, createOffscreen, ...(this.video ? { video: this.video } : {}) } as any);
    return c;
  }
}

export function rgba(canvas: any): Uint8ClampedArray {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
}

// A canvas drawn down to `w` wide.
export function shrink(canvas: any, w: number): any {
  const h = Math.max(2, Math.round((canvas.height / canvas.width) * w));
  const c = new Canvas(w, h);
  c.getContext("2d").drawImage(canvas, 0, 0, w, h);
  return c;
}

// The opaque box of a canvas (alpha over `thr`), in its own pixels, and its opaque pixel count.
export function alphaBox(px: Uint8ClampedArray, w: number, h: number, thr = 32) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > thr) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n } : null;
}

export function parseColor(c: string | undefined): [number, number, number] | null {
  if (!c || typeof c !== "string") return null;
  let m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(",").map((x) => parseFloat(x)); return [p[0], p[1], p[2]]; }
  return null;
}

export const wordsOf = (s: string) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
