// `davidup edit ./path` — boot the AdonisJS editor server with the given
// project directory pre-loaded, open the browser, and watch the project for
// external edits. This module is the orchestration layer; the actual side
// effects (spawning, watching, opening a browser) are factored into the
// `EditDeps` interface so tests can drive runEdit with stubs.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  promises as fs,
  existsSync,
  mkdirSync,
  watch as fsWatch,
  type FSWatcher,
} from "node:fs";
import { join, resolve } from "node:path";
import { platform, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { request } from "node:http";

export type EditErrorCode =
  | "E_PROJECT_NOT_FOUND"
  | "E_COMPOSITION_MISSING"
  | "E_EDITOR_APP_MISSING"
  | "E_SERVER_TIMEOUT"
  | "E_SERVER_EXITED";

export class EditError extends Error {
  code: EditErrorCode;
  details?: unknown;
  constructor(code: EditErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "EditError";
    this.code = code;
    this.details = details;
  }
}

export interface EditOptions {
  /** Project directory containing composition.json. */
  projectDir: string;
  /** Path to the editor AdonisJS app (`apps/editor`). */
  editorAppDir: string;
  /** Port to bind the editor server on. */
  port?: number;
  /** Host to bind on. */
  host?: string;
  /** Skip auto-opening the browser (CI, tests). */
  noOpen?: boolean;
  /** Skip wiring the project watcher (tests). */
  noWatch?: boolean;
  /** Total milliseconds to wait for the server to become ready. */
  readyTimeoutMs?: number;
}

export interface EditHandle {
  /** URL the editor is reachable at. */
  url: string;
  /** Stop the editor server and watcher. */
  close(): Promise<void>;
}

export interface EditDeps {
  log: (msg: string) => void;
  spawnServer: (opts: SpawnServerInput) => ChildProcess;
  waitForServer: (url: string, timeoutMs: number) => Promise<void>;
  openBrowser: (url: string) => Promise<void>;
  watchProject: (projectDir: string, onChange: () => void) => () => void;
  reloadProject: (url: string, projectDir: string) => Promise<void>;
}

export interface SpawnServerInput {
  editorAppDir: string;
  projectDir: string;
  port: number;
  host: string;
}

const DEFAULT_PORT = 3333;
const DEFAULT_HOST = "localhost";
const DEFAULT_READY_TIMEOUT_MS = 30_000;

/**
 * Boot the editor against an existing project directory.
 *
 * Sequence:
 *   1. Validate the project dir has a `composition.json`.
 *   2. Confirm the editor AdonisJS app is installed at `editorAppDir`.
 *   3. Spawn the AdonisJS server with DAVIDUP_PROJECT set.
 *   4. Poll the server until it is reachable.
 *   5. Open the browser (unless `noOpen`).
 *   6. Watch the project for external composition.json edits — reloads the
 *      in-memory store via POST /api/project so the editor reflects them.
 *
 * Throws `EditError` on validation / readiness failures. On success the
 * returned handle stays live until `close()` is called.
 */
export async function runEdit(
  opts: EditOptions,
  deps: EditDeps = defaultEditDeps(),
): Promise<EditHandle> {
  const projectDir = resolve(opts.projectDir);
  const editorAppDir = resolve(opts.editorAppDir);
  const port = opts.port ?? DEFAULT_PORT;
  const host = opts.host ?? DEFAULT_HOST;
  const readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

  await assertProjectDir(projectDir);
  await assertEditorAppDir(editorAppDir);

  const url = `http://${host}:${port}`;
  deps.log(`davidup edit · project: ${projectDir}`);
  deps.log(`davidup edit · booting editor on ${url}`);

  const child = deps.spawnServer({ editorAppDir, projectDir, port, host });

  let exited = false;
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null =
    null;
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });

  const ready = deps.waitForServer(url, readyTimeoutMs).catch((err) => {
    if (exited) {
      throw new EditError(
        "E_SERVER_EXITED",
        `Editor server exited before becoming ready (code=${exitInfo?.code ?? "?"}, signal=${exitInfo?.signal ?? "?"})`,
        exitInfo,
      );
    }
    throw err;
  });

  try {
    await ready;
  } catch (err) {
    await terminate(child);
    throw err;
  }

  deps.log(`davidup edit · ready at ${url}`);

  if (!opts.noOpen) {
    deps.openBrowser(`${url}/editor`).catch((err) => {
      deps.log(
        `davidup edit · warning: failed to open browser (${(err as Error).message})`,
      );
    });
  }

  let stopWatch: (() => void) | null = null;
  if (!opts.noWatch) {
    let pending = false;
    stopWatch = deps.watchProject(projectDir, () => {
      // Coalesce bursts (editor saves emit a few events for one logical write).
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        deps
          .reloadProject(url, projectDir)
          .then(() => deps.log(`davidup edit · reloaded composition.json`))
          .catch((err) =>
            deps.log(
              `davidup edit · warning: reload failed (${(err as Error).message})`,
            ),
          );
      }, 100);
    });
  }

  return {
    url,
    async close() {
      stopWatch?.();
      await terminate(child);
    },
  };
}

