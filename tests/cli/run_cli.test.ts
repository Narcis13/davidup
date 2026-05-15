import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, parseArgs } from "../../src/cli/cli.js";
import { VERSION } from "../../src/index.js";
import type { EditHandle } from "../../src/cli/edit.js";

interface CapturedIo {
  out: string[];
  err: string[];
  io: { log: (m: string) => void; error: (m: string) => void };
}

function captureIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { log: (m) => out.push(m), error: (m) => err.push(m) },
  };
}

const tmps: string[] = [];
afterEach(async () => {
  while (tmps.length) {
    const d = tmps.pop()!;
    await rm(d, { recursive: true, force: true });
  }
});

describe("cli · runCli", () => {
  it("--help prints usage and exits 0", async () => {
    const cap = captureIo();
    const code = await runCli(["--help"], { io: cap.io, cwd: process.cwd() });
    expect(code).toBe(0);
    expect(cap.out.join("\n")).toMatch(/USAGE/);
    expect(cap.out.join("\n")).toMatch(/davidup edit/);
  });

  it("--version prints VERSION and exits 0", async () => {
    const cap = captureIo();
    const code = await runCli(["--version"], { io: cap.io, cwd: process.cwd() });
    expect(code).toBe(0);
    expect(cap.out).toContain(VERSION);
  });

  it("no-args prints help (exit 0)", async () => {
    const cap = captureIo();
    const code = await runCli([], { io: cap.io, cwd: process.cwd() });
    expect(code).toBe(0);
  });

  it("unknown command exits 2 with usage hint", async () => {
    const cap = captureIo();
    const code = await runCli(["frob"], { io: cap.io, cwd: process.cwd() });
    expect(code).toBe(2);
    expect(cap.err.join("\n")).toMatch(/Unknown command/);
  });

  it("`new <dir>` scaffolds a project and exits 0", async () => {
    const parent = await mkdtemp(join(tmpdir(), "davidup-cli-new-"));
    tmps.push(parent);
    const target = join(parent, "fresh");
    const cap = captureIo();
    const code = await runCli(["new", target], {
      io: cap.io,
      cwd: process.cwd(),
    });
    expect(code).toBe(0);
    expect(cap.out.join("\n")).toMatch(/scaffolded project/);
    const compStat = await import("node:fs").then((m) =>
      m.promises.stat(join(target, "composition.json")),
    );
    expect(compStat.isFile()).toBe(true);
  });

  it("`edit <dir>` errors when composition.json is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "davidup-cli-edit-missing-"));
    tmps.push(root);
    const cap = captureIo();
    const code = await runCli(["edit", root], {
      io: cap.io,
      cwd: process.cwd(),
    });
    expect(code).toBe(1);
    expect(cap.err.join("\n")).toMatch(/not a davidup project/);
  });

  it("`edit <dir>` invokes the edit boot with parsed flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "davidup-cli-edit-stub-"));
    tmps.push(root);
    // Seed a minimal composition.json so the pre-boot check passes.
    await writeFile(
      join(root, "composition.json"),
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
    const cap = captureIo();

    let received:
      | Parameters<typeof import("../../src/cli/edit.js").runEdit>[0]
      | null = null;
    const stubHandle: EditHandle = {
      url: "http://localhost:4242",
      close: async () => {},
    };
    // The CLI awaits a never-resolving promise after a successful boot,
    // so wrap runCli in a race to time it out deterministically.
    const cliP = runCli(["edit", root, "--port=4242", "--no-open"], {
      io: cap.io,
      cwd: process.cwd(),
      runEditFn: async (opts) => {
        received = opts;
        return stubHandle;
      },
    });
    const winner = await Promise.race([
      cliP.then(() => "cli" as const),
      new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 200)),
    ]);
    expect(winner).toBe("timeout");
    expect(received).not.toBeNull();
    expect(received!.port).toBe(4242);
    expect(received!.noOpen).toBe(true);
    expect(received!.projectDir).toBe(root);

    await stubHandle.close();
  });
});

// Sanity wiring check: parseArgs is exported from the same module.
describe("cli · module surface", () => {
  it("re-exports parseArgs", () => {
    expect(typeof parseArgs).toBe("function");
  });
});
