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
//   davidup --help         usage
//   davidup --version      print version

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEdit, type EditDeps, type EditHandle } from "./edit.js";
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
}

export interface ParsedCommand {
  kind: "help" | "version" | "edit" | "new" | "error";
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
  davidup --help
  davidup --version

COMMANDS
  edit   Boot the AdonisJS editor server against <dir>. <dir> must contain a
         composition.json. Opens the browser and watches the project.
  new    Scaffold a fresh davidup project at <dir>. Refuses non-empty
         directories unless --force is passed.

FLAGS
  --port=<n>          Port to bind the editor on (default 3333).
  --host=<h>          Host to bind on (default localhost).
  --no-open           Do not open the browser automatically.
  --template=<name>   Project template (default "basic").
  --force             Allow scaffolding into a non-empty directory.

EXAMPLES
  davidup new ./my-clip
  davidup edit ./my-clip
  davidup edit examples/comprehensive-browser
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
  }
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
