// The asset library from the MCP tools (docs/asset-library-plan.md D2): what
// `search_assets`, `get_asset`, `get_asset_preview` and the library half of
// `list_library` / `get_library_thumbnail` share.
//
// The library is a directory, so none of this needs the editor: the shelves
// are the open project's `assets/` (editor-hosted, else `$DAVIDUP_PROJECT`'s),
// the user's pool and the house shelf, read on every call (a catalogue is a
// few KB; a record `asset add` just wrote is seen at once). Previews are drawn
// by the hosts found next to assetlib (hdf's previewers when `handdrawn/` is
// in the checkout, H3), else by assetlib's fallback card.

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  DAVIDUP_TYPE,
  KINDS,
  THUMB_CACHE,
  assetSrc,
  imageInfo,
  loadHosts,
  type AssetRecord,
  type Kind,
  type Library,
  type LibraryHit,
  type Previewers,
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

// ── Previewers ──

let hosts: Promise<{ previewers: Previewers; warnings: string[] }> | null = null;

/**
 * The previewers of the hosts beside assetlib (`loadHosts()`, H3), loaded once
 * per process. `injected` (ToolDeps.assetPreviewers) replaces them.
 */
export async function assetPreviewers(injected?: Previewers): Promise<{ previewers: Previewers; warnings: string[] }> {
  if (injected) return { previewers: injected, warnings: [] };
  hosts ??= loadHosts().then(
    ({ previewers, warnings }) => ({ previewers, warnings }),
    (err: unknown) => ({ previewers: {}, warnings: [`preview hosts not loaded: ${(err as Error)?.message ?? err}`] }),
  );
  return hosts;
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
