// `davidup` CLI — argument parsing + command dispatch.
//
// This module is the orchestration layer that the bin shebang script
// (`src/cli/bin.ts`) thinly wraps. Keeping `runCli` pure (returns an exit
// code, takes argv as input, threads I/O through injected deps) makes the
// whole surface unit-testable without spawning processes.
//
// Supported commands:
//   davidup edit <dir>     boot the editor against a project dir
//   davidup new  <dir>     scaffold a fresh project
//   davidup render <path>  headless render to a video file (R-8)
//   davidup list           print recents.json as a table
//   davidup recent         alias of list
//   davidup --help         usage
//   davidup --version      print version

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEdit, type EditDeps, type EditHandle } from "./edit.js";
import {
  renderComposition,
  RenderError,
  type RenderDeps,
  type RenderOptions,
} from "./render.js";
import type { RenderToFileResult } from "../drivers/node/index.js";
import {
  scaffoldProject,
  ScaffoldError,
  type ScaffoldOptions,
} from "./scaffold.js";
import { VERSION } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// `src/cli/cli.ts` → up three levels = repo root in the workspace layout.
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_EDITOR_APP_DIR = join(REPO_ROOT, "apps", "editor");

export interface ConsoleIo {
  log(msg: string): void;
  error(msg: string): void;
}

export interface CliDeps {
  io: ConsoleIo;
  cwd: string;
  /** Override the editor app dir (defaults to <repo>/apps/editor). */
  editorAppDir?: string;
  /** Injected for tests to skip the heavy boot path. */
  runEditFn?: (
    opts: Parameters<typeof runEdit>[0],
    deps?: EditDeps,
  ) => Promise<EditHandle>;
  /** Inject scaffolder (tests). */
  scaffoldFn?: (opts: ScaffoldOptions) => Promise<unknown>;
  /** Override path to recents.json (tests). Falls back to env + ~/.davidup. */
  recentsPath?: string;
  /** Clock for date formatting in `list` / `recent` (tests). */
  now?: () => Date;
  /** Inject the render pipeline (tests skip the real ffmpeg/skia path). */
  renderFn?: (
    opts: RenderOptions,
    deps?: RenderDeps,
  ) => Promise<RenderToFileResult>;
  /** Monotonic-ish clock (ms) for `render`'s progress fps calc (tests). */
  clock?: () => number;
}

export interface ParsedCommand {
  kind:
    | "help"
    | "version"
    | "edit"
    | "new"
    | "render"
    | "list"
    | "recent"
    | "error";
  /** For edit / new. */
  positional?: string;
  flags?: Record<string, string | boolean>;
  /** Error message for `kind === "error"`. */
  error?: string;
}

const USAGE = `\
davidup ${VERSION}

USAGE
  davidup edit <dir> [--port=<n>] [--host=<h>] [--no-open]
  davidup new  <dir> [--template=<name>] [--force]
  davidup render <project|comp.json> -o <out.mp4> [--codec=<c>] [--crf=<n>] [--fps=<n>] [--preset=<p>]
  davidup list
  davidup recent
  davidup --help
  davidup --version

COMMANDS
  edit    Boot the AdonisJS editor server against <dir>. <dir> must contain a
          composition.json. Opens the browser and watches the project.
  new     Scaffold a fresh davidup project at <dir>. Refuses non-empty
          directories unless --force is passed.
  render  Headlessly render a project directory or a raw composition JSON
          file to a video file. Streams frame/fps progress to stderr; exits
          nonzero (with a diagnostic on stderr) on invalid input or a failed
          render.
  list    Print recently-opened projects (from ~/.davidup/recents.json) as a
          table, most-recent first.
  recent  Alias of \`list\`.

FLAGS
  --port=<n>          Port to bind the editor on (default 3333).
  --host=<h>          Host to bind on (default localhost).
  --no-open           Do not open the browser automatically.
  --template=<name>   Project template (default "basic").
  --force             Allow scaffolding into a non-empty directory.
  -o, --output=<f>    Output video file path (required for render).
  --codec=<c>         Video codec: libx264 (default) or libx265.
  --crf=<n>           Constant rate factor, 0-51 (default 18; lower = higher quality).
  --fps=<n>           Override the composition's frame rate.
  --preset=<p>        ffmpeg encoder preset (default "medium").

EXAMPLES
  davidup new ./my-clip
  davidup edit ./my-clip
  davidup edit examples/comprehensive-browser
  davidup render ./my-clip -o out.mp4
  davidup render examples/comprehensive-composition.json -o /tmp/out.mp4 --crf=20 --fps=30
  davidup list
`;

