// AssetLoader contract + cached abstract base (per design-doc §5.5).
//
// An AssetLoader satisfies the engine's AssetRegistry — drivers preload the
// composition's assets once, then pass the loader straight to renderFrame.
//
// The base class memoizes by asset id and dedupes concurrent loads of the same
// id. Subclasses only implement the platform-specific fetch hooks.

import type { AssetRegistry } from "../engine/types.js";
import type { Asset, FontAsset, ImageAsset } from "../schema/types.js";

// Loaded image is opaque — browser hands back HTMLImageElement, node hands
// back skia-canvas's Image. drawImage on either Canvas2D context accepts both.
export type LoadedImage = unknown;

export interface AssetLoader extends AssetRegistry {
  load(asset: Asset): Promise<void>;
  preloadAll(assets: ReadonlyArray<Asset>): Promise<void>;
  has(id: string): boolean;
  clear(): void;
}

export abstract class BaseAssetLoader implements AssetLoader {
  protected readonly images = new Map<string, LoadedImage>();
  protected readonly fonts = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<void>>();

  async preloadAll(assets: ReadonlyArray<Asset>): Promise<void> {
    await Promise.all(assets.map((asset) => this.load(asset)));
  }

  load(asset: Asset): Promise<void> {
    if (this.has(asset.id)) return Promise.resolve();
    const existing = this.inflight.get(asset.id);
    if (existing) return existing;

    const promise =
      asset.type === "image"
        ? this.fetchImage(asset).then((img) => {
            this.images.set(asset.id, img);
          })
        : this.fetchFont(asset).then((family) => {
            this.fonts.set(asset.id, family);
          });

    const tracked = promise.finally(() => {
      this.inflight.delete(asset.id);
    });
    this.inflight.set(asset.id, tracked);
    return tracked;
  }

  has(id: string): boolean {
    return this.images.has(id) || this.fonts.has(id);
  }

  clear(): void {
    this.images.clear();
    this.fonts.clear();
    this.inflight.clear();
  }

  getImage(id: string): LoadedImage | undefined {
    return this.images.get(id);
  }

  getFontFamily(id: string): string | undefined {
    return this.fonts.get(id);
  }

  protected abstract fetchImage(asset: ImageAsset): Promise<LoadedImage>;
  protected abstract fetchFont(asset: FontAsset): Promise<string>;
}
