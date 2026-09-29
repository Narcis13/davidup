// handdrawn from davidup (hand-drawn film 3.0 S16, 4.0 D1–D5): the calls into
// the `hdf` command line that the bridge scripts (scripts/hdf-bridge.ts) and
// the `render_hdf_clip` MCP tool share.
//
// hdf is a node program (skia-canvas, worker threads, ffmpeg), so it always
// runs as a subprocess, never inside the server. Its files land in
// `handdrawn/out/`; callers put what they register in the asset library
// ({@link putDerived}: a record that says how it was made, asset-library plan
// D4) and register it by its `asset:<id>@<sha12>` src. The package lives beside
// src/ in the repo (`../../handdrawn` from this module, from src/ or dist/
// alike), or wherever `DAVIDUP_HDF_ROOT` points. An install without it (the
// npm package does not ship handdrawn/) gets `null` from `hdfRoot()`.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assetSrc, defaultProbes, type AssetRecord, type Library, type Probes } from "../../assetlib/index.js";
import type { Marker, SpriteSheet } from "../schema/types.js";
import { ASSET_LICENCES, type AssetLicence } from "../schema/zod.js";
import { resolveFfmpeg } from "../drivers/node/ffmpeg.js";

export class HdfError extends Error {}

/** The handdrawn package: `DAVIDUP_HDF_ROOT`, else `handdrawn/` beside src/; null when neither has `cli/hdf.mjs`. */
export function hdfRoot(): string | null {
  const env = process.env.DAVIDUP_HDF_ROOT;
  const root = env && env.length > 0 ? resolve(env) : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "handdrawn");
  return existsSync(join(root, "cli", "hdf.mjs")) ? root : null;
}

function requireRoot(): string {
  const root = hdfRoot();
  if (!root) throw new HdfError("the handdrawn package is not here (set DAVIDUP_HDF_ROOT to its directory)");
  return root;
}

/** Where hdf writes its files. */
export const hdfOut = (root = requireRoot()) => join(root, "out");

/** A value safe as a file name and an asset id: `paperInk~hand:test` → `paperInk-hand-test`. */
export const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

/** The name a film goes by in a composition (`hdf:<name>`, RE-13): its module's basename without `.js`. */
export const filmName = (ref: string) => basename(ref).replace(/\.js$/, "");

/** True for a film named rather than pathed: `mini`, `sam-moon.js`. */
export const isFilmName = (ref: string) => /^[A-Za-z0-9._-]+$/.test(ref) && !ref.startsWith(".");

/**
 * A film by name (RE-13): `handdrawn/films/<name>.js`, then `<dir>/<name>.js` for each of `near` (the
 * composition's folder), then `handdrawn/work/<name>/<name>.js`. null when none of them is a file.
 */
export function findFilm(name: string, near: string[] = [], root = requireRoot()): string | null {
  const file = `${filmName(name)}.js`;
  const tries = [join(root, "films", file), ...near.map((d) => join(d, file)), join(root, "work", filmName(name), file)];
  return tries.find((f) => existsSync(f)) ?? null;
}

/** A film path as given, or a name found by {@link findFilm} (`near`: the composition's folder). */
export function filmPath(ref: string, cwd = process.cwd(), near: string[] = []): string {
  const direct = resolve(cwd, ref);
  if (existsSync(direct)) return direct;
  const named = isFilmName(ref) ? findFilm(ref, near) : null;
  if (named) return named;
  throw new HdfError(`no film '${ref}' (neither ${direct} nor ${isFilmName(ref) ? `${filmName(ref)}.js in handdrawn/films, ${near.length ? `${near.join(", ")} or ` : ""}handdrawn/work/${filmName(ref)}/` : "a name"})`);
}

/**
 * What handdrawn's store says of an entry (RE-14): its `credit` (when it has one) and `licence`, for the
 * davidup asset made from it. `house`, the package's own hand, is `own`. Empty for a name the store does not
 * hold (a cast member a film module defines, say).
 */
export function storeCredit(id: string, root = hdfRoot()): { credit?: string; licence?: AssetLicence } {
  if (id === "house") return { licence: "own" };
  if (!root) return {};
  let e: { credit?: unknown; licence?: unknown } | undefined;
  try {
    e = (JSON.parse(readFileSync(join(root, "assets", "catalogue.json"), "utf8")) as Record<string, typeof e>)[id];
  } catch { return {}; }
  if (!e) return {};
  const licence = (ASSET_LICENCES as readonly unknown[]).includes(e.licence) ? (e.licence as AssetLicence) : undefined;
  return {
    ...(typeof e.credit === "string" && e.credit.trim() ? { credit: e.credit.trim() } : {}),
    ...(licence ? { licence } : {}),
  };
}