export function parseArgs(argv: readonly string[]): ParsedCommand {
  if (argv.length === 0) {
    return { kind: "help" };
  }
  const head = argv[0]!;
  if (head === "-h" || head === "--help" || head === "help") {
    return { kind: "help" };
  }
  if (head === "-v" || head === "--version" || head === "version") {
    return { kind: "version" };
  }
  if (head === "list" || head === "recent") {
    const rest = argv.slice(1);
    const extras = rest.filter((t) => !t.startsWith("-"));
    if (extras.length > 0) {
      return {
        kind: "error",
        error: `\`davidup ${head}\` takes no positional arguments (got ${extras.length})`,
      };
    }
    return { kind: head, flags: {} };
  }
  if (head === "edit" || head === "new") {
    const rest = argv.slice(1);
    const positional: string[] = [];
    const flags: Record<string, string | boolean> = {};
    for (const tok of rest) {
      if (tok.startsWith("--")) {
        const eq = tok.indexOf("=");
        if (eq === -1) {
          flags[tok.slice(2)] = true;
        } else {
          flags[tok.slice(2, eq)] = tok.slice(eq + 1);
        }
      } else if (tok.startsWith("-") && tok.length > 1) {
        flags[tok.slice(1)] = true;
      } else {
        positional.push(tok);
      }
    }
    if (positional.length === 0) {
      return {
        kind: "error",
        error: `\`davidup ${head}\` requires a directory argument`,
      };
    }
    if (positional.length > 1) {
      return {
        kind: "error",
        error: `\`davidup ${head}\` takes exactly one directory argument (got ${positional.length})`,
      };
    }
    return {
      kind: head,
      positional: positional[0]!,
      flags,
    };
  }
  if (head === "render") {
    const rest = argv.slice(1);
    const positional: string[] = [];
    const flags: Record<string, string | boolean> = {};
    for (let i = 0; i < rest.length; i++) {
      const tok = rest[i]!;
      if (tok === "-o" || tok === "--output") {
        const val = rest[i + 1];
        if (val === undefined || val.startsWith("-")) {
          return {
            kind: "error",
            error: `\`--output\` requires a value (e.g. -o out.mp4)`,
          };
        }
        flags.output = val;
        i += 1;
      } else if (tok.startsWith("--")) {
        const eq = tok.indexOf("=");
        if (eq === -1) {
          const name = tok.slice(2);
          const next = rest[i + 1];
          if (next !== undefined && !next.startsWith("-")) {
            flags[name] = next;
            i += 1;
          } else {
            flags[name] = true;
          }
        } else {
          flags[tok.slice(2, eq)] = tok.slice(eq + 1);
        }
      } else if (tok.startsWith("-") && tok.length > 1) {
        flags[tok.slice(1)] = true;
      } else {
        positional.push(tok);
      }
    }
    if (positional.length === 0) {
      return {
        kind: "error",
        error: `\`davidup render\` requires a project or composition JSON argument`,
      };
    }
    if (positional.length > 1) {
      return {
        kind: "error",
        error: `\`davidup render\` takes exactly one input argument (got ${positional.length})`,
      };
    }
    if (typeof flags.output !== "string") {
      return {
        kind: "error",
        error: `\`davidup render\` requires -o/--output <file>`,
      };
    }
    return { kind: "render", positional: positional[0]!, flags };
  }
  return { kind: "error", error: `Unknown command: ${head}` };
}

