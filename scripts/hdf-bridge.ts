// handdrawn ↔ davidup (hand-drawn film 3.0, S16). Shared by the two bridge
// scripts, `hdf-to-davidup.ts` and `davidup-hdf-clip.ts`.
//
// The two projects meet through files, not a new item type: a handdrawn film
// renders to an mp4 (`hdf render`), a puppet to a model sheet
// (`hdf sheet store <id> --poses`), and both land in a davidup project as
// ordinary assets. Registration goes through the engine's own `register_asset`
// tool (dispatched in-process, as the MCP server would) so a video gets the
// same ffprobe metadata and warnings an agent's call would get. Only the
// `assets` array of composition.json is rewritten; the rest of the document is
// left exactly as it was, so a running editor reloads it as an external edit.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CompositionStore, dispatchTool, TOOLS } from "../src/mcp/index.js";
import { probeVideo } from "../src/drivers/node/ffprobe.js";
import type { Asset } from "../src/schema/types.js";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const HANDDRAWN = join(REPO, "handdrawn");
const HDF = join(HANDDRAWN, "cli", "hdf.mjs");
const HDF_OUT = join(HANDDRAWN, "out");

/** Where bridged files land inside a davidup project, relative to its root. */
export const ASSET_DIR = "assets/hdf";

export class BridgeError extends Error {}

// ──────────────── flags ────────────────

/** `--key value`, `--key=value`, `--flag`; everything else is positional. */
export function parseArgs(argv: string[]): { args: string[]; flags: Record<string, string | true> } {
  const args: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) { args.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
  }
  return { args, flags };
}

export function frameCount(v: string | true | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new BridgeError(`--frames takes a whole number >= 1 (got ${String(v)})`);
  return n;
}

/** A value safe as a file name and an asset id: `paperInk~hand:test` → `paperInk-hand-test`. */
export const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

// ──────────────── handdrawn side ────────────────

/** A film path as given, or a bare name for `handdrawn/films/<name>.js`. */
export function filmPath(ref: string, cwd = process.cwd()): string {
  const direct = resolve(cwd, ref);
  if (existsSync(direct)) return direct;
  const named = join(HANDDRAWN, "films", ref.endsWith(".js") ? ref : `${ref}.js`);
  if (existsSync(named)) return named;
  throw new BridgeError(`no film '${ref}' (neither ${direct} nor ${named})`);
}

export interface FilmInfo {
  name: string;
  /** Drawn frames (12 fps). */
  n: number;
  /** Store puppets the film read, sorted. */
  puppets: string[];
  /** What `hdf render` names the file, before any `-<N>f`: `<film>[-<look>]`. */
  variant: string;
}

/** Loads the film (no pixels) and names the store puppets it read. */
export async function filmInfo(path: string, look?: string): Promise<FilmInfo> {
  const { loadFilm, assetsOf } = await import("../handdrawn/cli/load.mjs");
  const { stored } = await import("../handdrawn/core/store.js");
  const { readCatalogue } = await import("../handdrawn/core/assets.js");
  const film = await loadFilm(path, { look });
  const st = readCatalogue();
  const ids = new Set<string>([...stored(), ...Object.keys(assetsOf(film))]);
  const puppets = [...ids].filter((id) => st.has(id) && st.entry(id).kind === "puppet").sort();
  return { name: film.name, n: film.n, puppets, variant: `${film.name}${look ? `-${look}` : ""}` };
}

function hdf(args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    // hdf is a node program (skia-canvas, worker threads); these scripts run under bun.
    const p = spawn(process.env.NODE ?? "node", [HDF, ...args], {
      cwd: HANDDRAWN,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    p.stdout.on("data", (c) => { out += c; });
    p.on("error", rej);
    p.on("close", (code) => (code === 0 ? res(out) : rej(new BridgeError(`hdf ${args.join(" ")} exited with code ${code}`))));
  });
}

// The last file a command printed with this extension (hdf prints `<path>  <what>` lines).
function printed(out: string, ext: string): string {
  const files = out.split("\n").map((l) => l.trim().split(/\s+/)[0] ?? "").filter((f) => f.endsWith(ext));
  const last = files.at(-1);
  if (!last) throw new BridgeError(`hdf printed no ${ext} file:\n${out}`);
  return last;
}

/** `hdf render`; returns the mp4 with sound when the film has a score, else the picture. */
export async function renderFilm(path: string, opts: { look?: string; frames?: number } = {}): Promise<string> {
  const args = ["render", path, "--out", HDF_OUT];
  if (opts.look) args.push("--look", opts.look);
  if (opts.frames !== undefined) args.push("--frames", String(opts.frames));
  return printed(await hdf(args), ".mp4");
}

