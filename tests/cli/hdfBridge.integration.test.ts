// handdrawn ↔ davidup bridge scripts (hand-drawn film 3.0, S16). They run
// under bun and shell out to `hdf` (node + skia-canvas + ffmpeg), so these
// tests spawn them the way a user would.

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { scaffoldProject } from "../../src/cli/scaffold.js";
import { CompositionStore, dispatchTool, TOOLS } from "../../src/mcp/index.js";

const REPO = resolve(__dirname, "..", "..");
const HDF_OUT = join(REPO, "handdrawn", "out");

function bun(script: string, ...args: string[]) {
  const r = spawnSync("bun", ["run", join(REPO, "scripts", script), ...args], { cwd: REPO, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

async function project(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "hdf-bridge-"));
  tmps.push(dir);
  await scaffoldProject({ targetDir: join(dir, "proj") });
  return join(dir, "proj");
}

// The assets the project's composition.json holds, listed by the engine's own list_assets.
async function listAssets(root: string) {
  const store = new CompositionStore();
  store.replaceComposition(JSON.parse(readFileSync(join(root, "composition.json"), "utf8")));
  const r = await dispatchTool(TOOLS.find((t) => t.name === "list_assets")!, {}, { store });
  if (!r.ok) throw new Error(r.error.message);
  return (r.result as { assets: Array<Record<string, unknown>> }).assets;
}

describe("hdf-to-davidup", () => {
  it("--dry-run prints the asset list and renders nothing", () => {
    rmSync(join(HDF_OUT, "fox-and-teapot-7f.mp4"), { force: true });
    const { code, out, err } = bun("hdf-to-davidup.ts", "fox-and-teapot", "--dry-run", "--frames", "7");
    expect(code, err).toBe(0);
    expect(out).toMatch(/^fox-and-teapot: 7 frames$/m);
    expect(out).toMatch(/^hdf-fox-and-teapot {2}video {2}hdf render .*fox-and-teapot\.js --frames 7$/m);
    expect(out).toMatch(/^hdf-fox-model {2}image {2}hdf sheet store fox --poses$/m);
    expect(existsSync(join(HDF_OUT, "fox-and-teapot-7f.mp4"))).toBe(false);
  });

  it("names a project it cannot find", () => {
    const { code, err } = bun("hdf-to-davidup.ts", "mini", "--project", join(tmpdir(), "no-such-davidup-project"));
    expect(code).toBe(1);
    expect(err).toMatch(/no davidup project/);
  });

  it("registers a 6-frame mini render into a project, and list_assets lists it", async () => {
    const root = await project();
    const { code, out, err } = bun("hdf-to-davidup.ts", "mini", "--project", root, "--frames", "6");
    expect(code, err).toBe(0);
    expect(out).toMatch(/hdf-mini {2}video {2}assets\/hdf\/hdf-mini\.mp4/);
    expect(existsSync(join(root, "assets", "hdf", "hdf-mini.mp4"))).toBe(true);
    const video = (await listAssets(root)).find((a) => a.id === "hdf-mini");
    expect(video).toMatchObject({ type: "video", src: "assets/hdf/hdf-mini.mp4", width: 1080, height: 1080, duration: 0.5 });

    // A second run replaces the asset instead of failing on a duplicate id.
    expect(bun("hdf-to-davidup.ts", "mini", "--project", root, "--frames", "6").code).toBe(0);
    expect((await listAssets(root)).filter((a) => a.id === "hdf-mini")).toHaveLength(1);
  });
});

describe("davidup-hdf-clip", () => {
  it("renders the film a video item names and points its asset at the mp4", async () => {
    const root = await project();
    const file = join(root, "composition.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.items.clip = {
      type: "video", asset: "ball", name: "hdf:mini", width: 360, height: 360, start: 0, fit: "contain", loop: true,
      transform: { x: 640, y: 360, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
    };
    doc.layers[0].items.push("clip");
    writeFileSync(file, JSON.stringify(doc, null, 2));

    expect(bun("davidup-hdf-clip.ts", file, "badge").err).toMatch(/is a shape, not a video/);
    const { code, out, err } = bun("davidup-hdf-clip.ts", file, "clip", "--frames", "6");
    expect(code, err).toBe(0);
    expect(out).toMatch(/clip plays ball {2}video {2}assets\/hdf\/ball\.mp4/);
    expect((await listAssets(root)).find((a) => a.id === "ball")).toMatchObject({ type: "video", duration: 0.5 });
    // The item itself is untouched.
    expect(JSON.parse(readFileSync(file, "utf8")).items.clip).toEqual(doc.items.clip);
  });
});
