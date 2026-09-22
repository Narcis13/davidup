import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  runEdit,
  EditError,
  hdfEnv,
  hmrPortFor,
  spawnDevServer,
  spawnPackagedServer,
  type DevSpawnIO,
  type EditDeps,
  type PackagedSpawnIO,
} from "../../src/cli/edit.js";

const tmps: string[] = [];
afterEach(async () => {
  while (tmps.length) {
    const d = tmps.pop()!;
    await rm(d, { recursive: true, force: true });
  }
});

const REPO_ROOT = resolve(__dirname, "..", "..");
const EDITOR_APP_DIR = join(REPO_ROOT, "apps", "editor");

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  kill(_signal?: NodeJS.Signals | number): boolean {
    if (this.exitCode !== null) return false;
    this.killed = true;
    this.exitCode = 0;
    setImmediate(() => this.emit("exit", 0, "SIGTERM"));
    return true;
  }
}

function makeDeps(overrides: Partial<EditDeps> = {}): {
  deps: EditDeps;
  spawned: { count: number; lastInput?: unknown };
  child: FakeChild;
  opened: string[];
  reloads: string[];
  watcherCallbacks: Array<() => void>;
} {
  const spawned = { count: 0, lastInput: undefined as unknown };
  const child = new FakeChild();
  const opened: string[] = [];
  const reloads: string[] = [];
  const watcherCallbacks: Array<() => void> = [];
  const deps: EditDeps = {
    log: () => {},
    spawnServer: (input) => {
      spawned.count += 1;
      spawned.lastInput = input;
      return child as unknown as ChildProcess;
    },
    waitForServer: async () => {},
    openBrowser: async (url) => {
      opened.push(url);
    },
    watchProject: (_dir, onChange) => {
      watcherCallbacks.push(onChange);
      return () => {};
    },
    reloadProject: async (url) => {
      reloads.push(url);
    },
    ...overrides,
  };
  return { deps, spawned, child, opened, reloads, watcherCallbacks };
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "davidup-edit-test-"));
  tmps.push(dir);
  await writeFile(
    join(dir, "composition.json"),
    JSON.stringify({
      version: "0.1",
      composition: {
        width: 16,
        height: 9,
        fps: 60,
        duration: 1,
        background: "#000",
      },
      assets: [],
      layers: [],
      items: {},
      tweens: [],
    }),
    "utf8",
  );
  return dir;
}

