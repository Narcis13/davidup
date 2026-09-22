// handdrawn from davidup (hand-drawn film 3.0 S16, 4.0 D1–D5): the calls into
// the `hdf` command line that the bridge scripts (scripts/hdf-bridge.ts) and
// the `render_hdf_clip` MCP tool share.
//
// hdf is a node program (skia-canvas, worker threads, ffmpeg), so it always
// runs as a subprocess, never inside the server. Its files land in
// `handdrawn/out/`; callers copy what they register. The package lives beside
// src/ in the repo (`../../handdrawn` from this module, from src/ or dist/
// alike), or wherever `DAVIDUP_HDF_ROOT` points. An install without it (the
// npm package does not ship handdrawn/) gets `null` from `hdfRoot()`.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Marker, SpriteSheet } from "../schema/types.js";

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

/** A film path as given, or a bare name for `handdrawn/films/<name>.js`. */
export function filmPath(ref: string, cwd = process.cwd()): string {
  const direct = resolve(cwd, ref);
  if (existsSync(direct)) return direct;
  const named = join(requireRoot(), "films", ref.endsWith(".js") ? ref : `${ref}.js`);
  if (existsSync(named)) return named;
  throw new HdfError(`no film '${ref}' (neither ${direct} nor ${named})`);
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

/**
 * `hdf render`; returns the clip with sound when the film has a score, else the picture: an mp4, or with
 * `alpha` (4.0 D1) a .mov / .webm drawn on no stock, whose transparency davidup keeps.
 */
export async function renderFilm(path: string, opts: RenderOpts = {}): Promise<string> {
  const args = ["render", path, "--out", hdfOut(), ...cueArgs(opts)];
  if (opts.look) args.push("--look", opts.look);
  if (opts.ar) args.push("--ar", opts.ar);
  if (opts.width !== undefined) args.push("--width", String(opts.width));
  if (opts.frames !== undefined) args.push("--frames", String(opts.frames));
  if (opts.alpha) args.push("--alpha", opts.alpha);
  return printed(await hdf(args), opts.alpha ? `.${opts.alpha}` : ".mp4");
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
