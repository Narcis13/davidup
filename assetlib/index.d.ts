// Types for assetlib (plain ESM; see index.js and docs/asset-library-plan.md).

export type Kind = 'image' | 'video' | 'audio' | 'font' | 'cutout' | 'clip' | 'puppet' | 'hand' | 'stock' | 'motif' | 'sample';
export type Media = 'raster' | 'video' | 'audio' | 'font' | 'vector' | 'data';
export type Licence = 'CC0' | 'CC-BY' | 'CC-BY-SA' | 'OFL' | 'PD' | 'own' | 'unknown';

export const KINDS: readonly Kind[];
export const MEDIA: readonly Media[];
export const LICENCES: readonly Licence[];
export const ID: RegExp;
export const SHA256: RegExp;
export const SHA1: RegExp;
export const HOUSE_ROOT: string;

/** How an asset made by our own tools was made, so `asset remake` can re-run it. */
export interface Made {
  tool: string;
  from?: string[];
  args?: Record<string, unknown>;
  at?: string;
}

/** A catalogue entry as a shelf holds it: the common envelope plus the kind's own fields. */
export interface Entry {
  kind: Kind;
  media?: Media;
  name: string;
  desc?: string;
  tags: string[];
  licence: Licence;
  credit: string;
  source: string;
  sha: string;
  ext: string;
  bytes?: number;
  file?: string;
  added?: string;
  by?: string;
  box?: [number, number, number, number];
  w?: number;
  h?: number;
  alpha?: boolean;
  colours?: { hex: string; area: number }[];
  made?: Made | null;
  rel?: { from?: string[]; variants?: string[] };
  [field: string]: unknown;
}

/** An entry as the library returns it: plus its id, media, the shelf it came from and the shelves it shadows. */
export interface AssetRecord extends Entry {
  id: string;
  media: Media;
  shelf: string;
  shadowed: string[];
}

export interface FieldCheck {
  why: string;
  ok: (value: unknown) => boolean;
  opt?: boolean;
}

export interface KindSchema {
  exts: string[];
  box?: boolean;
  fields?: Record<string, FieldCheck>;
}

export const SCHEMAS: Readonly<Record<Kind, KindSchema>>;

export function mediaOf(kind: Kind | string): Media;
export function isLegacySha(sha: unknown): boolean;
/** Everything wrong with an entry, as sentences; [] is valid. `fields` adds or replaces per-kind checks. */
export function validate(id: string, entry: unknown, opts?: { fields?: Partial<Record<Kind, Record<string, FieldCheck>>> }): string[];
/** 64 hex sha256 over some bytes (a string is hashed as utf8). */
export function sha(bytes: string | Uint8Array): string;

/** RGBA pixels a host decoded (skia's ImageData, say). */
export interface Pixels {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}
export type Swatch = { hex: string; area: number };

/** The image type of some bytes by their magic, or null. */
export function imageType(bytes: Uint8Array | string): 'webp' | 'png' | 'jpg' | 'gif' | 'svg' | null;
/** The payload's extension by its magic, or null; `kind` settles a container's names (m4a for audio kinds). */
export function sniff(bytes: Uint8Array | string, kind?: Kind | string): string | null;
/** Type, size and whether the format carries alpha, from a PNG, JPEG, WebP or GIF header alone. */
export function imageInfo(bytes: Uint8Array | string): { type: string; w: number; h: number; alpha: boolean } | null;
/** The top 8 swatches of some RGBA pixels (hdf photo's quantiser): opaque pixels only, biggest area first. */
export function quantise(data: Uint8Array | Uint8ClampedArray): Swatch[];
/** The palette of a decoded image; with `sil`, only the pixels whose centres it encloses (even-odd). */
export function colours(pixels: Pixels, opts?: { sil?: { sub: { pts: number[] }[] } }): Swatch[];

/**
 * A host's probes, each optional, each given the payload as a file. davidup's ffprobe results read as they
 * are (duration, width, height, sampleRate, hasAlpha, hasAudio are renamed); only the kind's fields are kept.
 */
