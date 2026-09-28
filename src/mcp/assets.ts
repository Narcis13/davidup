// The asset library from the MCP tools (docs/asset-library-plan.md D2, D3):
// what `search_assets`, `get_asset`, `get_asset_preview`, `add_asset`,
// `tag_asset`, `use_asset` and the library half of `list_library` /
// `get_library_thumbnail` share.
//
// The library is a directory, so none of this needs the editor: the shelves
// are the open project's `assets/` (editor-hosted, else `$DAVIDUP_PROJECT`'s),
// the user's pool and the house shelf, read on every call (a catalogue is a
// few KB; a record `asset add` just wrote is seen at once). Previews are drawn
// by the hosts found next to assetlib (hdf's previewers when `handdrawn/` is
// in the checkout, H3), else by assetlib's fallback card; the same hosts add
// what only they can read off a payload (hdf traces a cutout's silhouette).

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { addAsset, idOf } from "../../assetlib/add.js";
import {
  DAVIDUP_TYPE,
  ID,
  KINDS,
  THUMB_CACHE,
  assetSrc,
  imageInfo,
  loadHosts,
  sha,
  type Adds,
  type AssetRecord,
  type Kind,
  type Library,
  type LibraryHit,
  type Licence,
  type Previewers,
  type Probes,
  type SearchQuery,
  type SearchResult,
} from "../../assetlib/index.js";
import { openAssetLibrary } from "../assets/library.js";
import { MCPToolError } from "./errors.js";

/** The standard shelves for `project`, or the MCP error saying which catalogue could not be read. */
export function openShelves(project: string | undefined, previewers?: Previewers): Library {
  try {
    return openAssetLibrary({ project, ...(previewers ? { previewers } : {}) });
  } catch (err) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `The asset library could not be read: ${(err as Error).message}`,
      "`asset check` names what is wrong with a shelf's catalogue.json.",
    );
  }
}

/** Throws E_ASSET_MISSING naming the shelves searched unless the library holds `ref` (an id or `sha:<hex>`). */
export function requireAsset(lib: Library, ref: string): void {
  if (lib.has(ref)) return;
  const searched = lib.shelves.map((s) => `${s.name} (${s.root})`).join(", ") || "none";
  throw new MCPToolError(
    "E_ASSET_MISSING",
    `No asset '${ref}' on shelves ${searched}.`,
    "Call `search_assets` to see what the shelves hold; ids are flat lower-case (`teapot`), or `sha:<12+ hex>`.",
  );
}

// ── Hosts: previewers and add sides ──

let hosts: Promise<{ previewers: Previewers; adds: Adds; warnings: string[] }> | null = null;

/** The hosts beside assetlib (`loadHosts()`, H3), loaded once per process. */
function assetHosts(): Promise<{ previewers: Previewers; adds: Adds; warnings: string[] }> {
  hosts ??= loadHosts().then(
    ({ previewers, adds, warnings }) => ({ previewers, adds, warnings }),
    (err: unknown) => ({ previewers: {}, adds: {}, warnings: [`asset hosts not loaded: ${(err as Error)?.message ?? err}`] }),
  );
  return hosts;
}

/** The hosts' previewers. `injected` (ToolDeps.assetPreviewers) replaces them. */
export async function assetPreviewers(injected?: Previewers): Promise<{ previewers: Previewers; warnings: string[] }> {
  if (injected) return { previewers: injected, warnings: [] };
  const { previewers, warnings } = await assetHosts();
  return { previewers, warnings };
}

/** The hosts' add sides by kind (D3). `injected` (ToolDeps.assetAdds) replaces them. */
export async function assetAdds(injected?: Adds): Promise<{ adds: Adds; warnings: string[] }> {
  if (injected) return { adds: injected, warnings: [] };
  const { adds, warnings } = await assetHosts();
  return { adds, warnings };
}

// ── search_assets ──

// Record fields too long to repeat on every hit (a cutout's silhouette, a
// sample's word timing and mouth shapes); `get_asset` returns them.
const BULKY = ["sil", "align", "mouth"] as const;

export interface AssetSearchHit extends Omit<LibraryHit, "record"> {
  record: AssetRecord;
  /** Fields left out of `record` here; `get_asset` has them. */
  omitted?: string[];
}

/** `lib.search`, with each hit's bulky fields left out. Throws E_INVALID_VALUE for a query assetlib refuses. */
export function searchShelves(lib: Library, query: SearchQuery): SearchResult<AssetSearchHit> {
  let out: SearchResult<LibraryHit>;
  try {
    out = lib.search(query);
  } catch (err) {
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `search_assets: ${(err as Error).message}`,
      `The shelves here are ${lib.shelves.map((s) => s.name).join(", ") || "none"}; a \`shelf\` filter names one of them.`,
    );
  }
  return {
    ...out,
    hits: out.hits.map((h) => {
      const record = { ...h.record };
      const omitted = BULKY.filter((k) => record[k] !== undefined);
      for (const k of omitted) delete record[k];
      return { ...h, record, ...(omitted.length ? { omitted: [...omitted] } : {}) };
    }),
  };
}

