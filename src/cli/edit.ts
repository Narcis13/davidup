// `davidup edit ./path` — boot the AdonisJS editor server with the given
// project directory pre-loaded, open the browser, and watch the project for
// external edits. This module is the orchestration layer; the actual side
// effects (spawning, watching, opening a browser) are factored into the
// `EditDeps` interface so tests can drive runEdit with stubs.

import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs, watch as fsWatch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { platform } from "node:os";
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

function defaultSpawnServer(input: SpawnServerInput): ChildProcess {
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