export interface Probes {
  probeVideo?: (file: string) => Promise<object> | object;
  probeAudio?: (file: string) => Promise<object> | object;
  fontMeta?: (file: string) => Promise<object> | object;
  /** A raster's pixels, or a video's representative frame: gives `colours` (and a raster's real `alpha`). */
  pixels?: (file: string, info: { kind: Kind; ext: string }) => Promise<Pixels | null> | Pixels | null;
}

/** What a put is given: an entry to be, named by `id`; sha, ext, media and bytes are derived. */
export type EntryInput = Omit<Entry, 'sha' | 'ext' | 'media'> & { id: string; sha?: string; ext?: string; media?: Media; shelf?: string; shadowed?: string[] };

export interface PutOptions {
  /** Probe results to fill in under the entry's own fields (the library's put passes them). */
  facts?: Record<string, unknown>;
  /** Extra per-kind checks for validate(). */
  fields?: Partial<Record<Kind, Record<string, FieldCheck>>>;
  /** The door it came in by, when the entry does not say. */
  by?: string;
}

export interface PutResult {
  id: string;
  entry: Entry;
  path: string;
  /** The blob was new to the shelf. */
  created: boolean;
}

/** The facts a host's probes give for a payload, and a warning for each probe missing or failed. */
export function probeFacts(entry: EntryInput, bytes: Uint8Array, probes?: Probes): Promise<{ facts: Record<string, unknown>; warnings: string[] }>;

export interface ShelfSpec {
  name: string;
  root: string;
}

export interface Shelf {
  root: string;
  name: string;
  file: string;
  entries: Map<string, Entry>;
  ids: string[];
  has(id: string): boolean;
  entry(id: string): Entry;
  blobPath(entry: string | Entry): string;
  thumbPath(entry: string | Entry): string;
  /** Blobs no entry points at. */
  orphans(): string[];
  /** Thumbs whose sha no entry has. */
  staleThumbs(): string[];
  payload(entry: string | Entry): Uint8Array;
  /** Hash, derive, validate, then write (blob if new, catalogue atomically). Throws, having written nothing, when invalid. */
  put(entry: EntryInput, bytes: Uint8Array | string, opts?: PutOptions): PutResult;
  /** The entry, and its blob and thumb when nothing else shares them; returns the paths deleted. */
  remove(id: string): string[];
  /** Deletes orphan blobs and stale thumbs (`dry` lists them only). */
  gc(opts?: { dry?: boolean }): { path: string; bytes: number }[];
  save(): void;
}

export function readShelf(root: string, opts?: { name?: string }): Shelf;

export function standardShelves(opts?: { project?: string; env?: Record<string, string | undefined>; home?: string }): ShelfSpec[];

export interface Location {
  id: string;
  shelf: string;
  root: string;
  entry: Entry;
  path: string;
  thumb: string;
  shadowed: string[];
}

// ---------- search (A3) ----------

export type Hue = 'warm' | 'cool' | 'neutral' | 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink';
type OneOrMore<T> = T | T[];

/** A search (plan §4.1). Every field is optional; a string is `{ q }`. */
export interface SearchQuery {
  /** Free text: folded, stop words dropped, each word a prefix (a word under 3 letters must be whole). */
  q?: string;
  kind?: OneOrMore<Kind>;
  media?: OneOrMore<Media>;
  shelf?: OneOrMore<string>;
  /** Every tag must be on the record. */
  tags?: OneOrMore<string>;
  licence?: OneOrMore<Licence>;
  alpha?: boolean;
  minW?: number;
  minH?: number;
  /** "16:9", "16/9", "16x9" or w / h; within 2 %. */
  aspect?: string | number;
  secMin?: number;
  secMax?: number;
  /** Mean lightness of `colours` under (true) or at least (false) L* 50. */
  dark?: boolean;
  /** The dominant swatch's band. */
  hue?: OneOrMore<Hue>;
  /** Hits returned (default 20); count and facets cover every match. */
  limit?: number;
  /** Default true. */
  facets?: boolean;
}

export interface ParsedQuery {
  q: string;
  words: string[];
  kind: Kind[] | null;
  media: Media[] | null;
  shelf: string[] | null;
  tags: string[] | null;
  licence: Licence[] | null;
  alpha: boolean | null;
  minW: number | null;
  minH: number | null;
  aspect: number | null;
  secMin: number | null;
  secMax: number | null;
  dark: boolean | null;
  hue: Hue[] | null;
  limit: number;
  facets: boolean;
}