/** Runs `hdf <args>` under node in the package directory; resolves to its stdout. */
export function hdf(args: string[]): Promise<string> {
  const root = requireRoot();
  return new Promise((res, rej) => {
    // Under bun, process.execPath is bun: hdf needs node (skia-canvas, worker threads).
    const p = spawn(process.env.NODE ?? "node", [join(root, "cli", "hdf.mjs"), ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    p.stdout.on("data", (c) => { out += c; });
    // Passed through (a script's terminal, the MCP server's log), and its tail kept for the error.
    p.stderr.on("data", (c) => { err = (err + c).slice(-4096); process.stderr.write(c); });
    p.on("error", (e) => rej(new HdfError(`could not run hdf (${(e as Error).message}); is node on PATH?`)));
    p.on("close", (code) => {
      if (code === 0) return res(out);
      const why = err.trim().split("\n").filter(Boolean).slice(-3).join("; ");
      rej(new HdfError(`hdf ${args[0]} exited with code ${code}${why ? `: ${why}` : ""}`));
    });
  });
}

/** The last file a command printed with this extension (hdf prints `<path>  <what>` lines). */
export function printed(out: string, ext: string): string {
  const files = out.split("\n").map((l) => l.trim().split(/\s+/)[0] ?? "").filter((f) => f.endsWith(ext));
  const last = files.at(-1);
  if (!last) throw new HdfError(`hdf printed no ${ext} file:\n${out}`);
  return last;
}

export type AlphaCodec = "mov" | "webm";

/** The formats hdf renders (handdrawn/core/fit.js FORMATS). */
export const HDF_ASPECTS = ["1:1", "16:9", "9:16"] as const;
export type HdfAspect = (typeof HDF_ASPECTS)[number];

/**
 * Where a film's marks come from (4.0 D4): `hdf ... --cues-from <composition.json> --at <item|seconds>`. The
 * film reads the composition's markers, its audio tracks' beats and its items' starts and ends, in the seconds
 * of the item it plays in, and cuts to them (`atMark`, `marksNamed` in handdrawn/core/cuemarks.js).
 */
export interface CueOpts {
  cuesFrom?: string | undefined;
  at?: string | undefined;
}

const cueArgs = (o: CueOpts) => [...(o.cuesFrom ? ["--cues-from", o.cuesFrom] : []), ...(o.cuesFrom && o.at ? ["--at", o.at] : [])];

export interface RenderOpts extends CueOpts {
  look?: string | undefined;
  ar?: HdfAspect | undefined;
  width?: number | undefined;
  frames?: number | undefined;
  alpha?: AlphaCodec | undefined;
}

/** The store ids a render says the film read (its `store  <id> ...` line), sorted; [] when it read none. */
export function storeRead(out: string): string[] {
  const line = out.split("\n").map((l) => l.trim()).find((l) => /^store\s/.test(l));
  return line ? line.split(/\s+/).slice(1).filter(Boolean).sort() : [];
}

/**
 * `hdf render`; returns the clip with sound when the film has a score, else the picture: an mp4, or with
 * `alpha` (4.0 D1) a .mov / .webm drawn on no stock, whose transparency davidup keeps. `store`: the store
 * records the film read (the clip's `made.from`).
 */
export async function renderFilm(path: string, opts: RenderOpts = {}): Promise<{ file: string; store: string[] }> {
  const args = ["render", path, "--out", hdfOut(), ...cueArgs(opts)];
  if (opts.look) args.push("--look", opts.look);
  if (opts.ar) args.push("--ar", opts.ar);
  if (opts.width !== undefined) args.push("--width", String(opts.width));
  if (opts.frames !== undefined) args.push("--frames", String(opts.frames));
  if (opts.alpha) args.push("--alpha", opts.alpha);
  const out = await hdf(args);
  return { file: printed(out, opts.alpha ? `.${opts.alpha}` : ".mp4"), store: storeRead(out) };
}

/**
 * How a render names its film in `made.args`: its path under the handdrawn package (`films/mini.js`), else
 * the absolute path, so `asset remake` (I1) can run it again.
 */
export function filmRef(path: string, root = hdfRoot()): string {
  if (!root) return path;
  const rel = relative(root, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}

/** What `hdf cues` writes (handdrawn/cli/cues.mjs). Seconds from the film's first frame. */
export interface CueFile {
  kind: "hdf-cues";
  version: number;
  film: string;
  look: string | null;
  fps: number;
  end: number;
  shots: Array<{ name: string; t0: number; dur: number; hold?: boolean; cut?: string }>;
  cuts: number[];
  chapters: Array<{ n: number; title: string; t0: number; dur: number }>;
  notes: Array<{ t: number; dur: number; type: string; hz?: number }>;
  words: Array<{ text: string; t0: number; t1: number; voice: string }>;
  marks: Array<{ t: number; name: string; from: string }>;
}

/** `hdf cues` (4.0 D4): the film's shots, cuts, chapters, notes, words and the marks it was cut to. */
export async function filmCues(path: string, opts: { look?: string | undefined } & CueOpts = {}): Promise<CueFile> {
  const args = ["cues", path, "--out", hdfOut(), ...cueArgs(opts)];
  if (opts.look) args.push("--look", opts.look);
  return JSON.parse(readFileSync(printed(await hdf(args), ".json"), "utf8")) as CueFile;
}

/**
 * The film's chapters as composition markers for a video item that plays it: each at the item's `start`
 * plus the chapter's start less the item's `trimIn`, named by its title. A chapter trimmed off the front,
 * or past the item's `end`, is left out.
 */
export function chapterMarkers(
  cues: Pick<CueFile, "chapters">,
  item: { start?: number | undefined; end?: number | undefined; trimIn?: number | undefined },
  source: string,
): Marker[] {
  const start = item.start ?? 0, trimIn = item.trimIn ?? 0;
  return cues.chapters
    .map((c) => ({ t: +(start + c.t0 - trimIn).toFixed(6), name: c.title, source }))
    .filter((m) => m.t >= start - 1e-9 && (item.end === undefined || m.t < item.end));
}

/** `markers` with those from `source` replaced by `add`, sorted by time (a stable sort). */
export function replaceMarkers(markers: Marker[], source: string, add: Marker[]): Marker[] {
  return [...markers.filter((m) => m.source !== source), ...add]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.t - b.m.t || a.i - b.i)
    .map(({ m }) => m);
}

/** What `hdf sprite` writes beside its PNG: davidup's `sheet` and what the sprite is. */
export interface SpriteJson extends SpriteSheet {
  kind: "hdf-sprite";
  name: string;
  look: string;
  image: string;
  frames: Array<[number, number, number, number]>;
}

/** The sheet davidup keeps on the image asset: the JSON without hdf's own fields. */
export function sheetOf(j: SpriteJson): SpriteSheet {
  const { frameWidth, frameHeight, columns, count, fps, cycles, anchor } = j;
  return { frameWidth, frameHeight, columns, count, fps, ...(cycles ? { cycles } : {}), ...(anchor ? { anchor } : {}) };
}

export interface SpriteOpts {
  /** The film whose cast the name is looked up in (and whose look it is drawn in). */
  film?: string | undefined;
  look?: string | undefined;
  states?: string | undefined;
  h?: number | undefined;
}

/** `hdf sprite <ref> --alpha`; returns the PNG and its sheet. */
export async function spriteSheet(ref: string, opts: SpriteOpts = {}): Promise<{ png: string; sheet: SpriteSheet; json: SpriteJson }> {
  const args = ["sprite", ref, "--alpha", "--out", hdfOut()];
  if (opts.film) args.push("--film", opts.film);
  if (opts.look) args.push("--look", opts.look);
  if (opts.states) args.push("--states", opts.states);
  if (opts.h !== undefined) args.push("--h", String(opts.h));
  const out = await hdf(args);
  const png = printed(out, ".png");
  const json = JSON.parse(readFileSync(printed(out, ".json"), "utf8")) as SpriteJson;
  return { png, sheet: sheetOf(json), json };
}

/** `hdf sprite --film <film> --cast`: the names a film's sprites can be drawn by, sorted. */
export async function castNames(path: string): Promise<string[]> {
  return (await hdf(["sprite", "--film", path, "--cast"])).split("\n").map((s) => s.trim()).filter(Boolean);
}

/** `hdf hand --export-ttf <id>` (4.0 D3); returns the .ttf. */
export async function handFont(hand: string): Promise<string> {
  return printed(await hdf(["hand", "--export-ttf", hand, "--out", hdfOut()]), ".ttf");
}

/** `hdf sheet store <id> --poses`; returns the model sheet's path. */
export async function modelSheet(puppet: string): Promise<string> {
  return printed(await hdf(["sheet", "store", puppet, "--poses"]), ".jpg");
}

// ──────────────── into the asset library (asset-library plan D4) ────────────────

/**
 * The library id of what hdf made for a composition asset: `hdf-mini` stays, `fox` becomes `hdf-fox` (so a
 * clip registered as `fox` never shadows the house shelf's fox puppet), lower-cased to the library's rule.
 */
export function derivedId(assetId: string): string {
  const id = assetId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id.startsWith("hdf-") ? id : `hdf-${id || "asset"}`;
}

/** Something hdf made, to be put on a shelf. */
export interface Derived {
  /** The library id (see {@link derivedId}). */
  id: string;
  kind: "video" | "image" | "font";
  /** The file hdf wrote. */
  file: string;
  name: string;
  desc: string;
  tags: string[];
  /** How it was made: `{ tool, from, args }`; `at` is filled in. */
  made: { tool: string; from: string[]; args: Record<string, unknown> };
  credit?: string | undefined;
  licence?: AssetLicence | undefined;
  /** A font's family. */
  family?: string | undefined;
  /** An image's sprite sheet (4.0 D2). */
  sheet?: SpriteSheet | undefined;
}

export interface PutDerived {
  id: string;
  shelf: string;
  /** `asset:<id>@<sha12>`, the src the composition registers. */
  src: string;
  /** The blob. */
  path: string;
  record: AssetRecord;
  /** new, replaced (same id, other bytes) or unchanged (the same bytes again). */
  status: "new" | "replaced" | "unchanged";
  warnings: string[];
}

const dropUndefined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Puts a file hdf made on `shelf` as a record with its `made` block, probed (a video's duration, size, alpha
 * and sound; a font's tables; a PNG's or a video frame's palette, light and room, D6), replacing the id in
 * place. `probes` go over assetlib's own, whose frame grabber runs davidup's ffmpeg. The blob it replaces is
 * deleted when no other entry on the shelf holds it (a re-render leaves no orphan behind).
 */
export async function putDerived(lib: Library, shelf: string, d: Derived, probes: Probes = {}): Promise<PutDerived> {
  const own = defaultProbes({ ffmpeg: await resolveFfmpeg() });
  probes = { ...own, pixels: (file, info) => (info.ext === "png" ? own.pixels(file, info) : null), ...probes };
  const bytes = readFileSync(d.file);
  const target = lib.shelf(shelf);
  const had = target.entries.get(d.id) ?? null;
  const entry = {
    id: d.id,
    kind: d.kind,
    name: d.name,
    desc: d.desc,
    tags: [...new Set(d.tags.map((t) => t.toLowerCase()).filter(Boolean))],
    file: basename(d.file),
    licence: d.licence ?? "own",
    credit: d.credit ?? "",
    source: "",
    made: { tool: d.made.tool, from: [...d.made.from], args: dropUndefined(d.made.args), at: new Date().toISOString() },
    ...(d.family !== undefined ? { family: d.family } : {}),
    ...(d.sheet !== undefined ? { sheet: d.sheet } : {}),
  };
  const out = await lib.put(shelf, entry, bytes, { probes, by: d.made.tool });
  if (had && had.sha !== out.entry.sha && ![...target.entries.values()].some((e) => e.sha === had.sha)) {
    for (const p of [target.blobPath(had), target.thumbPath(had)]) rmSync(p, { force: true });
  }
  const record = { ...out.entry, id: d.id, shelf, shadowed: [] } as unknown as AssetRecord;
  const before = lib.shelves.map((s) => s.name).slice(0, lib.shelves.findIndex((s) => s.name === shelf));
  const hiding = before.filter((n) => lib.shelf(n).has(d.id));
  return {
    id: d.id,
    shelf,
    src: assetSrc({ id: d.id, sha: String(out.entry.sha) }),
    path: out.path,
    record,
    status: !had ? "new" : had.sha === out.entry.sha ? "unchanged" : "replaced",
    warnings: [
      ...out.warnings,
      ...(hiding.length ? [`'${d.id}' on ${shelf} is shadowed by the record of the same id on ${hiding.join(", ")}.`] : []),
    ],
  };
}

/** The render of a film as a library `video` (`made.tool: 'hdf render'`, `made.from`: the store records it read). */
export function clipDerived(
  id: string,
  file: string,
  o: { film: string; store: string[]; look?: string | undefined; ar?: HdfAspect | undefined; width?: number | undefined; frames?: number | undefined; alpha?: AlphaCodec | undefined; cues?: boolean | undefined },
): Derived {
  const name = filmName(o.film);
  const look = o.look?.split("~")[0];
  return {
    id, kind: "video", file,
    name: `${name} (hand-drawn clip)`,
    desc: `The hand-drawn film ${name}${o.look ? ` in ${o.look}` : ""}${o.alpha ? ", drawn on no paper (alpha)" : ""}, rendered by hdf${o.frames !== undefined ? ` (first ${o.frames} drawings)` : ""}`,
    tags: ["hdf", "hand-drawn", "clip", name, ...(look ? [look] : []), ...(o.alpha ? ["alpha", "overlay"] : [])],
    licence: "own",
    made: {
      tool: "hdf render",
      from: o.store,
      args: { film: filmRef(o.film), look: o.look, ar: o.ar, width: o.width, frames: o.frames, alpha: o.alpha, ...(o.cues ? { cues: "composition" } : {}) },
    },
  };
}

/** A cast member's sprite sheet as a library `image` with its `sheet` (`made.from`: the store puppet, when it is one). */
export function spriteDerived(
  id: string,
  sprite: { png: string; sheet: SpriteSheet },
  o: { name: string; film: string; look?: string | undefined; states?: string | undefined; h?: number | undefined; has: (id: string) => boolean },
): Derived {
  const cycles = Object.keys(sprite.sheet.cycles ?? {});
  return {
    id, kind: "image", file: sprite.png,
    name: `${o.name} sprite sheet`,
    desc: `${o.name} as a sprite sheet drawn by hdf (${cycles.join(", ") || `${sprite.sheet.count} frames`}), from the film ${filmName(o.film)}`,
    tags: ["hdf", "hand-drawn", "sprite", "sheet", "character", o.name, ...cycles],
    ...storeCredit(o.name),
    sheet: sprite.sheet,
    made: {
      tool: "hdf sprite",
      from: o.has(o.name) ? [o.name] : [],
      args: { name: o.name, film: filmRef(o.film), look: o.look, states: o.states, h: o.h },
    },
  };
}

/** A hand as a TrueType `font`, family `hdf-<hand>` (`made.from`: the hand, unless it is the house hand). */
export function fontDerived(id: string, file: string, hand: string, has: (id: string) => boolean): Derived {
  return {
    id, kind: "font", file,
    name: `${hand} hand (font)`,
    desc: `The hand-drawn hand ${hand} as a TrueType font, its centre lines swept by its pen`,
    tags: ["hdf", "hand-drawn", "font", "handwriting", hand],
    ...storeCredit(hand),
    family: `hdf-${slug(hand)}`,
    made: { tool: "hdf hand --export-ttf", from: has(hand) ? [hand] : [], args: { hand } },
  };
}

/** A store puppet's model sheet (`hdf sheet store <id> --poses`) as a library `image`. */
export function modelDerived(id: string, file: string, puppet: string): Derived {
  return {
    id, kind: "image", file,
    name: `${puppet} model sheet`,
    desc: `The model sheet of the puppet ${puppet}: its poses and views, drawn by hdf`,
    tags: ["hdf", "hand-drawn", "model-sheet", "character", puppet],
    ...storeCredit(puppet),
    made: { tool: "hdf sheet store", from: [puppet], args: { puppet, poses: true } },
  };
}

/** register_asset's input for a composition asset `assetId` playing a record putDerived wrote. */
export function registerDerived(assetId: string, d: Derived, put: PutDerived): Record<string, unknown> {
  return {
    id: assetId, type: d.kind, src: put.src,
    ...(d.family !== undefined ? { family: d.family } : {}),
    ...(d.sheet !== undefined ? { sheet: d.sheet } : {}),
    ...(put.record.credit ? { credit: put.record.credit } : {}),
    licence: put.record.licence,
  };
}
