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

/** How an asset made by our own tools was made, so `asset remake` can re-run it (I1). */
export interface Made {
  /** The tool that made it: the key `asset remake` finds its maker by (`hdf render`, `hdf sprite`...). */
  tool: string;
  /** The ids it was made from. */
  from?: string[];
  /** What makes it again. */
  args?: Record<string, unknown>;
  /** When, an ISO time. */
  at?: string;
  /** The maker's version, set by a remake. */
  version?: number | string;
}
/** The keys a `made` block may have. */
export const MADE_KEYS: readonly ['tool', 'from', 'args', 'at', 'version'];

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
  /** Mean luma of the pixels (a video's frame) under 0.4, measured at put (D6). */
  dark?: boolean;
  /** Edge density 0..1 in each third of the frame (D6); under ROOM is quiet enough to letter on. */
  room?: Room;
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
/** The fields the bytes decide (kind, media, sha, ext, bytes): update() refuses them. */
export const FROM_BYTES: readonly string[];

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

/** A third of the frame: top-left, top, top-right / left, centre, right / bottom-left, bottom, bottom-right. */
export type RoomCell = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';
export type Room = Record<RoomCell, number>;
/** What a `room` filter names: a third, or a side (top: tl t tr). */
export type RoomRegion = RoomCell | 'top' | 'bottom' | 'left' | 'right';
export const ROOM_CELLS: readonly RoomCell[];
export const ROOM_REGIONS: Readonly<Record<RoomRegion, RoomCell[]>>;
/** A cell busier than this is not room (0.2). */
export const ROOM: number;
/** `dark` is a mean luma under this (0.4). */
export const DARK_LUMA: number;
/** Frames are averaged down to this on the longer side before edges are found. */
export const ROOM_SIZE: number;
/** The pixels' mean luma (Rec. 709 over sRGB, 0..1) counted by alpha, or null when all are transparent. */
export function meanLuma(pixels: Pixels): number | null;
/** The 3×3 grid of edge density, 0..1 to 2 places. */
export function roomOf(pixels: Pixels): Room;
/** { dark, room }; `dark` left out when every pixel is transparent. */
export function lightFacts(pixels: Pixels): { dark?: boolean; room: Room };

/**
 * A host's probes, each optional, each given the payload as a file. davidup's ffprobe results read as they
 * are (duration, width, height, sampleRate, hasAlpha, hasAudio are renamed); only the kind's fields are kept.
 */