export async function runCli(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const parsed = parseArgs(argv);

  switch (parsed.kind) {
    case "help":
      deps.io.log(USAGE);
      return 0;

    case "version":
      deps.io.log(VERSION);
      return 0;

    case "error":
      deps.io.error(`davidup: ${parsed.error}`);
      deps.io.error(`Run \`davidup --help\` for usage.`);
      return 2;

    case "new":
      return await runNewCommand(parsed, deps);

    case "edit":
      return await runEditCommand(parsed, deps);

    case "render":
      return await runRenderCommand(parsed, deps);

    case "list":
    case "recent":
      return await runListCommand(deps);
  }
}

type RecentRow = {
  path: string;
  name: string;
  lastOpenedAt: number;
  lastModifiedAt: number;
};

async function runListCommand(deps: CliDeps): Promise<number> {
  const path = deps.recentsPath ?? defaultRecentsPath();
  const entries = await readRecents(path);
  const live = await pruneMissing(entries);
  live.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

  if (live.length === 0) {
    deps.io.log(`No recent projects.`);
    deps.io.log(`(reading ${path})`);
    return 0;
  }

  const now = deps.now ? deps.now() : new Date();
  const rows = live.map((p) => [
    p.name,
    relativeTo(deps.cwd, p.path),
    formatTimestamp(p.lastOpenedAt, now),
    formatTimestamp(p.lastModifiedAt, now),
  ]);
  const header = ["NAME", "PATH", "LAST OPENED", "MODIFIED"];
  for (const line of renderTable(header, rows)) {
    deps.io.log(line);
  }
  return 0;
}

async function readRecents(path: string): Promise<RecentRow[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const src = (parsed ?? {}) as { projects?: unknown };
  if (!Array.isArray(src.projects)) return [];
  const out: RecentRow[] = [];
  for (const item of src.projects) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.path !== "string" || r.path.length === 0) continue;
    const lastOpenedAt = Number(r.lastOpenedAt);
    const lastModifiedAt = Number(r.lastModifiedAt);
    out.push({
      path: r.path,
      name:
        typeof r.name === "string" && r.name.length > 0
          ? r.name
          : basename(r.path),
      lastOpenedAt: Number.isFinite(lastOpenedAt) ? lastOpenedAt : 0,
      lastModifiedAt: Number.isFinite(lastModifiedAt) ? lastModifiedAt : 0,
    });
  }
  return out;
}

async function pruneMissing(rows: RecentRow[]): Promise<RecentRow[]> {
  const alive = await Promise.all(
    rows.map((r) =>
      fs
        .stat(r.path)
        .then((s) => s.isDirectory())
        .catch(() => false),
    ),
  );
  return rows.filter((_, i) => alive[i]);
}

function defaultRecentsPath(): string {
  const override = process.env.DAVIDUP_STATE_DIR;
  const dir = override && override.length > 0 ? override : join(homedir(), ".davidup");
  return join(dir, "recents.json");
}

// Render with two trailing spaces between columns so a copy-paste into a
// terminal still parses cleanly with `awk` etc. Header is uppercased; ASCII
// only — no box-drawing characters so the output stays portable across
// terminals that don't speak UTF-8.
function renderTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("  ");
  return [fmt(header), ...rows.map(fmt)];
}

function relativeTo(cwd: string, target: string): string {
  // Show paths under cwd as `./foo`, paths under $HOME as `~/foo`. Otherwise
  // print the absolute path. Pure cosmetic; the underlying entry is still the
  // canonical absolute path on disk.
  if (target === cwd) return ".";
  const sep = cwd.endsWith("/") ? "" : "/";
  if (target.startsWith(cwd + "/")) return `.${sep}${target.slice(cwd.length + 1)}`;
  const home = homedir();
  if (target === home) return "~";
  if (target.startsWith(home + "/")) return `~/${target.slice(home.length + 1)}`;
  return target;
}

