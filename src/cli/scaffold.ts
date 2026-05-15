// `davidup new ./path` — scaffold a fresh project directory.
//
// Layout produced (matches FR-01 in the v1.0 editor PRD):
//   composition.json     canonical composition document, validated before write
//   library/index.json   empty local library catalog
//   assets/.gitkeep      assets directory placeholder
//   renders/             render output dir (gitignored)
//   .gitignore           default ignore rules
//   README.md            short orientation
//
// The template files live under `src/cli/templates/basic/`. Keeping them as
// real files (rather than inlined strings) means engine refactors to the
// composition schema are picked up automatically — the template just has to
// re-validate, which the post-write check enforces.

import { promises as fs } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateComposition } from "../schema/index.js";

const TEMPLATE_DIR_FROM_CLI = fileURLToPath(
  new URL("./templates/basic", import.meta.url),
);

export type ScaffoldErrorCode =
  | "E_TARGET_NOT_EMPTY"
  | "E_TEMPLATE_NOT_FOUND"
  | "E_TEMPLATE_INVALID";

export class ScaffoldError extends Error {
  code: ScaffoldErrorCode;
  details?: unknown;
  constructor(code: ScaffoldErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ScaffoldError";
    this.code = code;
    this.details = details;
  }
}

export interface ScaffoldOptions {
  /** Project root to create. Created recursively if missing. */
  targetDir: string;
  /** Template name (default: "basic"). */
  template?: string;
  /** Allow writing into a directory that already contains files. */
  force?: boolean;
  /** Override the templates root (used by tests). */
  templateRoot?: string;
}

export interface ScaffoldResult {
  root: string;
  compositionPath: string;
  filesWritten: string[];
}

const DEFAULT_TEMPLATE = "basic";

export async function scaffoldProject(
  opts: ScaffoldOptions,
): Promise<ScaffoldResult> {
  const root = resolve(opts.targetDir);
  const templateName = opts.template ?? DEFAULT_TEMPLATE;
  const templatesRoot = opts.templateRoot ?? dirname(TEMPLATE_DIR_FROM_CLI);
  const templateDir = join(templatesRoot, templateName);

  const templateStat = await fs.stat(templateDir).catch(() => null);
  if (!templateStat || !templateStat.isDirectory()) {
    throw new ScaffoldError(
      "E_TEMPLATE_NOT_FOUND",
      `Template "${templateName}" not found at ${templateDir}`,
    );
  }

  await fs.mkdir(root, { recursive: true });

  if (!opts.force) {
    const existing = await fs.readdir(root).catch(() => []);
    const blocking = existing.filter(
      (name) => name !== ".DS_Store" && name !== ".",
    );
    if (blocking.length > 0) {
      throw new ScaffoldError(
        "E_TARGET_NOT_EMPTY",
        `Refusing to scaffold into non-empty directory ${root} (pass --force to override)`,
        { entries: blocking },
      );
    }
  }

  const filesWritten = await copyTemplate(templateDir, root);
  // Ensure renders/ exists — gitignored, holds editor output.
  const rendersDir = join(root, "renders");
  await fs.mkdir(rendersDir, { recursive: true });

  // Final sanity: the freshly-written composition must validate against the
  // current engine schema. Template drift caught here, not at editor boot.
  const compositionPath = join(root, "composition.json");
  const raw = await fs.readFile(compositionPath, "utf8");
  const parsed = JSON.parse(raw);
  const result = validateComposition(parsed);
  if (!result.valid) {
    throw new ScaffoldError(
      "E_TEMPLATE_INVALID",
      `Template "${templateName}" produced an invalid composition (${result.errors.length} error(s))`,
      result,
    );
  }

  return { root, compositionPath, filesWritten };
}

async function copyTemplate(from: string, to: string): Promise<string[]> {
  const written: string[] = [];
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(dst, { recursive: true });
      const nested = await copyTemplate(src, dst);
      written.push(...nested);
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst);
      written.push(dst);
    }
  }
  return written;
}
