import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import { runEdit, EditError, type EditDeps } from "../../src/cli/edit.js";

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