// ── get_asset ──

export interface AssetDetail {
  record: AssetRecord;
  /** The shelf the record resolves on. */
  shelf: string;
  /** Every shelf holding the id, the winner first. */
  shelves: string[];
  /** The blob, or null when it is missing from the shelf. */
  path: string | null;
  /** The preview, or null until `get_asset_preview` has drawn it. */
  thumb: string | null;
  /** Other entries holding the same bytes. */
  same: { shelf: string; id: string }[];
  made: {
    /** What this record was made from (its `made.from`). */
    from: ({ id: string; kind: string; shelf: string } | { id: string; missing: true })[];
    /** The records made from this one, newest first. */
    into: { id: string; kind: string; shelf: string; tool?: string }[];
  };
  use: ReturnType<Library["use"]>;
}

/** The full record, where it lives, what it was made from and into, and its `use` (the `asset show` data). */
export function assetDetail(lib: Library, ref: string): AssetDetail {
  requireAsset(lib, ref);
  const loc = lib.locate(ref);
  const record = lib.get(ref);
  return {
    record,
    shelf: loc.shelf,
    shelves: [loc.shelf, ...loc.shadowed],
    path: existsSync(loc.path) ? loc.path : null,
    // Where lib.preview writes: the shelf's thumbs/, else the cache for a read-only shelf.
    thumb: [loc.thumb, join(THUMB_CACHE, `${loc.entry.sha}.png`)].find((t) => existsSync(t)) ?? null,
    same: lib.holders(String(loc.entry.sha)).filter((h) => !(h.shelf === loc.shelf && h.id === loc.id)),
    made: {
      from: (record.made?.from ?? []).map((id) => {
        if (!lib.has(id)) return { id, missing: true as const };
        const r = lib.get(id);
        return { id, kind: r.kind, shelf: r.shelf };
      }),
      into: lib.made(loc.id).map((r) => ({
        id: r.id,
        kind: r.kind,
        shelf: r.shelf,
        ...(r.made?.tool ? { tool: r.made.tool } : {}),
      })),
    },
    use: lib.use(loc.id),
  };
}

// ── get_asset_preview ──

export interface PngResult {
  /** Base64 PNG. */
  image: string;
  mimeType: "image/png";
  width: number;
  height: number;
}

export function pngResult(png: Uint8Array): PngResult {
  const info = imageInfo(png);
  return {
    image: Buffer.from(png).toString("base64"),
    mimeType: "image/png",
    width: info?.w ?? 0,
    height: info?.h ?? 0,
  };
}

/** One record's preview: the cached thumb, a host's picture, or the fallback card (`by` says which). */
export async function assetPreview(lib: Library, ref: string, force = false) {
  requireAsset(lib, ref);
  const p = await lib.preview(ref, { force });
  return { id: p.id, shelf: p.shelf, ...pngResult(p.png), by: p.by, cached: p.cached, thumb: p.path, warnings: p.warnings };
}

/** One contact sheet of some records' previews, each over its id. */
export async function assetSheet(lib: Library, refs: string[], opts: { cols?: number; force?: boolean }) {
  for (const ref of refs) requireAsset(lib, ref);
  const s = await lib.sheet(refs, {
    ...(opts.cols !== undefined ? { cols: opts.cols } : {}),
    ...(opts.force !== undefined ? { force: opts.force } : {}),
  });
  return {
    ids: s.cells.map((c) => c.id),
    ...pngResult(s.png),
    cols: s.cols,
    rows: s.rows,
    cells: s.cells,
    warnings: s.warnings,
  };
}

// ── list_library's asset and font items ──

/** The kinds davidup takes as an `asset` item (every kind with a davidup type but font). */
export const ASSET_ITEM_KINDS: Kind[] = KINDS.filter((k) => DAVIDUP_TYPE[k] !== null && DAVIDUP_TYPE[k] !== "font");

export interface LibraryShelfItem {
  kind: "asset" | "font";
  id: string;
  name?: string;
  description?: string;
  /** The blob. */
  source: string;
  scope: "project" | "global";
  /** The `asset:<id>@<sha12>` src `register_asset` takes. */
  url: string;
  shelf: string;
  /** The record's own kind (`cutout`, `sample`, ...). */
  assetKind: string;
  licence: string;
  duration?: number;
}

/**
 * The records davidup can take as list_library `asset` / `font` items, ranked
 * by `q` (assetlib search) when there is one. `scope: 'project'` is the
 * project shelf; `'global'` the user's pool and the house shelf.
 */
