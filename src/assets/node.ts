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
    /** Wipe every custom family back to just the system-installed fonts. The
     * only removal primitive `FontLibrary` exposes — see the module comment
     * below on why that forces a claim-counted `clear()` instead of a direct
     * per-family unregister. */
    reset: () => void;
  };
}

// skia-canvas's `FontLibrary` is a process-global registry (R-13, R-32,
// Session 28): `use()` registers a family, and the *only* way to remove one
// is `reset()`, which wipes every custom family back to the system set —
// there is no per-family unregister. Multiple `NodeAssetLoader`s can be alive
// at once (the mcp/render.ts preview cache keeps up to 8), so a single
// loader's `clear()` can't just call `reset()`: that would blow away every
// *other* loader's still-live fonts too.
//
// So every loader that registers a family becomes a "claimant" in this
// process-wide table. `clear()` releases this instance's claims; `reset()`
// only actually fires once the last claimant anywhere has let go (true
// process-wide idle) — otherwise a family a sibling loader still depends on
// is left registered rather than corrupted out from under it.
//
// The per-(family, path) `registeredPaths` bookkeeping is what actually fixes
// R-32: without it, a *second* loader instance registering the same family +
// file (e.g. a fresh `renderToFile` call re-rendering the same composition in
// one process) called `FontLibrary.use()` again for an already-registered
// family, which was observed to perturb pixel output between two otherwise-
// identical renders. Skipping the redundant native call makes re-registration
// order-independent and side-effect-free.
interface FontClaim {
  registeredPaths: Set<string>;
  claimants: number;
}
const fontClaims = new Map<string, FontClaim>();

function claimFamily(
  skia: SkiaCanvasModule,
  family: string,
  path: string,
  countClaim: boolean,
): void {
  let claim = fontClaims.get(family);
  if (!claim) {
    claim = { registeredPaths: new Set(), claimants: 0 };
    fontClaims.set(family, claim);
  }
  if (!claim.registeredPaths.has(path)) {
    skia.FontLibrary.use(family, [path]);
    claim.registeredPaths.add(path);
  }
  // Only one claim per (loader, family) regardless of how many distinct font
  // assets/files that loader registers under the family — see the call site.
  if (countClaim) claim.claimants += 1;
}

function releaseFamily(skia: SkiaCanvasModule, family: string): void {
  const claim = fontClaims.get(family);
  if (!claim) return;
  claim.claimants -= 1;
  if (claim.claimants > 0) return;
  fontClaims.delete(family);
  // Only touch the native library once nothing anywhere still claims *any*
  // family — `reset()` is all-or-nothing, so it must wait for true idle.
  if (fontClaims.size === 0) {
    skia.FontLibrary.reset();
  }
}

/**
 * Test-only escape hatch: wipes the module-level font-claim table. Production
 * code never calls this — `fontClaims` is deliberately process-global so
 * concurrent `NodeAssetLoader`s share one view of what's claimed. Tests call
 * it to keep one file's `it()` blocks from leaking claims into each other.
 */
export function __resetFontClaimsForTests(): void {
  fontClaims.clear();
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
  private resolvedSkia: SkiaCanvasModule | undefined;
  // Families this instance has claimed — tracked so `clear()` can release its
  // share of the process-global `FontLibrary` registrations (see the
  // module-level claim table above).
  private readonly claimedFamilies = new Set<string>();

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
    const isNewClaim = !this.claimedFamilies.has(asset.family);
    claimFamily(skia, asset.family, this.resolveSrc(asset.src), isNewClaim);
    this.claimedFamilies.add(asset.family);
    return asset.family;
  }

  /**
   * Release this instance's font claims (R-13). Native unregistration only
   * actually happens once every claimant everywhere has cleared — see the
   * module-level `fontClaims` table for why a single instance can't safely
   * force it. Safe to call even if no font was ever loaded.
   */
  override clear(): void {
    super.clear();
    if (this.claimedFamilies.size > 0 && this.resolvedSkia) {
      for (const family of this.claimedFamilies) {
        releaseFamily(this.resolvedSkia, family);
      }
    }
    this.claimedFamilies.clear();
  }

  private resolveSrc(src: string): string {
    return resolveGlobalSrc(src, this.globalLibraryRootOverride);
  }

  private getSkia(): Promise<SkiaCanvasModule> {
    if (this.injected) {
      this.resolvedSkia = this.injected;
      return Promise.resolve(this.injected);
    }
    this.skiaPromise ??= importSkiaCanvas().then((mod) => {
      this.resolvedSkia = mod;
      return mod;
    });
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