async function assertProjectDir(projectDir: string): Promise<void> {
  const stat = await fs.stat(projectDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new EditError(
      "E_PROJECT_NOT_FOUND",
      `Project directory not found: ${projectDir}`,
    );
  }
  const compositionPath = join(projectDir, "composition.json");
  const compStat = await fs.stat(compositionPath).catch(() => null);
  if (!compStat || !compStat.isFile()) {
    throw new EditError(
      "E_COMPOSITION_MISSING",
      `Missing composition.json at ${compositionPath} — run \`davidup new ${projectDir}\` first`,
    );
  }
}

async function assertEditorAppDir(editorAppDir: string): Promise<void> {
  const packagePath = join(editorAppDir, "package.json");
  const stat = await fs.stat(packagePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new EditError(
      "E_EDITOR_APP_MISSING",
      `Editor app not found at ${editorAppDir} (expected ${packagePath}). ` +
        `Install workspace deps first (e.g. \`bun install\`).`,
    );
  }
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((res) => {
    const done = () => res();
    child.once("exit", done);
    try {
      child.kill("SIGTERM");
    } catch {
      res();
      return;
    }
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }, 3000).unref();
  });
}

// --- Default dependency implementations --------------------------------------

function defaultEditDeps(): EditDeps {
  return {
    log: (msg) => console.log(msg),
    spawnServer: defaultSpawnServer,
    waitForServer: defaultWaitForServer,
    openBrowser: defaultOpenBrowser,
    watchProject: defaultWatchProject,
    reloadProject: defaultReloadProject,
  };
}

/**
 * `apps/editor` in the monorepo is the AdonisJS *source* tree (has
 * `ace.js` + `adonisrc.ts`, run via `node ace serve --hmr`). A packaged
 * install ships only the prebuilt `editor-dist/` (see
 * `scripts/build-editor.mjs`) — no `adonisrc.ts`, no `--hmr`, started via
 * `node bin/server.js` in production mode instead.
 */
function isDevEditorSource(editorAppDir: string): boolean {
  return existsSync(join(editorAppDir, "adonisrc.ts"));
}

function defaultSpawnServer(input: SpawnServerInput): ChildProcess {
  if (isDevEditorSource(input.editorAppDir)) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DAVIDUP_PROJECT: input.projectDir,
      PORT: String(input.port),
      HOST: input.host,
      NODE_ENV: process.env.NODE_ENV ?? "development",
    };
    return spawn("node", ["ace", "serve", "--hmr"], {
      cwd: input.editorAppDir,
      env,
      stdio: "inherit",
    });
  }
  return spawnPackagedServer(input);
}

/**
 * Boot the prebuilt (`editor-dist/`) editor in production mode. Unlike the
 * dev path, this needs a couple of things AdonisJS's env schema requires but
 * `node ace serve` fills in for you: an `APP_KEY` (regenerated per launch —
 * this is a local single-user tool, so cookie/session invalidation across
 * restarts is a non-issue) and a writable sqlite path outside the installed
 * package directory (`~/.davidup/editor.sqlite3` via `DAVIDUP_DB_PATH`, see
 * `apps/editor/config/database.ts`). Runs pending migrations synchronously
 * before starting the long-lived server process — best-effort: a migration
 * failure is logged to stderr but doesn't block boot, matching how the dev
 * path already tolerates preload failures.
 */