/** `hdf sheet store <id> --poses`; returns the model sheet's path. */
export async function modelSheet(puppet: string): Promise<string> {
  return printed(await hdf(["sheet", "store", puppet, "--poses"]), ".jpg");
}

// ──────────────── davidup side ────────────────

function stateDir(): string {
  const d = process.env.DAVIDUP_STATE_DIR;
  return d && d.length > 0 ? d : join(homedir(), ".davidup");
}

/**
 * A davidup project: a directory holding composition.json (or that file
 * itself), or the name of a project in the editor's recents list.
 */
export function projectRoot(ref: string): string {
  const direct = resolve(ref);
  if (existsSync(direct)) {
    const root = statSync(direct).isDirectory() ? direct : dirname(direct);
    if (existsSync(join(root, "composition.json"))) return root;
    throw new BridgeError(`${root} is not a davidup project (no composition.json)`);
  }
  const file = join(stateDir(), "recents.json");
  let recents: Array<{ path: string; name: string }> = [];
  try { recents = JSON.parse(readFileSync(file, "utf8")).projects ?? []; } catch { /* no recents yet */ }
  const hit = recents.find((p) => p.name === ref && existsSync(join(p.path, "composition.json")));
  if (hit) return hit.path;
  throw new BridgeError(
    `no davidup project '${ref}': not a directory, and not a name in ${file}` +
      (recents.length ? ` (have ${recents.map((p) => p.name).join(", ")})` : ""),
  );
}

export interface Planned {
  id: string;
  type: "video" | "image";
  /** The file to copy in. */
  file: string;
}

export interface Registered {
  asset: Asset;
  warnings: string[];
}

const REGISTER = TOOLS.find((t) => t.name === "register_asset")!;

/**
 * Copies each file into `<compositionDir>/assets/hdf/<id>.<ext>` and registers it
 * through `register_asset`, replacing an asset of the same id. Returns the
 * assets as they were written.
 */
export async function registerFiles(compositionFile: string, planned: Planned[]): Promise<Registered[]> {
  const root = dirname(compositionFile);
  const doc = JSON.parse(readFileSync(compositionFile, "utf8"));
  if (!doc || typeof doc !== "object" || !doc.composition || !Array.isArray(doc.assets)) {
    throw new BridgeError(`${compositionFile} is not a composition document`);
  }
  const meta = doc.composition;
  const store = new CompositionStore();
  store.createComposition({ width: meta.width, height: meta.height, fps: meta.fps, duration: meta.duration });
  // A relative src is relative to composition.json, which is where the probe must look too.
  const deps = { store, probeVideo: (src: string) => probeVideo(isAbsolute(src) ? src : join(root, src)) };

  mkdirSync(join(root, ASSET_DIR), { recursive: true });
  const out: Registered[] = [];
  for (const p of planned) {
    const src = `${ASSET_DIR}/${slug(p.id)}${extname(p.file)}`;
    copyFileSync(p.file, join(root, src));
    const r = await dispatchTool(REGISTER, { id: p.id, type: p.type, src }, deps);
    if (!r.ok) throw new BridgeError(`register_asset ${p.id}: ${r.error.message}${r.error.hint ? ` (${r.error.hint})` : ""}`);
    const asset = store.getAsset(p.id)!;
    const at = doc.assets.findIndex((a: { id?: string }) => a?.id === p.id);
    if (at >= 0) doc.assets[at] = asset; else doc.assets.push(asset);
    out.push({ asset, warnings: (r.result as { warnings?: string[] }).warnings ?? [] });
  }
  writeFileSync(compositionFile, JSON.stringify(doc, null, 2) + "\n");
  return out;
}

/** One line per asset: `id  type  src  (w×h, duration)`. */
export function describe(asset: Asset): string {
  const extra: string[] = [];
  if (asset.type === "video") {
    if (asset.width && asset.height) extra.push(`${asset.width}x${asset.height}`);
    if (asset.duration !== undefined) extra.push(`${asset.duration}s`);
    if (asset.hasAudio) extra.push("sound");
  }
  return `${asset.id}  ${asset.type}  ${asset.src}${extra.length ? `  (${extra.join(", ")})` : ""}`;
}

/** A path for messages: relative to the working directory when it is inside it. */
export const shown = (p: string) => {
  const r = relative(process.cwd(), p);
  return r && !r.startsWith("..") ? r : p;
};

/** Runs a script's main, printing a BridgeError as one line and exiting 1. */
export function runMain(main: () => Promise<number>): void {
  main().then(
    (code) => { process.exitCode = code; },
    (e) => {
      process.stderr.write(e instanceof BridgeError ? `${e.message}\n` : `${(e as Error).stack ?? e}\n`);
      process.exitCode = 1;
    },
  );
}
