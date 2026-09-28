// Types for assetlib/add.js: the one way in, as a host calls it (davidup's add_asset, D3). cli.js re-exports it.

import type { Adds, Derive, Entry, EntryInput, Kind, Library, Probes, PutOptions } from './index.js';

/** A name as an id: "Warm paper" -> "warm-paper". */
export function idOf(name: string): string;
/** The per-kind fields `asset add` reads off a payload itself. */
export const DERIVE: Readonly<Partial<Record<Kind, Derive>>>;

/** What a host passes addAsset: what it knows better than assetlib. */
export interface AddAssetHost {
  probes?: Probes;
  derive?: Partial<Record<Kind, Derive>>;
  fields?: PutOptions['fields'];
  /** Hosts' add sides by kind (loadHosts().adds): loaded for the kind being added. */
  adds?: Adds;
  /** The door an add came in by (kept on the entry as `by`). */
  by?: string;
}

export interface AddAssetResult {
  id: string;
  shelf: string;
  entry: Entry;
  path: string;
  /** The blob was new to the shelf. */
  created: boolean;
  /** The entry the id had on that shelf before, or null. */
  replaced: Entry | null;
  warnings: string[];
}

/**
 * The one way in: the kind's derived fields (the host's, else DERIVE; the entry's own win), then `extra`,
 * then probed, validated and written on `shelf` (default: the only shelf, else the project, else the user's).
 */
export function addAsset(
  lib: Library,
  input: { bytes: Uint8Array; file?: string; entry: EntryInput; extra?: Record<string, unknown>; shelf?: string },
  host?: AddAssetHost,
): Promise<AddAssetResult>;
