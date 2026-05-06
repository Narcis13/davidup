// Server AssetLoader — wraps skia-canvas's loadImage + FontLibrary.
//
// skia-canvas is loaded lazily so this module is importable in environments
// where the native binary is not installed (the engine itself never imports
// from here — only the node driver does). Tests inject a fake module.

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
}

export class NodeAssetLoader extends BaseAssetLoader {
  private readonly injected: SkiaCanvasModule | undefined;
  private skiaPromise: Promise<SkiaCanvasModule> | undefined;

  constructor(options: NodeAssetLoaderOptions = {}) {
    super();
    this.injected = options.skiaCanvas;
  }

  protected async fetchImage(asset: ImageAsset): Promise<LoadedImage> {
    const skia = await this.getSkia();
    return skia.loadImage(asset.src);
  }

  protected async fetchFont(asset: FontAsset): Promise<string> {
    const skia = await this.getSkia();
    skia.FontLibrary.use(asset.family, [asset.src]);
    return asset.family;
  }

  private getSkia(): Promise<SkiaCanvasModule> {
    if (this.injected) return Promise.resolve(this.injected);
    this.skiaPromise ??= importSkiaCanvas();
    return this.skiaPromise;
  }
}

function importSkiaCanvas(): Promise<SkiaCanvasModule> {
  // Indirect specifier so bundlers (e.g., Vite) don't try to resolve it for
  // browser builds. The node driver is the only intended consumer.
  const specifier = "skia-canvas";
  return (Function("s", "return import(s)") as (s: string) => Promise<SkiaCanvasModule>)(
    specifier,
  );
}
