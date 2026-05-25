// Server AssetLoader — wraps skia-canvas's loadImage + FontLibrary.
//
// skia-canvas is loaded lazily so this module is importable in environments
// where the native binary is not installed (the engine itself never imports
// from here — only the node driver does). Tests inject a fake module.

import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import type { FontAsset, ImageAsset } from "../schema/types.js";
import { BaseAssetLoader, type LoadedImage } from "./loader.js";

export interface SkiaCanvasModule {
  loadImage: (src: string) => Promise<LoadedImage>;
  FontLibrary: {
    use: (family: string, paths: string | ReadonlyArray<string>) => unknown;
  };
}

export interface NodeAssetLoaderOptions {
  // Inject a pre-imported skia-canvas (or compatible shim) — tests use this to
  // avoid the native build. When omitted, the loader dynamic-imports it on
  // first use.
  skiaCanvas?: SkiaCanvasModule;
  // Override the global library root for `global:` srcs. Tests pass this so
  // they don't depend on $HOME / $DAVIDUP_LIBRARY at import time. When
  // omitted, resolves env → ~/.davidup/library on each call.
  globalLibraryRoot?: string;
}

export class NodeAssetLoader extends BaseAssetLoader {
  private readonly injected: SkiaCanvasModule | undefined;
  private readonly globalLibraryRootOverride: string | undefined;
  private skiaPromise: Promise<SkiaCanvasModule> | undefined;

  constructor(options: NodeAssetLoaderOptions = {}) {
    super();
    this.injected = options.skiaCanvas;
    this.globalLibraryRootOverride = options.globalLibraryRoot;
  }

  protected async fetchImage(asset: ImageAsset): Promise<LoadedImage> {
    const skia = await this.getSkia();
    return skia.loadImage(this.resolveSrc(asset.src));
  }

  protected async fetchFont(asset: FontAsset): Promise<string> {
    const skia = await this.getSkia();
    skia.FontLibrary.use(asset.family, [this.resolveSrc(asset.src)]);
    return asset.family;
  }

  private resolveSrc(src: string): string {
    return resolveGlobalSrc(src, this.globalLibraryRootOverride);
  }

  private getSkia(): Promise<SkiaCanvasModule> {
    if (this.injected) return Promise.resolve(this.injected);
    this.skiaPromise ??= importSkiaCanvas();
    return this.skiaPromise;
  }
}

/**
 * Resolve an asset `src` to a filesystem path the way the Node loader does.
 *
 * `global:<rest>` → an absolute path under the global library root
 * ($DAVIDUP_LIBRARY, default ~/.davidup/library). Any other `src` is returned
 * unchanged (skia-canvas and ffmpeg both accept plain filesystem paths).
 *
 * Shared with the audio mux pipeline (v0.2 §S4), which needs the same
 * resolution to hand audio asset paths to ffmpeg.
 */
export function resolveGlobalSrc(src: string, globalLibraryRoot?: string): string {
  if (src.startsWith("global:")) {
    const rest = src.slice("global:".length).replace(/^\/+/, "");
    return nodePath.join(globalLibraryRoot ?? defaultGlobalLibraryRoot(), rest);
  }
  return src;
}

/** Env-or-default global library root: $DAVIDUP_LIBRARY, else ~/.davidup/library. */
export function defaultGlobalLibraryRoot(): string {
  const override = process.env.DAVIDUP_LIBRARY;
  if (override && override.length > 0) return override;
  return nodePath.join(nodeOs.homedir(), ".davidup", "library");
}

function importSkiaCanvas(): Promise<SkiaCanvasModule> {
  // Indirect specifier so bundlers (e.g., Vite) don't try to resolve it for
  // browser builds. The node driver is the only intended consumer.
  const specifier = "skia-canvas";
  return (Function("s", "return import(s)") as (s: string) => Promise<SkiaCanvasModule>)(
    specifier,
  );
}
