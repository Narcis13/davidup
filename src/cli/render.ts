// `davidup render <project|comp.json> -o out.mp4` — the headless render path
// (R-8). Drives the exact same node driver (`davidup/node#renderToFile`) the
// editor and MCP server use, so behaviour (backpressure, stderr-tail capture,
// signal-kill-is-a-failure per R-7) is identical — this module only owns
// input resolution, validation, and asset-path fixups.
//
// Accepts two input shapes:
//   - a project directory containing `composition.json`
//   - a standalone composition JSON file (raw v0.1–v0.4 authoring JSON)
// Both are precompiled ($ref / templates / scenes / behaviors) and validated
// before any frame is rendered, so a malformed composition fails fast with a
// schema-level error instead of partway through an expensive render.

import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { precompile } from "../compose/index.js";
import {
  renderToFile,
  type RenderToFileOptions,
  type RenderToFileResult,
} from "../drivers/node/index.js";
import { validateComposition } from "../schema/index.js";
import type { Composition } from "../schema/types.js";

export type RenderErrorCode =
  | "E_INPUT_NOT_FOUND"
  | "E_INPUT_INVALID"
  | "E_VALIDATION_FAILED"
  | "E_RENDER_FAILED";

export class RenderError extends Error {
  code: RenderErrorCode;
  details?: unknown;
  constructor(code: RenderErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "RenderError";
    this.code = code;
    this.details = details;
  }
}

export interface RenderOptions {
  /** Absolute path to a project directory or a raw composition JSON file. */
  input: string;
  /** Absolute output file path. */
  outputPath: string;
  codec?: "libx264" | "libx265";
  crf?: number;
  preset?: string;
  /** Overrides `composition.fps` from the source JSON when set. */
  fps?: number;
}

export interface RenderDeps {
  /** Defaults to `fs/promises#readFile` (utf-8). Override for tests. */
  readFile?: (path: string) => Promise<string>;
  /** Defaults to `davidup/node#renderToFile`. Override for tests. */
  renderFn?: (
    comp: Composition,
    outPath: string,
    opts: RenderToFileOptions,
  ) => Promise<RenderToFileResult>;
  onProgress?: (info: { frame: number; total: number }) => void;
}

/**
 * Resolve `input` to a composition source file: a project dir's
 * `composition.json`, or the file itself.
 */
function resolveSourcePath(input: string, stat: { isDirectory(): boolean }): string {
  return stat.isDirectory() ? join(input, "composition.json") : input;
}

/**
 * The Node asset loader hands `asset.src` straight to skia's `loadImage` /
 * `FontLibrary.use`, which resolve relative paths against `process.cwd()` —
 * not the composition file. Mirrors
 * `apps/editor/app/workers/render_worker.ts#resolveAssetSources`: rewrite any
 * relative `assets[].src` to an absolute path resolved against the source
 * file's directory so rendering works regardless of the caller's cwd.
 */
export function resolveAssetSources(
  composition: Composition,
  sourcePath: string,
): Composition {
  const clone = JSON.parse(JSON.stringify(composition)) as Composition & {
    assets: Array<{ src?: string }>;
  };
  const baseDir = dirname(sourcePath);
  for (const asset of clone.assets ?? []) {
    if (typeof asset.src === "string" && asset.src.length > 0 && !isAbsolute(asset.src)) {
      const src = asset.src.startsWith("./") ? asset.src.slice(2) : asset.src;
      asset.src = resolvePath(baseDir, src);
    }
  }
  return clone;
}

/**
 * Load, precompile, validate, and render a composition to a video file.
 * Throws {@link RenderError} for input/validation failures; render-time
 * failures (missing asset, ffmpeg crash) surface as `E_RENDER_FAILED` wrapping
 * the underlying error's message (which already carries ffmpeg's stderr tail
 * — see `renderToFile` in `src/drivers/node/index.ts`).
 */
export async function renderComposition(
  opts: RenderOptions,
  deps: RenderDeps = {},
): Promise<RenderToFileResult> {
  const readFile = deps.readFile ?? ((p: string) => fs.readFile(p, "utf8"));
  const renderFn = deps.renderFn ?? renderToFile;

  const inputStat = await fs.stat(opts.input).catch(() => null);
  if (!inputStat) {
    throw new RenderError("E_INPUT_NOT_FOUND", `Input not found: ${opts.input}`);
  }
  const sourcePath = resolveSourcePath(opts.input, inputStat);
  if (inputStat.isDirectory()) {
    const compStat = await fs.stat(sourcePath).catch(() => null);
    if (!compStat || !compStat.isFile()) {
      throw new RenderError(
        "E_INPUT_NOT_FOUND",
        `${opts.input} is not a davidup project (missing composition.json)`,
      );
    }
  }

  let raw: string;
  try {
    raw = await readFile(sourcePath);
  } catch (err) {
    throw new RenderError(
      "E_INPUT_NOT_FOUND",
      `Cannot read ${sourcePath}: ${(err as Error).message}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new RenderError(
      "E_INPUT_INVALID",
      `${sourcePath} is not valid JSON: ${(err as Error).message}`,
    );
  }

  let compiled: Composition;
  try {
    compiled = (await precompile(parsedJson, { sourcePath, readFile })) as Composition;
  } catch (err) {
    throw new RenderError(
      "E_INPUT_INVALID",
      `Failed to precompile ${sourcePath}: ${(err as Error).message}`,
    );
  }

  const validation = validateComposition(compiled);
  if (!validation.valid) {
    const summary = validation.errors
      .map((e) => `  ${e.code} ${e.path ?? ""}: ${e.message}`)
      .join("\n");
    throw new RenderError(
      "E_VALIDATION_FAILED",
      `${sourcePath} failed validation (${validation.errors.length} error(s)):\n${summary}`,
      validation,
    );
  }

  const resolved = resolveAssetSources(compiled, sourcePath);
  if (opts.fps !== undefined) {
    resolved.composition = { ...resolved.composition, fps: opts.fps };
  }

  await fs.mkdir(dirname(opts.outputPath), { recursive: true });

  try {
    return await renderFn(resolved, opts.outputPath, {
      sourcePath,
      readFile,
      movflagsFaststart: true,
      ...(opts.codec !== undefined ? { codec: opts.codec } : {}),
      ...(opts.crf !== undefined ? { crf: opts.crf } : {}),
      ...(opts.preset !== undefined ? { preset: opts.preset } : {}),
      ...(deps.onProgress !== undefined ? { onProgress: deps.onProgress } : {}),
    });
  } catch (err) {
    throw new RenderError(
      "E_RENDER_FAILED",
      (err as Error).message ?? String(err),
    );
  }
}