describe("cli · runEdit", () => {
  it("rejects when the project dir does not exist", async () => {
    const { deps } = makeDeps();
    const missing = join(tmpdir(), `davidup-edit-missing-${Date.now()}`);
    await expect(
      runEdit({ projectDir: missing, editorAppDir: EDITOR_APP_DIR }, deps),
    ).rejects.toMatchObject({ code: "E_PROJECT_NOT_FOUND" });
  });

  it("rejects when composition.json is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "davidup-edit-empty-"));
    tmps.push(dir);
    const { deps } = makeDeps();
    await expect(
      runEdit({ projectDir: dir, editorAppDir: EDITOR_APP_DIR }, deps),
    ).rejects.toMatchObject({ code: "E_COMPOSITION_MISSING" });
  });

  it("rejects when editor app dir is missing", async () => {
    const dir = await makeProject();
    const fakeEditor = join(tmpdir(), `davidup-no-editor-${Date.now()}`);
    const { deps } = makeDeps();
    await expect(
      runEdit({ projectDir: dir, editorAppDir: fakeEditor }, deps),
    ).rejects.toMatchObject({ code: "E_EDITOR_APP_MISSING" });
  });

  it("spawns the server, opens browser, returns a handle", async () => {
    const dir = await makeProject();
    const { deps, spawned, opened } = makeDeps();
    const handle = await runEdit(
      {
        projectDir: dir,
        editorAppDir: EDITOR_APP_DIR,
        port: 4242,
        host: "127.0.0.1",
        noWatch: true,
      },
      deps,
    );
    expect(spawned.count).toBe(1);
    expect(spawned.lastInput).toMatchObject({
      projectDir: dir,
      port: 4242,
      host: "127.0.0.1",
    });
    expect(handle.url).toBe("http://127.0.0.1:4242");
    expect(opened).toEqual(["http://127.0.0.1:4242/editor"]);
    await handle.close();
  });

  it("skips browser open when noOpen=true", async () => {
    const dir = await makeProject();
    const { deps, opened } = makeDeps();
    const handle = await runEdit(
      {
        projectDir: dir,
        editorAppDir: EDITOR_APP_DIR,
        noOpen: true,
        noWatch: true,
      },
      deps,
    );
    expect(opened).toEqual([]);
    await handle.close();
  });

  it("reloads project when watcher fires", async () => {
    const dir = await makeProject();
    // Library dir so default watcher would have something to attach; ours
    // is stubbed but we exercise the callback wiring directly.
    await mkdir(join(dir, "library"), { recursive: true });
    const { deps, watcherCallbacks, reloads } = makeDeps();
    const handle = await runEdit(
      {
        projectDir: dir,
        editorAppDir: EDITOR_APP_DIR,
        noOpen: true,
      },
      deps,
    );
    expect(watcherCallbacks.length).toBe(1);
    watcherCallbacks[0]!();
    // Reload is fired after a 100ms coalesce timer.
    await new Promise((r) => setTimeout(r, 200));
    expect(reloads.length).toBe(1);
    expect(reloads[0]).toBe(handle.url);
    await handle.close();
  });

  it("propagates a server-readiness failure", async () => {
    const dir = await makeProject();
    const { deps } = makeDeps({
      waitForServer: async () => {
        throw new EditError("E_SERVER_TIMEOUT", "did not become ready");
      },
    });
    await expect(
      runEdit(
        {
          projectDir: dir,
          editorAppDir: EDITOR_APP_DIR,
          noOpen: true,
          noWatch: true,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "E_SERVER_TIMEOUT" });
  });
});