function formatTimestamp(ms: number, now: Date): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const then = new Date(ms);
  const diffMs = now.getTime() - then.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${Math.max(sec, 0)}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const y = then.getFullYear();
  const mo = String(then.getMonth() + 1).padStart(2, "0");
  const d = String(then.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

async function runNewCommand(
  parsed: ParsedCommand,
  deps: CliDeps,
): Promise<number> {
  const target = resolveDir(deps.cwd, parsed.positional!);
  const template = stringFlag(parsed.flags, "template");
  const force = boolFlag(parsed.flags, "force");
  const scaffold = deps.scaffoldFn ?? scaffoldProject;

  try {
    const opts: ScaffoldOptions = {
      targetDir: target,
      ...(template !== undefined ? { template } : {}),
      ...(force ? { force: true } : {}),
    };
    const result = (await scaffold(opts)) as {
      root: string;
      compositionPath: string;
    };
    deps.io.log(`davidup: scaffolded project at ${result.root}`);
    deps.io.log(`  composition.json  ${result.compositionPath}`);
    deps.io.log(``);
    deps.io.log(`Next: davidup edit ${parsed.positional}`);
    return 0;
  } catch (err) {
    if (err instanceof ScaffoldError) {
      deps.io.error(`davidup: ${err.message}`);
      return mapErrorCodeToExit(err.code);
    }
    deps.io.error(`davidup: scaffold failed — ${(err as Error).message}`);
    return 1;
  }
}

async function runEditCommand(
  parsed: ParsedCommand,
  deps: CliDeps,
): Promise<number> {
  const target = resolveDir(deps.cwd, parsed.positional!);
  const portRaw = stringFlag(parsed.flags, "port");
  const hostRaw = stringFlag(parsed.flags, "host");
  const noOpen = boolFlag(parsed.flags, "no-open");

  let port: number | undefined;
  if (portRaw !== undefined) {
    const n = Number.parseInt(portRaw, 10);
    if (!Number.isFinite(n) || n <= 0 || n > 65_535) {
      deps.io.error(`davidup: invalid --port "${portRaw}"`);
      return 2;
    }
    port = n;
  }

  const editorAppDir = deps.editorAppDir ?? DEFAULT_EDITOR_APP_DIR;

  // Validate the project directory eagerly with a clear message before
  // spawning the server. runEdit also validates but its error is reported
  // after the (slow) boot starts; failing fast here keeps the UX clean.
  const compositionPath = join(target, "composition.json");
  const stat = await fs.stat(compositionPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    deps.io.error(
      `davidup: ${target} is not a davidup project (missing composition.json)`,
    );
    deps.io.error(`Run \`davidup new ${parsed.positional}\` first.`);
    return 1;
  }

  const fn = deps.runEditFn ?? runEdit;
  try {
    const handle = await fn({
      projectDir: target,
      editorAppDir,
      ...(port !== undefined ? { port } : {}),
      ...(hostRaw !== undefined ? { host: hostRaw } : {}),
      ...(noOpen ? { noOpen: true } : {}),
    });
    deps.io.log(`davidup edit · serving at ${handle.url} (Ctrl+C to stop)`);

    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void handle.close().finally(() => process.exit(0));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    // Keep the CLI process alive — the child server runs until the user
    // hits Ctrl+C. Returning here is fine: handle.close() owns teardown.
    return await new Promise<number>(() => {
      /* never resolves; signal handler calls process.exit */
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    deps.io.error(`davidup: ${msg}`);
    return 1;
  }
}

const VALID_CODECS = ["libx264", "libx265"] as const;
type Codec = (typeof VALID_CODECS)[number];

async function runRenderCommand(
  parsed: ParsedCommand,
  deps: CliDeps,
): Promise<number> {
  const input = resolveDir(deps.cwd, parsed.positional!);
  const outputRaw = stringFlag(parsed.flags, "output")!;
  const outputPath = resolveDir(deps.cwd, outputRaw);

  const codecRaw = stringFlag(parsed.flags, "codec");
  if (codecRaw !== undefined && !VALID_CODECS.includes(codecRaw as Codec)) {
    deps.io.error(
      `davidup: invalid --codec "${codecRaw}" (expected ${VALID_CODECS.join(" or ")})`,
    );
    return 2;
  }

  const crf = numberFlag(parsed.flags, "crf", deps.io, 0, 51);
  if (crf === INVALID_FLAG) return 2;
  const fps = numberFlag(parsed.flags, "fps", deps.io, Number.EPSILON, Infinity);
  if (fps === INVALID_FLAG) return 2;
  const preset = stringFlag(parsed.flags, "preset");

  const clock = deps.clock ?? Date.now;
  const startedAt = clock();
  let lastLogAt = startedAt;
  const onProgress = (info: { frame: number; total: number }) => {
    const now = clock();
    // Throttle to ~4 updates/sec so fast renders don't flood stderr; always
    // flush the final frame so the progress line ends at 100%.
    if (info.frame !== info.total && now - lastLogAt < 250) return;
    lastLogAt = now;
    const elapsedMs = Math.max(1, now - startedAt);
    const fps2 = (info.frame / elapsedMs) * 1000;
    deps.io.error(
      `davidup render · frame ${info.frame}/${info.total} (${fps2.toFixed(1)} fps)`,
    );
  };

  const render = deps.renderFn ?? renderComposition;
  try {
    const result = await render(
      {
        input,
        outputPath,
        ...(codecRaw !== undefined ? { codec: codecRaw as Codec } : {}),
        ...(crf !== undefined ? { crf } : {}),
        ...(fps !== undefined ? { fps } : {}),
        ...(preset !== undefined ? { preset } : {}),
      },
      { onProgress },
    );
    deps.io.log(
      `davidup render · wrote ${result.outputPath} (${result.frameCount} frames, ${(result.durationMs / 1000).toFixed(1)}s)`,
    );
    return 0;
  } catch (err) {
    if (err instanceof RenderError) {
      deps.io.error(`davidup: ${err.message}`);
      return 1;
    }
    deps.io.error(`davidup: render failed — ${(err as Error).message}`);
    return 1;
  }
}

const INVALID_FLAG = Symbol("invalid-flag");

function numberFlag(
  flags: Record<string, string | boolean> | undefined,
  name: string,
  io: ConsoleIo,
  min: number,
  max: number,
): number | undefined | typeof INVALID_FLAG {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    io.error(
      `davidup: invalid --${name} "${raw}" (expected a number${
        Number.isFinite(max) ? ` between ${min} and ${max}` : ` >= ${min}`
      })`,
    );
    return INVALID_FLAG;
  }
  return n;
}

function resolveDir(cwd: string, p: string): string {
  return resolve(cwd, p);
}

function stringFlag(
  flags: Record<string, string | boolean> | undefined,
  name: string,
): string | undefined {
  const v = flags?.[name];
  return typeof v === "string" ? v : undefined;
}

function boolFlag(
  flags: Record<string, string | boolean> | undefined,
  name: string,
): boolean {
  return flags?.[name] === true;
}

function mapErrorCodeToExit(code: string): number {
  if (code === "E_TARGET_NOT_EMPTY") return 1;
  if (code === "E_TEMPLATE_NOT_FOUND") return 1;
  if (code === "E_TEMPLATE_INVALID") return 1;
  return 1;
}

export const __cli = {
  USAGE,
  DEFAULT_EDITOR_APP_DIR,
};
