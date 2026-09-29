// Asset library D5: `scripts/seed-global-library.ts` puts its ten fonts on the
// user asset shelf and lists them in index.json as `asset:<id>` srcs, leaving
// index.json's `assets` alone. The script runs under bun, so it is spawned
// the way a user runs it, against temp roots. No network: the font files are
// put where an earlier seed left them (<library>/fonts/<file>), which is where
// a run looks before it downloads.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readShelf } from "../../assetlib/index.js";
import { CompositionStore, TOOLS, dispatchTool } from "../../src/mcp/index.js";
import { repoRoot } from "../assets/libraryShelves.js";

const FILES: Record<string, string> = {
  "inter-bold": "inter-700.woff2",
  "inter-regular": "inter-400.woff2",
  "bebas-neue": "bebas-neue-400.woff2",
  anton: "anton-400.woff2",
  "playfair-display-bold": "playfair-display-700.woff2",
  "montserrat-bold": "montserrat-700.woff2",
  "space-grotesk": "space-grotesk-500.woff2",
  "jetbrains-mono": "jetbrains-mono-500.woff2",
  "caveat-bold": "caveat-700.woff2",
  "dm-sans": "dm-sans-500.woff2",
};
const IDS = Object.keys(FILES);

let dir: string;
let library: string;
let assets: string;

function seed(...args: string[]) {
  const r = spawnSync("bun", ["run", join(repoRoot, "scripts", "seed-global-library.ts"), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DAVIDUP_LIBRARY: library, DAVIDUP_ASSETS: assets },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const fontLines = (out: string) => out.split("\n").filter((l) => /^ {2}font {6}/.test(l));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "davidup-seed-"));
  library = join(dir, "library");
  assets = join(dir, "assets");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("seed-global-library puts its fonts on the user shelf (D5)", () => {
  it("a dry run against a fresh root lists ten font puts and writes nothing", () => {
    const { code, out } = seed("--dry-run");
    expect(code).toBe(0);
    const lines = fontLines(out);
    expect(lines).toHaveLength(10);
    for (const [i, id] of IDS.entries()) expect(lines[i]).toMatch(new RegExp(`^ {2}font {6}${id} +would download and put \\(dry-run\\)$`));
    expect(out).toContain("fonts      10 to put / 0 unchanged / 0 skipped");
    expect(existsSync(library)).toBe(false);
    expect(existsSync(assets)).toBe(false);
  });

  it("puts ten OFL font records, keeps index.json's assets, and a second run is a no-op", async () => {
    // What an earlier seed left: the font files, and an index.json with an
    // upload and a font of the user's own.
    mkdirSync(join(library, "fonts"), { recursive: true });
    for (const file of Object.values(FILES)) copyFileSync(join(repoRoot, "fonts", "Inter-Regular.ttf"), join(library, "fonts", file));
    const upload = { id: "logo", kind: "image", hash: "abc", url: "global:assets/logo.png" };
    const own = { id: "brand", type: "font", family: "Brand", src: "global:fonts/brand.ttf" };
    writeFileSync(
      join(library, "index.json"),
      JSON.stringify({ assets: [upload], fonts: [own, { id: "anton", type: "font", family: "Anton", src: "global:fonts/anton-400.woff2" }] }),
    );

    const first = seed();
    expect(first.code, first.err).toBe(0);
    expect(fontLines(first.out).every((l) => / put$/.test(l))).toBe(true);

    const shelf = readShelf(assets);
    expect(shelf.ids).toEqual([...IDS].sort());
    expect(shelf.entry("anton")).toMatchObject({
      kind: "font",
      name: "Anton",
      family: "Anton",
      weight: 400,
      licence: "OFL",
      credit: "Anton by Vernon Adams",
      source: "https://cdn.jsdelivr.net/npm/@fontsource/anton/files/anton-latin-400-normal.woff2",
      by: "seed",
    });
    expect(shelf.entry("inter-bold")).toMatchObject({ family: "Inter", weight: 700, credit: "Inter by Rasmus Andersson" });
    expect(shelf.entry("inter-bold").tags).toContain("font");

    const index = JSON.parse(readFileSync(join(library, "index.json"), "utf8"));
    expect(index.assets).toEqual([upload]);
    expect(index.fonts.map((f: { id: string; src: string }) => [f.id, f.src])).toEqual([
      ...IDS.map((id) => [id, `asset:${id}`]),
      ["brand", "global:fonts/brand.ttf"],
    ]);
    // The files stay where `global:fonts/...` finds them.
    expect(existsSync(join(library, "fonts", "anton-400.woff2"))).toBe(true);

    const before = [readFileSync(join(assets, "catalogue.json"), "utf8"), readFileSync(join(library, "index.json"), "utf8")];
    const second = seed();
    expect(second.code, second.err).toBe(0);
    expect(fontLines(second.out).every((l) => / unchanged$/.test(l))).toBe(true);
    expect(second.out).toContain("fonts      0 put / 10 unchanged / 0 skipped");
    expect(second.out).toMatch(/index {5}index\.json +unchanged/);
    expect([readFileSync(join(assets, "catalogue.json"), "utf8"), readFileSync(join(library, "index.json"), "utf8")]).toEqual(before);
    expect(seed("--dry-run").out).toContain("fonts      0 to put / 10 unchanged / 0 skipped");

    // list_fonts lists them from the user shelf, with no editor.
    const envBefore = { ...process.env };
    try {
      Object.assign(process.env, { DAVIDUP_ASSETS: assets, DAVIDUP_HOUSE: join(dir, "house") });
      delete process.env.DAVIDUP_PROJECT;
      const deps = { store: new CompositionStore() };
      deps.store.createComposition({ width: 64, height: 64, fps: 30, duration: 1 });
      const out = await dispatchTool(TOOLS.find((t) => t.name === "list_fonts")!, {}, deps);
      if (!out.ok) throw new Error(out.error.message);
      const { library: fonts } = out.result as { library: { id: string; scope: string; shelf: string; licence: string; src: string }[] };
      expect(fonts.map((f) => f.id).sort()).toEqual([...IDS].sort());
      for (const f of fonts) {
        expect(f).toMatchObject({ scope: "global", shelf: "user", licence: "OFL" });
        expect(f.src).toMatch(new RegExp(`^asset:${f.id}@[0-9a-f]{12}$`));
      }
    } finally {
      process.env = envBefore;
    }
  });

  it("--skip-fonts leaves the shelf and index.json alone", () => {
    const { code, out } = seed("--skip-fonts");
    expect(code).toBe(0);
    expect(fontLines(out)).toEqual([]);
    expect(existsSync(join(library, "index.json"))).toBe(false);
    expect(existsSync(assets)).toBe(false);
  });
});