describe("cli · spawnPackagedServer", () => {
  const input = {
    editorAppDir: "/pkg/editor-dist",
    projectDir: "/work/clip",
    port: 4444,
    host: "127.0.0.1",
  };

  interface Call {
    cmd: string;
    args: readonly string[];
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; killSignal?: string };
  }

  function fakeIO(
    env: NodeJS.ProcessEnv,
    migration: { status: number | null; signal: NodeJS.Signals | null; stderr?: string } = {
      status: 0,
      signal: null,
    },
  ) {
    const syncCalls: Call[] = [];
    const spawnCalls: Call[] = [];
    const mkdirs: string[] = [];
    const warnings: string[] = [];
    const child = new FakeChild();
    const io: PackagedSpawnIO = {
      spawn: ((cmd: string, args: readonly string[], opts: Call["opts"]) => {
        spawnCalls.push({ cmd, args, opts });
        return child as unknown as ChildProcess;
      }) as unknown as PackagedSpawnIO["spawn"],
      spawnSync: ((cmd: string, args: readonly string[], opts: Call["opts"]) => {
        syncCalls.push({ cmd, args, opts });
        return {
          status: migration.status,
          signal: migration.signal,
          stdout: Buffer.from(""),
          stderr: Buffer.from(migration.stderr ?? ""),
        };
      }) as unknown as PackagedSpawnIO["spawnSync"],
      mkdirSync: (dir) => {
        mkdirs.push(dir);
      },
      homedir: () => "/home/u",
      env,
      warn: (msg) => {
        warnings.push(msg);
      },
    };
    return { io, syncCalls, spawnCalls, mkdirs, warnings, child };
  }

  it("migrates, then starts bin/server.js in production with a generated APP_KEY", () => {
    const { io, syncCalls, spawnCalls, mkdirs, warnings, child } = fakeIO({ PATH: "/bin" });
    const out = spawnPackagedServer(input, io);

    expect(out).toBe(child);
    expect(mkdirs).toEqual(["/home/u/.davidup"]);

    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0]!.cmd).toBe("node");
    expect(syncCalls[0]!.args).toEqual(["ace.js", "migration:run", "--force"]);
    expect(syncCalls[0]!.opts).toMatchObject({
      cwd: "/pkg/editor-dist",
      timeout: 3_000,
      killSignal: "SIGKILL",
    });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.cmd).toBe("node");
    expect(spawnCalls[0]!.args).toEqual(["bin/server.js"]);
    expect(spawnCalls[0]!.opts.cwd).toBe("/pkg/editor-dist");

    const env = spawnCalls[0]!.opts.env!;
    expect(env).toMatchObject({
      PATH: "/bin",
      DAVIDUP_PROJECT: "/work/clip",
      PORT: "4444",
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      SESSION_DRIVER: "cookie",
      DAVIDUP_DB_PATH: "/home/u/.davidup/editor.sqlite3",
    });
    expect(Buffer.from(env.APP_KEY!, "base64")).toHaveLength(24);
    // Migration and server share one env, so they agree on APP_KEY + db path.
    expect(syncCalls[0]!.opts.env).toEqual(env);
    expect(warnings).toEqual([]);
  });

  it("respects operator overrides from the parent env", () => {
    const { io, spawnCalls } = fakeIO({
      APP_KEY: "fixed-key",
      LOG_LEVEL: "debug",
      SESSION_DRIVER: "memory",
      DAVIDUP_DB_PATH: "/tmp/db.sqlite3",
      NODE_ENV: "development",
    });
    spawnPackagedServer(input, io);
    expect(spawnCalls[0]!.opts.env).toMatchObject({
      APP_KEY: "fixed-key",
      LOG_LEVEL: "debug",
      SESSION_DRIVER: "memory",
      DAVIDUP_DB_PATH: "/tmp/db.sqlite3",
      // The packaged editor always runs in production mode.
      NODE_ENV: "production",
    });
  });

  it("treats a migration timeout kill as success", () => {
    const { io, spawnCalls, warnings } = fakeIO({}, { status: null, signal: "SIGKILL" });
    spawnPackagedServer(input, io);
    expect(warnings).toEqual([]);
    expect(spawnCalls).toHaveLength(1);
  });

  it("warns on a genuine migration failure but still boots the server", () => {
    const { io, spawnCalls, warnings } = fakeIO({}, { status: 1, signal: null, stderr: "no such table" });
    spawnPackagedServer(input, io);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("migration:run exited 1");
    expect(warnings[0]).toContain("no such table");
    expect(spawnCalls).toHaveLength(1);
  });

  it("boots even when the ~/.davidup directory cannot be created", () => {
    const { io, spawnCalls } = fakeIO({});
    io.mkdirSync = () => {
      throw new Error("EACCES");
    };
    spawnPackagedServer(input, io);
    expect(spawnCalls).toHaveLength(1);
  });
});

describe("cli · hmrPortFor", () => {
  it("follows --port + 1", () => {
    expect(hmrPortFor(3333, {})).toBe(3334);
    expect(hmrPortFor(4000, {})).toBe(4001);
  });

  it("steps down at the top of the port range", () => {
    expect(hmrPortFor(65_535, {})).toBe(65_534);
  });

  it("honours a valid DAVIDUP_HMR_PORT and ignores a bogus one", () => {
    expect(hmrPortFor(3333, { DAVIDUP_HMR_PORT: "5173" })).toBe(5173);
    expect(hmrPortFor(3333, { DAVIDUP_HMR_PORT: "nope" })).toBe(3334);
    expect(hmrPortFor(3333, { DAVIDUP_HMR_PORT: "70000" })).toBe(3334);
  });
});

// 4.0 D5: the editor runs from a copy of the engine whose handdrawn/ is stale or
// absent, so `davidup edit` names the package it sits beside for render_hdf_clip.
describe("hdfEnv", () => {
  it("names the checkout's handdrawn/ unless the env already names one", () => {
    expect(hdfEnv({})).toEqual({ DAVIDUP_HDF_ROOT: resolve(__dirname, "..", "..", "handdrawn") });
    expect(hdfEnv({ DAVIDUP_HDF_ROOT: "/elsewhere" })).toEqual({});
  });
});

