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
  orphans(): string[];
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
}

export function openLibrary(opts?: { shelves?: ShelfSpec[] }): Library;
