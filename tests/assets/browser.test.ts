import { afterEach, describe, expect, it } from "vitest";
import { BrowserAssetLoader } from "../../src/assets/index.js";

interface FakeImage {
  crossOrigin: string;
  onload: (() => void) | null;
  onerror: ((err?: unknown) => void) | null;
  src: string;
}

class FakeFontFace {
  static instances: FakeFontFace[] = [];
  loaded = false;
  constructor(
    public readonly family: string,
    public readonly source: string,
  ) {
    FakeFontFace.instances.push(this);
  }
  async load(): Promise<this> {
    this.loaded = true;
    return this;
  }
}

function installImageCtor(behavior: "load" | "error" = "load"): FakeImage[] {
  const instances: FakeImage[] = [];
  class FakeImageCtor {
    crossOrigin = "";
    onload: (() => void) | null = null;
    onerror: ((err?: unknown) => void) | null = null;
    private _src = "";
    constructor() {
      instances.push(this as unknown as FakeImage);
    }
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => {
        if (behavior === "load") this.onload?.();
        else this.onerror?.();
      });
    }
    get src(): string {
      return this._src;
    }
  }
  (globalThis as { Image?: unknown }).Image = FakeImageCtor;
  return instances;
}

function installFontEnv(): { added: FakeFontFace[]; doc: { fonts: { add(f: FakeFontFace): void } } } {
  const added: FakeFontFace[] = [];
  const doc = { fonts: { add: (f: FakeFontFace) => void added.push(f) } };
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { FontFace?: unknown }).FontFace = FakeFontFace;
  return { added, doc };
}

afterEach(() => {
  delete (globalThis as { Image?: unknown }).Image;
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { FontFace?: unknown }).FontFace;
  FakeFontFace.instances.length = 0;
});

describe("BrowserAssetLoader", () => {
  it("loads an image and caches it by id", async () => {
    const images = installImageCtor("load");
    const loader = new BrowserAssetLoader();

    await loader.preloadAll([{ id: "logo", type: "image", src: "logo.png" }]);

    expect(images).toHaveLength(1);
    expect(images[0]!.crossOrigin).toBe("anonymous");
    expect(images[0]!.src).toBe("logo.png");
    expect(loader.getImage("logo")).toBe(images[0]);
  });

  it("rejects when an image fails to load", async () => {
    installImageCtor("error");
    const loader = new BrowserAssetLoader();

    await expect(
      loader.preloadAll([{ id: "x", type: "image", src: "missing.png" }]),
    ).rejects.toThrow(/failed to load image 'x'/);
  });

  it("registers fonts via FontFace and document.fonts.add", async () => {
    const { added } = installFontEnv();
    const loader = new BrowserAssetLoader();

    await loader.preloadAll([
      { id: "inter", type: "font", src: "/fonts/Inter.ttf", family: "Inter" },
    ]);

    expect(loader.getFontFamily("inter")).toBe("Inter");
    expect(added).toHaveLength(1);
    expect(added[0]!.family).toBe("Inter");
    expect(added[0]!.source).toBe('url("/fonts/Inter.ttf")');
    expect(added[0]!.loaded).toBe(true);
  });

  it("prepends baseUrl to relative srcs but leaves absolute ones alone", async () => {
    const images = installImageCtor("load");
    const loader = new BrowserAssetLoader({ baseUrl: "https://cdn.example.com/v1" });

    await loader.preloadAll([
      { id: "rel", type: "image", src: "logo.png" },
      { id: "abs", type: "image", src: "https://other.example/x.png" },
      { id: "data", type: "image", src: "data:image/png;base64,abc" },
      { id: "root", type: "image", src: "/static/y.png" },
    ]);

    expect(images.map((i) => i.src)).toEqual([
      "https://cdn.example.com/v1/logo.png",
      "https://other.example/x.png",
      "data:image/png;base64,abc",
      "/static/y.png",
    ]);
  });

  it("throws a clear error when FontFace API is missing", async () => {
    // Image is fine, but no FontFace/document set up.
    installImageCtor("load");
    const loader = new BrowserAssetLoader();

    await expect(
      loader.preloadAll([
        { id: "f", type: "font", src: "x.ttf", family: "F" },
      ]),
    ).rejects.toThrow(/FontFace API is not available/);
  });
});