export interface Probes {
  probeVideo?: (file: string) => Promise<object> | object;
  probeAudio?: (file: string) => Promise<object> | object;
  fontMeta?: (file: string) => Promise<object> | object;
  /** A raster's pixels: gives `colours`, `dark`, `room` (and a raster's real `alpha`). */
  pixels?: (file: string, info: { kind: Kind; ext: string }) => Promise<Pixels | null> | Pixels | null;
  /** A video's frame at `at` seconds (1, or half a shorter video), as pixels or PNG bytes: gives `colours`, `dark`, `room`. */
  extractFrame?: (file: string, info: { at: number; kind: Kind; ext: string }) => Promise<Pixels | Uint8Array | null> | Pixels | Uint8Array | null;
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
export function probeFacts(entry: EntryInput, bytes: Uint8Array, probes?: Probes, opts?: { pixelsOnly?: boolean }): Promise<{ facts: Record<string, unknown>; warnings: string[] }>;
/** The facts read off pixels: colours, dark, room. */
export const PIXEL_FACTS: readonly ['colours', 'dark', 'room'];
/** Where a video's representative frame is taken, in seconds (half way through a shorter one). */
export const FRAME_AT: number;

/** The probes assetlib has itself (probe.js): WAV headers, ffprobe for video and other audio, font tables, a PNG's pixels, ffmpeg for a video's frame. */
export function defaultProbes(opts?: { ffprobe?: string; ffmpeg?: string }): Required<Probes>;

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
  /** An entry's own fields in place, validated whole; the blob untouched. FROM_BYTES are refused; null removes a field. */
  update(id: string, patch: Partial<Record<string, unknown>>, opts?: { fields?: PutOptions['fields'] }): { id: string; entry: Entry };
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
  /** The record's measured `dark` (D6); for a record with only a palette, its mean L* under 50. */
  dark?: boolean;
  /** The dominant swatch's band. */
  hue?: OneOrMore<Hue>;
  /** Thirds (or sides) that must be quiet, each cell under ROOM; filters alone then list the quietest first. */
  room?: OneOrMore<RoomRegion>;
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
  room: RoomRegion[] | null;
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
  /** The exact call that brings it into each app (A5). */
  use: Use;
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

// ---------- the use block (use.js, A5) ----------

export type DavidupType = 'image' | 'video' | 'audio' | 'font';
/** The davidup asset type of each kind; null for puppet, hand, motif and clip. */
export const DAVIDUP_TYPE: Readonly<Record<Kind, DavidupType | null>>;
/** What davidup takes in place of a puppet, hand or motif, best first (tests over the records made from it). */
export const DAVIDUP_VIA: Readonly<Partial<Record<Kind, ((record: AssetRecord) => boolean)[]>>>;
/** The hex a pin keeps: 12. */
export const PIN: number;
/** `asset:<id>@<sha12>`. */
export function assetSrc(record: { id: string; sha: string }): string;
/** Newest `added` first, then by id. */
export function newest(a: { id: string; added?: string }, b: { id: string; added?: string }): number;

/** register_asset's input for a library record (src/mcp/tools.ts). */
export interface RegisterAssetArgs {
  id: string;
  type: DavidupType;
  /** `asset:<id>@<sha12>`. */
  src: string;
  /** A font's family. */
  family?: string;
  /** An image's sprite sheet, when the record carries one. */
  sheet?: Record<string, unknown>;
  /** Left out when the record's is empty. */
  credit?: string;
  licence?: Licence;
}

export interface DavidupUse {
  tool: 'register_asset';
  args: RegisterAssetArgs;
  /** For a puppet, hand or motif: the id of the record made from it that `args` registers. */
  via?: string;
  /** Other records made from it davidup could take instead. */
  also?: string[];
}

export interface HdfUse {
  /** What the film's `assets:` names: the id, or { id, from } off hdf's own store. */
  assets?: (string | { id: string; from: string })[];
  /** The line at the top of the film that reads it: `fromStore(['teapot'])`. */
  code?: string;
  /** The expression that puts it to work: `actorOf(puppet('fox'))`, `clipFromStore('horse')`, `voice('moon-look', 0)`. */
  take?: string;
  /** A look reading it: `paperInk~hand:<id>`, `doodlePastel~from:<id>`. */
  look?: string;
  /** For a font: `hdf hand --font <blob> --name <id> ...`. */
  cli?: string;
}

export interface Use {
  davidup: DavidupUse | null;
  hdf: HdfUse | null;
}

export interface UseOptions {
  /** The records made from this one (made.from names its id). */
  made?: Partial<AssetRecord>[];
  /** The shelf the record is on. */
  root?: string;
  /** The store hdf reads with no `from` (the house shelf); a record on any other root is read with `{ from }`. */
  store?: string;
  /** The blob (a font's `hdf hand --font` source). */
  path?: string;
}

type UsableRecord = Partial<AssetRecord> & { id: string; kind: Kind; sha: string };
export function useOf(record: UsableRecord, opts?: UseOptions): Use;
export function davidupUse(record: UsableRecord, opts?: UseOptions): DavidupUse | null;
export function hdfUse(record: UsableRecord, opts?: UseOptions): HdfUse | null;

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
  /** The records made from a ref (made.from names its id), over the winning records, newest first. */
  made(ref: string): AssetRecord[];
  /** The exact call that brings a ref into each app (use.js), with the records made from it. */
  use(ref: string): Use;
  /** Ranked, filtered, explained, over the winning records (plan §4); every hit carries its `use`. */
  search(query?: string | SearchQuery): SearchResult<LibraryHit>;
  /** The cached thumb while it answers, else the kind's previewer, else the card; written to thumbs/<sha>.png. */
  preview(ref: string, opts?: { previewers?: Previewers; force?: boolean }): Promise<Preview>;
  /** One contact sheet of some refs' previews with id captions; `out` also writes it. Unknown refs reject. */
  sheet(refs: string | string[], opts?: { cols?: number; cell?: number; previewers?: Previewers; force?: boolean; out?: string }): Promise<Sheet & { path: string | null; cells: (SheetCell & { shelf: string })[]; warnings: string[] }>;
  /** Probe, then put on `shelf` (null: the project, else the user's pool). Rejects, having written nothing, when invalid. */
  put(shelf: string | null, entry: EntryInput, bytes: Uint8Array | string, opts?: { probes?: Probes; fields?: PutOptions['fields']; by?: string }): Promise<PutResult & { shelf: string; warnings: string[] }>;
  /** A record's own fields (tags, desc, credit...) on `shelf` (default: where it resolves), validated; the blob untouched. */
  update(id: string, patch: Partial<Record<string, unknown>>, opts?: { shelf?: string; fields?: PutOptions['fields'] }): { id: string; shelf: string; entry: Entry };
  /** colours, dark and room read off the blob of a raster or video that lacks them (all three with `force`), written in place. */
  refresh(id: string, opts?: { shelf?: string; probes?: Probes; force?: boolean; fields?: PutOptions['fields'] }): Promise<{ id: string; shelf: string; entry: Entry; changed: string[]; warnings: string[] }>;
  remove(id: string, opts?: { shelf?: string }): { id: string; shelf: string; removed: string[] };
  /** Blob, thumb and entry to `to` (rehashed sha256, validated), then removed from where it was. */
  move(id: string, to: string, opts?: { from?: string; fields?: PutOptions['fields'] }): { id: string; from: string; to: string; entry: Entry; path: string };
  gc(opts?: { shelf?: string; dry?: boolean }): { shelf: string; path: string; bytes: number }[];
}