function spawnPackagedServer(input: SpawnServerInput): ChildProcess {
  const dbDir = join(homedir(), ".davidup");
  try {
    mkdirSync(dbDir, { recursive: true });
  } catch {
    /* best-effort — migration/db-open below will surface a real error */
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DAVIDUP_PROJECT: input.projectDir,
    PORT: String(input.port),
    HOST: input.host,
    NODE_ENV: "production",
    APP_KEY: process.env.APP_KEY ?? randomBytes(24).toString("base64"),
    LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
    SESSION_DRIVER: process.env.SESSION_DRIVER ?? "cookie",
    DAVIDUP_DB_PATH: process.env.DAVIDUP_DB_PATH ?? join(dbDir, "editor.sqlite3"),
  };

  // `node ace.js migration:run --force` runs the migration to completion
  // (observed at ~30-50ms for this app's one migration) but never exits the
  // process afterward — the ace kernel/lucid connection pool keeps the event
  // loop alive, and it doesn't even respond to SIGTERM (verified: still alive
  // 3s after a plain SIGTERM). So every `davidup edit` boot pays the full
  // `timeout` below as fixed latency; keep it as small as safely possible
  // (3s comfortably covers the observed sub-100ms real work) and use SIGKILL
  // so the bound is actually enforced. A timeout kill (status null, signal
  // set) is treated as success, not a warning — only a genuine nonzero exit
  // (no signal — the command actually ran and failed) is surfaced, matching
  // the "best-effort, non-fatal" tolerance the rest of the boot sequence
  // (preloads) already has.
  const migration = spawnSync("node", ["ace.js", "migration:run", "--force"], {
    cwd: input.editorAppDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 3_000,
    killSignal: "SIGKILL",
  });
  if (migration.status !== 0 && migration.signal === null) {
    process.stderr.write(
      `davidup edit · warning: migration:run exited ${migration.status} — ` +
        `${(migration.stderr?.toString() ?? "").trim() || (migration.stdout?.toString() ?? "").trim()}\n`,
    );
  }

  return spawn("node", ["bin/server.js"], {
    cwd: input.editorAppDir,
    env,
    stdio: "inherit",
  });
}

async function defaultWaitForServer(
  url: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    try {
      await probe(`${url}/api/project`);
      return;
    } catch (err) {
      lastErr = err as Error;
      await sleep(200);
    }
  }
  throw new EditError(
    "E_SERVER_TIMEOUT",
    `Editor server at ${url} did not become ready within ${timeoutMs}ms` +
      (lastErr ? ` (last error: ${lastErr.message})` : ""),
  );
}

function probe(url: string): Promise<void> {
  return new Promise<void>((res, rej) => {
    const req = request(url, { method: "GET" }, (response) => {
      response.resume();
      // 200 = project loaded; 404 = server up but no project; both mean the
      // HTTP server has bound the port and is answering requests.
      if (response.statusCode && response.statusCode < 500) {
        res();
      } else {
        rej(new Error(`HTTP ${response.statusCode}`));
      }
    });
    req.on("error", rej);
    req.setTimeout(2000, () => {
      req.destroy(new Error("probe timeout"));
    });
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function defaultOpenBrowser(url: string): Promise<void> {
  const os = platform();
  let cmd: string;
  let args: string[];
  if (os === "darwin") {
    cmd = "open";
    args = [url];
  } else if (os === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  await new Promise<void>((res, rej) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.once("error", rej);
    child.once("spawn", () => {
      child.unref();
      res();
    });
  });
}

function defaultWatchProject(
  projectDir: string,
  onChange: () => void,
): () => void {
  const watchers: FSWatcher[] = [];
  const compositionPath = join(projectDir, "composition.json");
  try {
    watchers.push(
      fsWatch(compositionPath, { persistent: true }, () => onChange()),
    );
  } catch {
    /* the file may not exist yet — skip silently */
  }
  const libraryDir = join(projectDir, "library");
  try {
    watchers.push(
      fsWatch(libraryDir, { persistent: true, recursive: true }, () =>
        onChange(),
      ),
    );
  } catch {
    /* library/ optional */
  }
  return () => {
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
  };
}

async function defaultReloadProject(
  url: string,
  projectDir: string,
): Promise<void> {
  await new Promise<void>((res, rej) => {
    const body = JSON.stringify({ directory: projectDir });
    const req = request(
      `${url}/api/project`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 400) {
          res();
        } else {
          rej(new Error(`reload HTTP ${response.statusCode}`));
        }
      },
    );
    req.on("error", rej);
    req.write(body);
    req.end();
  });
}

export const __testing = {
  defaultEditDeps,
};