export function libraryShelfItems(
  lib: Library,
  args: { q?: string; kind?: "asset" | "font"; scope?: "project" | "global" },
): { items: LibraryShelfItem[]; total: number } {
  const kinds: Kind[] =
    args.kind === "font" ? ["font"] : args.kind === "asset" ? ASSET_ITEM_KINDS : [...ASSET_ITEM_KINDS, "font"];
  const names = lib.shelves.map((s) => s.name);
  const shelf =
    args.scope === "project"
      ? names.filter((n) => n === "project")
      : args.scope === "global"
        ? names.filter((n) => n !== "project")
        : undefined;
  const total = lib.search({ kind: kinds, limit: 0, facets: false }).count;
  if (shelf && shelf.length === 0) return { items: [], total };
  const out = lib.search({
    kind: kinds,
    ...(args.q !== undefined ? { q: args.q } : {}),
    ...(shelf ? { shelf } : {}),
    limit: 10_000,
    facets: false,
  });
  const items = out.hits.map(({ record: r, path }): LibraryShelfItem => ({
    kind: r.kind === "font" ? "font" : "asset",
    id: r.id,
    ...(r.name ? { name: r.name } : {}),
    ...(r.desc ? { description: r.desc } : {}),
    source: path,
    scope: r.shelf === "project" ? "project" : "global",
    url: assetSrc(r),
    shelf: r.shelf,
    assetKind: r.kind,
    licence: r.licence,
    ...(typeof r.sec === "number" ? { duration: r.sec } : {}),
  }));
  return { items, total };
}

// ── add_asset (D3) ──

/** The shelf a write names, or E_INVALID_VALUE naming the shelves there are. */
function writableShelf(lib: Library, name: string): string {
  if (lib.shelves.some((s) => s.name === name)) return name;
  const there = lib.shelves.map((s) => s.name).join(", ");
  throw new MCPToolError(
    "E_INVALID_VALUE",
    `No shelf '${name}' here (the shelves are ${there}).`,
    name === "project"
      ? "The project shelf is the open project's `assets/` (editor-hosted, else `$DAVIDUP_PROJECT`'s); write to `user` without one."
      : `Name one of ${there}.`,
  );
}

/** A note when `id` on `shelf` is hidden by an earlier shelf's record of the same id. */
export function shadowNote(lib: Library, id: string, shelf: string): string[] {
  const names = lib.shelves.map((s) => s.name);
  const before = names.slice(0, names.indexOf(shelf)).filter((n) => lib.shelf(n).has(id));
  return before.length
    ? [`'${id}' on ${shelf} is shadowed by the record of the same id on ${before.join(", ")}: \`asset:${id}\` resolves there, not to this one.`]
    : [];
}

export interface AddAssetArgs {
  path: string;
  id?: string;
  kind: Kind;
  name: string;
  licence?: Licence;
  credit?: string;
  source?: string;
  tags?: string[];
  desc?: string;
  family?: string;
  fields?: Record<string, unknown>;
  shelf?: string;
  replace?: boolean;
}

/**
 * A file put on a shelf (assetlib's addAsset: the kind's fields read off the
 * payload, by the host that knows the kind when there is one; probed;
 * validated before anything is written). An id the shelf already holds with
 * other bytes needs `replace`.
 */
