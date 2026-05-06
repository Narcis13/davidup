import { describe, expect, it } from "vitest";
import { BaseAssetLoader } from "../../src/assets/index.js";
import type { Asset, FontAsset, ImageAsset } from "../../src/schema/types.js";

class CountingLoader extends BaseAssetLoader {
  imageCalls: ImageAsset[] = [];
  fontCalls: FontAsset[] = [];
  resolvers: Array<() => void> = [];

  protected fetchImage(asset: ImageAsset): Promise<{ src: string }> {
    this.imageCalls.push(asset);
    return new Promise((resolve) => {
      this.resolvers.push(() => resolve({ src: asset.src }));
    });
  }

  protected fetchFont(asset: FontAsset): Promise<string> {
    this.fontCalls.push(asset);
    return new Promise((resolve) => {
      this.resolvers.push(() => resolve(asset.family));
    });
  }

  flush(): void {
    const pending = this.resolvers.splice(0);
    for (const r of pending) r();
  }
}

const imageAsset = (id: string, src = `${id}.png`): ImageAsset => ({
  id,
  type: "image",
  src,
});

const fontAsset = (id: string, family = id): FontAsset => ({
  id,
  type: "font",
  src: `${id}.ttf`,
  family,
});

describe("BaseAssetLoader", () => {
  it("preloadAll populates the registry for images and fonts", async () => {
    const loader = new CountingLoader();
    const assets: Asset[] = [imageAsset("logo"), fontAsset("inter", "Inter")];

    const done = loader.preloadAll(assets);
    loader.flush();
    await done;

    expect(loader.getImage("logo")).toEqual({ src: "logo.png" });
    expect(loader.getFontFamily("inter")).toBe("Inter");
    expect(loader.has("logo")).toBe(true);
    expect(loader.has("inter")).toBe(true);
    expect(loader.has("missing")).toBe(false);
  });

  it("dedupes concurrent loads of the same asset", async () => {
    const loader = new CountingLoader();
    const a = imageAsset("a");

    const p1 = loader.load(a);
    const p2 = loader.load(a);
    loader.flush();
    await Promise.all([p1, p2]);

    expect(loader.imageCalls).toHaveLength(1);
  });

  it("skips already-cached assets on subsequent loads", async () => {
    const loader = new CountingLoader();
    const a = imageAsset("a");

    const first = loader.load(a);
    loader.flush();
    await first;

    await loader.load(a);
    expect(loader.imageCalls).toHaveLength(1);
  });

  it("clear() drops cache so the next load re-fetches", async () => {
    const loader = new CountingLoader();
    const a = imageAsset("a");

    const first = loader.load(a);
    loader.flush();
    await first;
    expect(loader.getImage("a")).toBeDefined();

    loader.clear();
    expect(loader.getImage("a")).toBeUndefined();

    const second = loader.load(a);
    loader.flush();
    await second;
    expect(loader.imageCalls).toHaveLength(2);
  });

  it("propagates fetch errors and clears inflight tracking", async () => {
    class FailingLoader extends BaseAssetLoader {
      protected fetchImage(): Promise<unknown> {
        return Promise.reject(new Error("boom"));
      }
      protected fetchFont(): Promise<string> {
        return Promise.reject(new Error("nope"));
      }
    }
    const loader = new FailingLoader();
    await expect(loader.load(imageAsset("x"))).rejects.toThrow("boom");

    // Inflight cleared → next attempt re-runs the (still-failing) fetch.
    await expect(loader.load(imageAsset("x"))).rejects.toThrow("boom");
  });

  it("preloadAll resolves once every asset settles", async () => {
    const loader = new CountingLoader();
    const order: string[] = [];

    const p = loader
      .preloadAll([imageAsset("a"), fontAsset("b", "B"), imageAsset("c")])
      .then(() => order.push("done"));

    // Resolve one at a time to verify preloadAll waits for all.
    loader.resolvers[0]?.();
    await Promise.resolve();
    expect(order).toEqual([]);

    loader.resolvers[1]?.();
    await Promise.resolve();
    expect(order).toEqual([]);

    loader.resolvers[2]?.();
    await p;
    expect(order).toEqual(["done"]);
  });
});