export function openLibrary(opts?: { shelves?: ShelfSpec[]; rank?: Ranker; previewers?: Previewers; thumbCache?: string }): Library;

// ---------- check (A6) ----------

export type CheckLevel = 'error' | 'warn' | 'note';
export type CheckRule = 'id' | 'invalid' | 'blob' | 'sha' | 'size' | 'ignored' | 'budget' | 'sha1' | 'licence' | 'credit' | 'made' | 'duplicate' | 'shadow' | 'orphan' | 'thumb' | 'desc' | 'tags' | 'legacy';
export interface Finding {
  level: CheckLevel;
  rule: CheckRule;
  /** The shelf; `library` for a legacy file (davidup's old library root). */
  shelf: string;
  /** The entry it is about; null for an orphan blob, a legacy file (then `path`) or the house budget. */
  id: string | null;
  detail: string;
  path?: string;
  /** A legacy file's davidup kind by extension, or null when it is none. */
  kind?: Kind | null;
  /** A legacy file's `asset add` line (null when its kind is none). */
  add?: string | null;
}
export const LEVELS: readonly CheckLevel[];
/** Each rule's level. */
export const RULES: Readonly<Record<CheckRule, CheckLevel>>;
/** What is wrong with a library's shelves (or the ones named), errors first; reads every blob once, writes nothing. */
export function check(lib: Library, opts?: { shelves?: string[]; fields?: PutOptions['fields']; thumbCache?: string; legacy?: string; house?: true | HouseLimits }): Finding[];
/** The house shelf's limits (H4): a blob over `maxBlob` ships only if not at all (made and git-ignored); what ships stays under `budget`. */
export interface HouseLimits {
  maxBlob?: number;
  budget?: number;
  /** Which of `paths` (files under `root`) git ignores; gitIgnored unless given. */
  ignored?: (root: string, paths: string[]) => Set<string>;
}
/** 5 MB: the largest blob the house shelf ships. */
export const HOUSE_BLOB_MAX: number;
/** 15 MB: what the house shelf's shipped blobs may weigh in all. */
export const HOUSE_BUDGET: number;
/** The paths among `paths` that git ignores, by one `git check-ignore` run in `root`; none outside a work tree. */
export function gitIgnored(root: string, paths: string[]): Set<string>;
/** The size rules on one shelf: its `size`, `ignored` and `budget` findings, and the blobs that ship and what they weigh. */
export function houseFindings(shelf: Shelf, limits?: HouseLimits): { findings: Finding[]; bytes: number; blobs: number; budget: number };
/** davidup's old library directories whose loose files `check --legacy` offers for import (D5). */
export const LEGACY_DIRS: readonly string[];
/** A `legacy` note for every file under <root>/assets and <root>/fonts whose bytes are on no shelf, with its `asset add` line. */
export function legacyFindings(lib: Library, root: string): Finding[];

// ---------- migrate (H1) ----------

export interface MigratedBlob {
  /** The sha1 the blob was named by. */
  from: string;
  /** Its sha256: of the same bytes, or of a JSON payload whose sha1 references were rewritten. */
  to: string;
  ext: string;
  /** The entries that share the blob. */
  ids: string[];
  /** The sha1s this JSON payload named and now names by their sha256. */
  rewrote: string[];
}
export interface Migration {
  shelf: string;
  blobs: MigratedBlob[];
  /** sha1 -> sha256, for what outside the shelf names a sha (hdf's packs/manifest.json). */
  map: Record<string, string>;
  /** Old blobs and thumbs deleted. */
  removed: string[];
}
/** Rehashes every sha1 entry of a shelf as sha256: blobs renamed, not re-encoded; `dry` writes nothing. */
export function migrateSha256(shelf: Shelf, opts?: { dry?: boolean }): Migration;

