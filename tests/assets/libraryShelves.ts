// Temp asset-library shelves for the D1 tests (docs/asset-library-plan.md):
// a project dir with `assets/`, a user pool and a house shelf, each written
// through assetlib's own put so the catalogue is what the library writes.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, readShelf, type EntryInput } from "../../assetlib/index.js";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A w×h opaque PNG of one colour. */
export function solidPng(rgb: [number, number, number], w = 2, h = 2): Buffer {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return encodePng({ data, width: w, height: h });
}
export const RED_PNG = solidPng([255, 0, 0]);
export const BLUE_PNG = solidPng([0, 0, 255]);

export interface Shelves {
  /** The project directory; its shelf is `<project>/assets`. */
  project: string;
  user: string;
  house: string;
  /** `DAVIDUP_ASSETS` / `DAVIDUP_HOUSE` pointing at the temp user and house shelves. */
  env: Record<string, string>;
  cleanup(): void;
}

export function makeShelves(): Shelves {
  const base = mkdtempSync(join(tmpdir(), "davidup-shelves-"));
  const project = join(base, "project");
  const user = join(base, "user");
  const house = join(base, "house");
  for (const d of [join(project, "assets"), user, house]) mkdirSync(d, { recursive: true });
  return {
    project,
    user,
    house,
    env: { DAVIDUP_ASSETS: user, DAVIDUP_HOUSE: house },
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/** Put a payload on a shelf root; returns the entry's sha. */
export function put(
  root: string,
  entry: Partial<EntryInput> & { id: string; kind: EntryInput["kind"] },
  bytes: Uint8Array | string,
): string {
  const out = readShelf(root).put(
    { name: entry.id, tags: [], licence: "own", credit: "", source: "", ...entry } as EntryInput,
    bytes,
    { by: "test" },
  );
  return out.entry.sha;
}

/** Put the package's bundled Inter as a font record. */
export function putFont(root: string, id: string, family: string): string {
  return put(root, { id, kind: "font", family }, readFileSync(join(repoRoot, "fonts", "Inter-Regular.ttf")));
}
