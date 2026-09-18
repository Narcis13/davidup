// Bundled starter font (R-30, v1.1 S24).
//
// A fresh standalone MCP session used to have zero fonts, so `add_text`
// needed a `register_asset` against a .ttf the agent had to find on disk
// first. The package now ships `fonts/Inter-Regular.ttf` (OFL, Latin subset)
// and every composition can reference it through the virtual asset id
// `font:default` without registering anything.
//
// The asset is virtual: it never gets written into `comp.assets`. Callers that
// preload a composition's assets go through `withBundledAssets()`, which
// appends the default font only when a text item actually references it and
// the composition hasn't defined its own `font:default`. Compositions that
// don't use it load exactly the assets they did before, so goldens are
// untouched and the bundled "Inter" family never shadows a user-registered one.
//
// Its `src` is the symbolic `bundled:<file>`; each loader resolves that prefix
// to wherever the package's `fonts/` directory lives on its platform.

import type { Asset, Composition, FontAsset } from "../schema/types.js";

export const DEFAULT_FONT_ID = "font:default";
export const DEFAULT_FONT_FAMILY = "Inter";
export const BUNDLED_SRC_PREFIX = "bundled:";
export const DEFAULT_FONT_FILE = "Inter-Regular.ttf";

export const DEFAULT_FONT_ASSET: Readonly<FontAsset> = Object.freeze({
  id: DEFAULT_FONT_ID,
  type: "font",
  family: DEFAULT_FONT_FAMILY,
  src: `${BUNDLED_SRC_PREFIX}${DEFAULT_FONT_FILE}`,
});

/** True if `id` names the virtual bundled font (and `assets` doesn't override it). */
export function isBundledFontId(id: string, assets: ReadonlyArray<Asset>): boolean {
  return id === DEFAULT_FONT_ID && !assets.some((a) => a.id === DEFAULT_FONT_ID);
}

/**
 * `comp.assets` plus the bundled default font when a text item references
 * `font:default` and the composition doesn't define that id itself. Pass the
 * result to `AssetLoader.preloadAll` in place of `comp.assets`.
 */
export function withBundledAssets(
  comp: Pick<Composition, "assets" | "items">,
): ReadonlyArray<Asset> {
  if (comp.assets.some((a) => a.id === DEFAULT_FONT_ID)) return comp.assets;
  const referenced = Object.values(comp.items).some(
    (item) => item.type === "text" && item.font === DEFAULT_FONT_ID,
  );
  return referenced ? [...comp.assets, DEFAULT_FONT_ASSET] : comp.assets;
}

/** The file name a `bundled:<file>` src points at, or undefined for any other src. */
export function bundledFileName(src: string): string | undefined {
  if (!src.startsWith(BUNDLED_SRC_PREFIX)) return undefined;
  const name = src.slice(BUNDLED_SRC_PREFIX.length).replace(/^\/+/, "");
  // Only plain file names inside fonts/ — no path traversal out of the package.
  if (name.length === 0 || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return undefined;
  }
  return name;
}