// ---------- hosts (H3) ----------

/** A payload's per-kind fields, read off it by a host (hdf traces a cutout's silhouette, lints a puppet). */
export type Derive = (bytes: Uint8Array, ctx: { file?: string; entry: EntryInput }) => Record<string, unknown> | Promise<Record<string, unknown>>;
/** What a host hands addAsset for a payload of a kind it knows: its derive, its checks, its probes. */
export interface AddSide {
  derive?: Derive | Partial<Record<Kind, Derive>>;
  fields?: PutOptions['fields'];
  probes?: Probes;
}
/** addAsset's `host` for one kind (addHost): what the hosts' `adds` loaded, keyed as addAsset reads it. */
export interface AddHost {
  derive?: Partial<Record<Kind, Derive>>;
  fields?: PutOptions['fields'];
  probes?: Probes;
}
/** Per kind, the host's add side, loaded on the first add (D3). */
export type Adds = Partial<Record<Kind, () => Promise<AddSide>>>;

/** What a maker resolves to: the payload (`bytes`, else read from `file`), the ids it was made from this time, and fields only it knows. */
export interface MakerOutput {
  bytes?: Uint8Array;
  /** The payload's path (read when there are no bytes), or with bytes its name. */
  file?: string;
  ext?: string;
  from?: string[];
  fields?: Record<string, unknown>;
  warnings?: string[];
}
/** How `asset remake` makes a record again, registered by a host under the `made.tool` it answers for (I1). */
export type MakeFn = (record: AssetRecord & { shelf: string }, ctx: { lib: Library; shelf: string; root: string }) => Promise<MakerOutput> | MakerOutput;
export type Maker = MakeFn | { version?: number | string; make: MakeFn };
export type Makers = Record<string, Maker>;
/** A maker as remake runs it, or throws saying what a maker is. */
export function maker(m: unknown, tool?: string): { version: number | string | undefined; make: MakeFn };

/** An app that draws some kinds: a module whose default export (or the module) is this. */
export interface Host {
  name?: string;
  previewers?: Previewers;
  adds?: Adds;
  makers?: Makers;
}
export interface LoadedHosts {
  hosts: { name: string; file: string; kinds: string[]; adds: string[]; makers: string[] }[];
  /** Every host's previewers merged, later hosts taking a kind from earlier ones: pass to openLibrary. */
  previewers: Previewers;
  /** Every host's add sides merged the same way: addHost(adds, kind) for addAsset. */
  adds: Adds;
  /** Every host's makers merged the same way, by tool: for remake. */
  makers: Makers;
  /** A host on disk that did not load, or registered something that is not a previewer. */
  warnings: string[];
}
/** The hosts next to this package in the repo (hdf's handdrawn/cli/host.mjs); one not on disk is skipped. */
export const KNOWN_HOSTS: string[];
/** Loads KNOWN_HOSTS (`known` replaces them) and the modules $ASSETLIB_HOSTS names ('-' first: those alone). */
export function loadHosts(opts?: { env?: Record<string, string | undefined>; known?: string[]; cwd?: string }): Promise<LoadedHosts>;
/** addAsset's host for a payload of `kind` (its derive, checks and probes), or {} when no host adds the kind. */
export function addHost(adds: Adds | undefined, kind: Kind | string): Promise<AddHost>;

// ---------- remake (I1) ----------

/** The fields a remake keeps although its kind's schema lists them (a font's family, a clip's track). */
export const KEPT: readonly string[];
/** An entry as a remake hands it on: the fields its old bytes decided dropped. */
export function recipeOf(entry: Entry): Partial<Entry>;
export interface RemakeResult {
  id: string;
  shelf: string;
  tool: string;
  /** The sha before. */
  was: string;
  /** The sha now. */
  sha: string;
  changed: boolean;
  entry: Entry;
  path: string;
  /** The old blob and thumb, when nothing else on the shelf held them. */
  removed: string[];
  warnings: string[];
}
/**
 * Makes a ref again with the maker for its `made.tool` and puts the new bytes in place on its shelf (the facts read
 * off them, `made` stamped with `at` and the maker's version). Rejects, the shelf untouched, when nothing made
 * it, no maker answers for its tool, or the maker fails.
 */
export function remake(lib: Library, ref: string, opts?: { makers?: Makers; shelf?: string; host?: import('./add.js').AddAssetHost }): Promise<RemakeResult>;
