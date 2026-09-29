// Asset library H4: the house shelf is <repo>/assets, and the npm package ships it (package.json#files:
// assets/catalogue.json, assets/blobs), so an installed davidup resolves `asset:teapot` with no ~/.davidup.
//
// `npm pack --dry-run` names what the package carries; the test copies those files for assetlib and the
// house shelf into a temp "install" and opens the library from there, with an empty home and no overrides.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { HOUSE_ROOT, gitIgnored, readShelf } from "../../assetlib/index.js";

const REPO = new URL("../..", import.meta.url).pathname;
const temp = realpathSync(mkdtempSync(join(tmpdir(), "davidup-house-")));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

// The package's file list, without running prepack (no build needed for the list).
function packed(): string[] {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: REPO, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return (JSON.parse(r.stdout) as Array<{ files: Array<{ path: string }> }>)[0]!.files.map((f) => f.path);
}

describe("the house shelf at <repo>/assets (asset library H4, integration)", () => {
  it("is the repo's assets/ directory, and hdf's store is it", async () => {
    expect(HOUSE_ROOT).toBe(join(REPO, "assets"));
    const { ASSET_ROOT } = await import("../../handdrawn/core/assets.js");
    expect(ASSET_ROOT).toBe(HOUSE_ROOT);
    expect(existsSync(join(REPO, "handdrawn", "assets"))).toBe(false);
  });

  it("ships in the npm package and resolves from an install with no ~/.davidup", async () => {
    const files = packed();
    const house = readShelf(HOUSE_ROOT);
    // A made blob git ignores (the model sheets, I2) stays out: `asset remake` makes it where it is wanted.
    const off = gitIgnored(HOUSE_ROOT, house.ids.map((id) => house.blobPath(house.entry(id))));
    const made = house.ids.filter((id) => house.entry(id).made && off.has(house.blobPath(house.entry(id))));
    const blobs = new Set(house.ids.filter((id) => !made.includes(id)).map((id) => `assets/blobs/${house.entry(id).sha}.${house.entry(id).ext}`));
    expect(files).toContain("assets/catalogue.json");
    expect([...blobs].filter((b) => !files.includes(b))).toEqual([]);
    expect(made.map((id) => `assets/blobs/${house.entry(id).sha}.${house.entry(id).ext}`).filter((b) => files.includes(b))).toEqual([]);
    // Only the catalogue and the blobs: sources, sheets and thumbs stay in the repo.
    expect(files.filter((f) => f.startsWith("assets/") && f !== "assets/catalogue.json" && !f.startsWith("assets/blobs/"))).toEqual([]);

    const pkg = join(temp, "node_modules", "davidup");
    for (const f of files.filter((p) => p.startsWith("assets/") || /^assetlib\/[^/]+\.(js|json)$/.test(p))) {
      mkdirSync(dirname(join(pkg, f)), { recursive: true });
      copyFileSync(join(REPO, f), join(pkg, f));
    }
    const lib = (await import(pathToFileURL(join(pkg, "assetlib", "index.js")).href)) as typeof import("../../assetlib/index.js");
    expect(lib.HOUSE_ROOT).toBe(join(pkg, "assets"));
    const home = join(temp, "home");
    mkdirSync(home);
    const opened = lib.openLibrary({ shelves: lib.standardShelves({ env: {}, home }) });
    const teapot = opened.locate("teapot");
    expect(teapot.shelf).toBe("house");
    expect(teapot.path.startsWith(join(pkg, "assets", "blobs"))).toBe(true);
    expect(readFileSync(teapot.path).equals(readFileSync(house.blobPath("teapot")))).toBe(true);
  }, 60_000);
});
