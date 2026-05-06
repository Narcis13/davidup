// Browser AssetLoader — uses the DOM Image element and the FontFace API.
//
// Image: a plain Image element ends up cached. drawImage(image, ...) accepts
// HTMLImageElement once it has fired `load`, so we resolve only after that.
// FontFace: load + add to document.fonts so subsequent ctx.font lookups find
// the family. Crossorigin is set to "anonymous" so canvas stays untainted.

import type { FontAsset, ImageAsset } from "../schema/types.js";
import { BaseAssetLoader } from "./loader.js";

export interface BrowserAssetLoaderOptions {
  // Document used for FontFace registration. Defaults to globalThis.document.
  document?: Document;
  // Optional base URL prepended to relative asset srcs. Useful when assets
  // live on a separate origin from the page.
  baseUrl?: string;
}

export class BrowserAssetLoader extends BaseAssetLoader {
  private readonly options: BrowserAssetLoaderOptions;

  constructor(options: BrowserAssetLoaderOptions = {}) {
    super();
    this.options = options;
  }

  protected fetchImage(asset: ImageAsset): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const ImageCtor = (globalThis as { Image?: typeof Image }).Image;
      if (!ImageCtor) {
        reject(new Error("BrowserAssetLoader: Image is not available in this environment"));
        return;
      }
      const img = new ImageCtor();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error(`BrowserAssetLoader: failed to load image '${asset.id}' (${asset.src})`));
      img.src = this.resolveUrl(asset.src);
    });
  }

  protected async fetchFont(asset: FontAsset): Promise<string> {
    const doc = this.options.document ?? (globalThis as { document?: Document }).document;
    const FontFaceCtor = (globalThis as { FontFace?: typeof FontFace }).FontFace;
    if (!doc || !FontFaceCtor) {
      throw new Error("BrowserAssetLoader: FontFace API is not available in this environment");
    }
    const url = this.resolveUrl(asset.src);
    const face = new FontFaceCtor(asset.family, `url("${url}")`);
    await face.load();
    (doc.fonts as unknown as { add(f: FontFace): unknown }).add(face);
    return asset.family;
  }

  private resolveUrl(src: string): string {
    if (!this.options.baseUrl) return src;
    if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith("data:") || src.startsWith("/")) {
      return src;
    }
    const base = this.options.baseUrl.endsWith("/")
      ? this.options.baseUrl
      : `${this.options.baseUrl}/`;
    return `${base}${src}`;
  }
}