export async function addAssetFile(
  lib: Library,
  args: AddAssetArgs,
  opts: { cwd: string; adds?: Adds; probes?: Probes },
) {
  const file = resolve(opts.cwd, args.path);
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new MCPToolError("E_NOT_FOUND", `No file at '${args.path}' (${file}).`, "`path` is absolute, or relative to the open project (else the server's working directory).");
  }
  const id = args.id ?? idOf(args.name);
  if (!ID.test(id)) {
    throw new MCPToolError("E_INVALID_VALUE", `'${id}' is not a library id.`, "An id is lower-case letters, digits and dashes (`warm-paper`); pass `id`.");
  }
  const shelf = writableShelf(lib, args.shelf ?? (lib.shelves.some((s) => s.name === "project") ? "project" : "user"));
  const bytes = readFileSync(file);
  const had = lib.shelf(shelf).entries.get(id) ?? null;
  if (had && had.sha !== sha(bytes) && !args.replace) {
    throw new MCPToolError(
      "E_DUPLICATE_ID",
      `'${id}' on ${shelf} already holds other bytes (${had.kind}, sha ${had.sha.slice(0, 12)}).`,
      `Pass \`replace: true\` to point '${id}' at this file (a src pinned \`asset:${id}@${had.sha.slice(0, 12)}\` then errors E_ASSET_STALE), or another \`id\`.`,
    );
  }
  const licence = args.licence ?? "unknown";
  const entry = {
    id,
    kind: args.kind,
    name: args.name,
    file: basename(file),
    licence,
    credit: args.credit ?? "",
    source: args.source ?? "",
    tags: args.tags ?? [],
    ...(args.desc !== undefined ? { desc: args.desc } : {}),
    ...(args.family !== undefined ? { family: args.family } : {}),
  };
  let out;
  try {
    out = await addAsset(
      lib,
      { bytes, file, entry, extra: args.fields ?? {}, shelf },
      { ...(opts.adds ? { adds: opts.adds } : {}), ...(opts.probes ? { probes: opts.probes } : {}), by: "add_asset" },
    );
  } catch (err) {
    if (err instanceof MCPToolError) throw err;
    throw new MCPToolError(
      "E_INVALID_VALUE",
      `add_asset '${id}': ${(err as Error).message}`,
      "Nothing was written. `fields` adds entry fields the file cannot give (a font's `family`, a cutout's `sil`, a puppet's `box`).",
    );
  }
  const warnings = [...out.warnings, ...shadowNote(lib, id, shelf)];
  if (licence === "unknown") warnings.push(`'${id}' has licence unknown; \`asset check\` flags it until \`tag_asset\` sets one.`);
  if ((licence === "CC-BY" || licence === "CC-BY-SA") && !args.credit) {
    warnings.push(`'${id}' is ${licence} but has no credit; the licence asks for one (\`tag_asset\` \`credit\`).`);
  }
  return {
    id,
    shelf,
    path: out.path,
    status: !had ? ("new" as const) : had.sha === out.entry.sha ? ("unchanged bytes" as const) : ("replaced" as const),
    ...(had && had.sha !== out.entry.sha ? { replacedSha: had.sha } : {}),
    record: { ...out.entry, id, shelf },
    warnings,
  };
}

/** A record's blob, thumb and entry moved to another shelf (the editor's promote, generalised). */
export function moveAsset(lib: Library, id: string, to: string, from?: string) {
  requireAsset(lib, id);
  writableShelf(lib, to);
  try {
    const out = lib.move(id, to, from !== undefined ? { from } : {});
    return { id: out.id, from: out.from, to: out.to, path: out.path, record: { ...out.entry, id: out.id, shelf: out.to } };
  } catch (err) {
    throw new MCPToolError("E_INVALID_VALUE", `add_asset: moving '${id}' to ${to}: ${(err as Error).message}`, "`get_asset` shows which shelves hold the id.");
  }
}

// ── tag_asset (D3) ──

export interface EditAssetArgs {
  id: string;
  add?: string[];
  remove?: string[];
  name?: string;
  desc?: string | null;
  credit?: string;
  source?: string;
  licence?: Licence;
  shelf?: string;
}

/** A record's own fields edited in place (`lib.update`: validated whole, the blob untouched). */
export function editAsset(lib: Library, args: EditAssetArgs) {
  requireAsset(lib, args.id);
  const shelf = args.shelf !== undefined ? writableShelf(lib, args.shelf) : lib.locate(args.id).shelf;
  if (!lib.shelf(shelf).has(args.id)) {
    throw new MCPToolError("E_ASSET_MISSING", `No asset '${args.id}' on ${shelf}.`, "`get_asset` lists the shelves holding the id.");
  }
  const before = lib.shelf(shelf).entry(args.id).tags ?? [];
  let tags = [...before];
  for (const t of args.add ?? []) if (!tags.includes(t)) tags.push(t);
  tags = tags.filter((t) => !(args.remove ?? []).includes(t));
  const patch: Record<string, unknown> = {};
  if (args.add !== undefined || args.remove !== undefined) patch.tags = tags;
  for (const k of ["name", "credit", "source", "licence"] as const) if (args[k] !== undefined) patch[k] = args[k];
  if (args.desc !== undefined) patch.desc = args.desc === "" ? null : args.desc;
  if (Object.keys(patch).length === 0) {
    throw new MCPToolError("E_INVALID_VALUE", "tag_asset: nothing to change.", "Pass `add` / `remove` (tags), `name`, `desc`, `credit`, `source` or `licence`.");
  }
  let out;
  try {
    out = lib.update(args.id, patch, { shelf });
  } catch (err) {
    throw new MCPToolError("E_INVALID_VALUE", `tag_asset '${args.id}': ${(err as Error).message}`, "Nothing was written.");
  }
  const after = (out.entry.tags ?? []) as string[];
  return {
    id: out.id,
    shelf: out.shelf,
    record: { ...out.entry, id: out.id, shelf: out.shelf },
    ...(patch.tags ? { added: after.filter((t) => !before.includes(t)), removed: before.filter((t) => !after.includes(t)) } : {}),
    warnings: shadowNote(lib, args.id, shelf),
  };
}