describe("cli · spawnDevServer", () => {
  const input = {
    editorAppDir: "/fake/editor",
    projectDir: "/fake/project",
    port: 4100,
    host: "127.0.0.1",
  };

  function capture(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) {
    const calls: Array<{ cmd: string; args: readonly string[]; opts: Record<string, unknown> }> = [];
    const io: DevSpawnIO = {
      env,
      platform,
      spawn: ((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
        calls.push({ cmd, args, opts });
        return new FakeChild() as unknown as ChildProcess;
      }) as unknown as DevSpawnIO["spawn"],
    };
    return { io, calls };
  }

  it("spawns `ace serve --hmr` detached with the HMR port in env", () => {
    const { io, calls } = capture("darwin");
    spawnDevServer(input, io);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["ace", "serve", "--hmr"]);
    expect(calls[0]!.opts.detached).toBe(true);
    expect(calls[0]!.opts.env).toMatchObject({
      DAVIDUP_PROJECT: "/fake/project",
      PORT: "4100",
      HOST: "127.0.0.1",
      DAVIDUP_HMR_PORT: "4101",
      NODE_ENV: "development",
    });
  });

  it("does not detach on Windows (no process groups)", () => {
    const { io, calls } = capture("win32");
    spawnDevServer(input, io);
    expect(calls[0]!.opts.detached).toBe(false);
  });
});

// Bug 2.2: `ace serve --hmr` is a supervisor that forks `bin/server.js`;
// closing the edit handle must take the grandchild down too. This drives the
// real spawnDevServer/terminate path with a stand-in supervisor script.
describe.skipIf(process.platform === "win32")("cli · dev-mode teardown (bug 2.2)", () => {
  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = await fn();
      if (v !== null) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timed out");
  }

  it("leaves no child processes behind after close()", async () => {
    const project = await makeProject();
    const pidFile = join(project, "grandchild.pid");
    // Supervisor forks a long-lived grandchild into its own process group
    // (the default for child_process) and — like the real assembler loop —
    // does nothing to forward signals to it.
    // The grandchild writes its own pid once its SIGTERM handler is armed,
    // so the test can't race it into dying from the default handler.
    const grandchild = `
      process.on("SIGTERM", () => {});
      require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      setInterval(() => {}, 1000);
    `;
    const supervisor = `
      const { spawn } = require("node:child_process");
      spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });
      setInterval(() => {}, 1000);
    `;
    const io: DevSpawnIO = {
      env: process.env,
      platform: process.platform,
      // Keep spawnDevServer's options (detached, env) but swap the command.
      spawn: ((_cmd: string, _args: readonly string[], opts: Parameters<typeof spawn>[2]) =>
        spawn(process.execPath, ["-e", supervisor], { ...opts, stdio: "ignore" })) as unknown as DevSpawnIO["spawn"],
    };

    let supervisorPid: number | undefined;
    const handle = await runEdit(
      { projectDir: project, editorAppDir: EDITOR_APP_DIR, noOpen: true, noWatch: true },
      {
        log: () => {},
        spawnServer: (input) => {
          const child = spawnDevServer(input, io);
          supervisorPid = child.pid;
          return child;
        },
        waitForServer: async () => {},
        openBrowser: async () => {},
        watchProject: () => () => {},
        reloadProject: async () => {},
      },
    );

    const grandchildPid = await waitFor(async () => {
      const raw = await readFile(pidFile, "utf8").catch(() => "");
      return raw ? Number(raw) : null;
    });
    expect(alive(supervisorPid!)).toBe(true);
    expect(alive(grandchildPid)).toBe(true);

    await handle.close();

    expect(alive(supervisorPid!)).toBe(false);
    // The grandchild ignores SIGTERM, so this also exercises the SIGKILL sweep.
    await waitFor(async () => (alive(grandchildPid) ? null : true), 2_000);
    expect(alive(grandchildPid)).toBe(false);
  }, 20_000);
});