export interface Facets {
  kind: Record<string, number>;
  media: Record<string, number>;
  shelf: Record<string, number>;
  licence: Record<string, number>;
  /** The 30 most common. */
  tags: Record<string, number>;
}

export interface SearchHit<R = AssetRecord> {
  id: string;
  shelf: string;
  score: number;
  /** The field hits ("name: paper", "tags: animal (dog)") and the colour or aspect filters that held. */
  why: string[];
  record: R;
}

export interface LibraryHit extends SearchHit {
  /** The blob. */
  path: string;
  /** The preview, or null until lib.preview has drawn it. */
  thumb: string | null;
}

export interface SearchResult<H = SearchHit> {
  /** Records matching; `hits` is the first `limit` of them. */
  count: number;
  /** Records searched. */
  total: number;
  /** 'hits' when the facets count the matches, 'all' when nothing matched and they count the whole library. */
  facetsOf?: 'hits' | 'all';
  facets?: Facets;
  hits: H[];
}

export interface Scored {
  score: number;
  why?: string[];
}
/** A host's scorer: replaces the built-in one when the query has a `q`. `score()` is the built-in result. */
export type Ranker = (record: AssetRecord | Searchable, query: ParsedQuery, ctx: { score: () => Scored | null }) => Scored | null | undefined;

export const WEIGHTS: Readonly<{ id: 6; name: 5; tags: 4; desc: 2; credit: 1; source: 1; kind: 1; licence: 1 }>;
export const EXACT_ID: number;
export const SYNONYM: number;
export const SYNONYMS: Readonly<Record<string, string[]>>;
export const HUES: readonly Hue[];
export const DARK: number;

export function fold(s: unknown): string;
export function tokenise(s: unknown): string[];
/** ['neutral'] or [band, 'warm' | 'cool'] for a #rrggbb swatch; null for anything else. */
export function hueOf(hex: string): Hue[] | null;
/** Area-weighted mean CIE L* (0..100) of a colours table, or null. */
export function lightness(colours: Swatch[] | undefined): number | null;
export function parseQuery(query?: string | SearchQuery, opts?: { shelves?: string[] }): ParsedQuery;
export function facetsOf(records: Array<Partial<AssetRecord>>): Facets;
export type Searchable = Partial<AssetRecord> & { id: string; kind: Kind };
export interface SearchIndex {
  records: Searchable[];
  words: string[];
  search(query?: string | SearchQuery, opts?: { rank?: Ranker; shelves?: string[] }): SearchResult<SearchHit<Searchable>>;
}
/** A prefix index over some records (the library's winners, or any), for any number of queries. */
export function searchIndex(records: Iterable<Searchable>): SearchIndex;
/** One query over some records, without keeping the index. */
export function search(records: Iterable<Searchable>, query?: string | SearchQuery, opts?: { rank?: Ranker; shelves?: string[] }): SearchResult<SearchHit<Searchable>>;

// ---------- previews (A4) ----------

export const PREVIEW_VERSION: number;
/** The width a previewer is asked for. */
export const PREVIEW_WIDTH: 480;
export const CARD_W: 480;
export const CARD_H: 320;
/** The PNG tEXt keyword a thumb's tag lives under: "preview <version> <by>". */
export const TAG_KEY: 'assetlib';
/** Where thumbs go for a shelf that cannot be written (openLibrary's `thumbCache` names another). */
export const THUMB_CACHE: string;

export type PngBytes = Uint8Array;
/** Turns a blob into PNG bytes PREVIEW_WIDTH wide. Given the blob's path and the record. */
export type PreviewFn = (file: string, record: AssetRecord, opts: { width: number }) => PngBytes | Promise<PngBytes>;
/** A host's previewer: a function (tagged `host`), or named and versioned (tagged `name@version`). */
export type Previewer = PreviewFn | { name?: string; version?: string | number; render: PreviewFn };
export type Previewers = Partial<Record<Kind, Previewer>>;

export interface Preview {
  id: string;
  shelf: string;
  /** The thumb: the shelf's thumbs/<sha>.png, the thumb cache, or null when neither could be written. */
  path: string | null;
  png: Buffer;
  /** Who drew it: `card:<hash>`, `host`, or `name@version`. */
  by: string;
  /** The thumb already answered; nothing was drawn. */
  cached: boolean;
  warnings: string[];
}

export interface SheetCell {
  id: string;
  shelf?: string;
  /** The picture's box in the sheet (its caption runs under it). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sheet {
  png: Buffer;
  width: number;
  height: number;
  cols: number;
  rows: number;
  cells: SheetCell[];
}

/** RGBA pixels as a PNG, with `text` as tEXt chunks. */
export function encodePng(pixels: Pixels, opts?: { text?: Record<string, string> }): Buffer;
/** Any non-interlaced PNG as 8-bit RGBA. */
export function decodePng(bytes: Uint8Array): { data: Uint8ClampedArray; width: number; height: number };
export function pngText(bytes: Uint8Array): Record<string, string>;
/** The same PNG with `text` as tEXt chunks after IHDR (same keyword replaced), pixels untouched. */
export function withText(bytes: Uint8Array, text: Record<string, string>): Buffer;
/** A thumb's tag, or null. */
export function tagOf(bytes: Uint8Array): { v: number; by: string } | null;
/** Whether a cached thumb's tag still answers for a record given the kind's previewer (normalised, or null). */
export function fresh(tag: { v: number; by: string } | null, record: Partial<AssetRecord>, previewer: { name: string; by: string } | null): boolean;
/** The fallback card: CARD_W x CARD_H PNG bytes, tagged with cardKey(record). */
export function card(record: Partial<AssetRecord> & { id: string; kind: Kind | string }): Buffer;
/** `card:<10 hex>` over what the card letters and paints. */
export function cardKey(record: Partial<AssetRecord>): string;
/** The line of facts a card letters: "815×739 · alpha", "12.5 s · 1280×720 · 30 fps". */
export function factsOf(record: Partial<AssetRecord>): string;
/** Text as the built-in bitmap font letters it: folded, upper case, '?' for what it has no glyph for. */
export function lettering(s: string): string;
/** Pixels tiled `cols` across (default √n rounded up), each over its id. */
export function contactSheet(items: { id: string; pixels: Pixels }[], opts?: { cols?: number; cell?: number; gap?: number }): Sheet;

export interface Library {
  shelves: Shelf[];
  ids: string[];
  shelf(name: string): Shelf;
  /** An id, or `sha:<hex>` with 12+ hex. */
  has(ref: string): boolean;
  locate(ref: string): Location;
  get(ref: string): AssetRecord;
  resolve(ref: string): string;
  holders(hex: string): { shelf: string; id: string }[];
  /** Ranked, filtered, explained, over the winning records (plan §4). */
  search(query?: string | SearchQuery): SearchResult<LibraryHit>;
  /** The cached thumb while it answers, else the kind's previewer, else the card; written to thumbs/<sha>.png. */
  preview(ref: string, opts?: { previewers?: Previewers; force?: boolean }): Promise<Preview>;
  /** One contact sheet of some refs' previews with id captions; `out` also writes it. Unknown refs reject. */
  sheet(refs: string | string[], opts?: { cols?: number; cell?: number; previewers?: Previewers; force?: boolean; out?: string }): Promise<Sheet & { path: string | null; cells: (SheetCell & { shelf: string })[]; warnings: string[] }>;
  /** Probe, then put on `shelf` (null: the project, else the user's pool). Rejects, having written nothing, when invalid. */
  put(shelf: string | null, entry: EntryInput, bytes: Uint8Array | string, opts?: { probes?: Probes; fields?: PutOptions['fields']; by?: string }): Promise<PutResult & { shelf: string; warnings: string[] }>;
  remove(id: string, opts?: { shelf?: string }): { id: string; shelf: string; removed: string[] };
  /** Blob, thumb and entry to `to` (rehashed sha256, validated), then removed from where it was. */
  move(id: string, to: string, opts?: { from?: string; fields?: PutOptions['fields'] }): { id: string; from: string; to: string; entry: Entry; path: string };
  gc(opts?: { shelf?: string; dry?: boolean }): { shelf: string; path: string; bytes: number }[];
}

export function openLibrary(opts?: { shelves?: ShelfSpec[]; rank?: Ranker; previewers?: Previewers; thumbCache?: string }): Library;
