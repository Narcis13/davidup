// Builds the AdonisJS editor into a standalone, publishable bundle at
// `editor-dist/` (repo root) — the packaged counterpart of `apps/editor`
// used by a global/npx install (R-9). Two things make the dev copy of
// `apps/editor` unsuitable for shipping as-is:
//
//   1. It's a full monorepo workspace member (own node_modules, tests,
//      lockfiles, `--hmr` dev server) — way more than a production install
//      needs, and `node ace serve --hmr` doesn't exist in a built app.
//   2. It depends on `davidup` via `"file:../.."`, which only resolves
//      inside this repo's workspace layout. Once `editor-dist/` ships nested
//      inside the published `davidup` package (`node_modules/davidup/editor-dist`),
//      a bare `import ... from "davidup/mcp"` needs an actual `davidup`
//      package reachable by normal Node resolution from that location — so
//      this script vendors a private copy of the *root* package's build
//      output at `editor-dist/node_modules/davidup/`.
//
// Steps:
//   1. `node ace build` inside apps/editor (production build: vite client +
//      SSR bundles, tsc-compiled app code, copied meta files).
//   2. Copy the result to `editor-dist/`, dropping dev-only directories.
//   3. Rewrite `editor-dist/package.json`: drop devDependencies and the
//      `file:../..` self-dependency (editor-dist resolves `davidup` via the
//      vendored copy below, not a workspace link).
//   4. Vendor `dist/` + a matching `package.json` at
//      `editor-dist/node_modules/davidup/` so `davidup/schema`, `davidup/mcp`,
//      etc. resolve via plain Node module resolution once editor-dist is
//      nested inside the real davidup package.
//
// Requires `apps/editor`'s own dependencies to already be installed (dev-time
// only — `node ace build` needs @adonisjs/assembler, vite, etc. from there).
// Run `npm run build` (root dist/) before this, so the vendored copy isn't
// building against a stale dist/.

import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const EDITOR_APP_DIR = join(REPO_ROOT, "apps", "editor");
const EDITOR_BUILD_DIR = join(EDITOR_APP_DIR, "build");
const EDITOR_DIST_DIR = join(REPO_ROOT, "editor-dist");
const ROOT_DIST_DIR = join(REPO_ROOT, "dist");

if (!existsSync(ROOT_DIST_DIR)) {
  throw new Error(
    `build-editor: ${ROOT_DIST_DIR} does not exist — run \`npm run build\` first.`,
  );
}

console.log("build-editor: node ace build (apps/editor)");
execFileSync("node", ["ace", "build"], {
  cwd: EDITOR_APP_DIR,
  stdio: "inherit",
});

console.log(`build-editor: resetting ${EDITOR_DIST_DIR}`);
await rm(EDITOR_DIST_DIR, { recursive: true, force: true });
await mkdir(EDITOR_DIST_DIR, { recursive: true });

// Dev-only cruft that `node ace build` still emits into build/ (tests, source
// maps for tests) — the shipped editor never runs these.
const SKIP_TOP_LEVEL = new Set(["tests", "pnpm-lock.yaml", "package-lock.json"]);

await cp(EDITOR_BUILD_DIR, EDITOR_DIST_DIR, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(EDITOR_BUILD_DIR.length + 1);
    if (rel.length === 0) return true;
    const top = rel.split("/")[0];
    return !SKIP_TOP_LEVEL.has(top);
  },
});

console.log("build-editor: rewriting editor-dist/package.json");
const pkgPath = join(EDITOR_DIST_DIR, "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
delete pkg.devDependencies;
delete pkg.hotHook;
delete pkg.prettier;
delete pkg.eslintConfig;
if (pkg.dependencies) delete pkg.dependencies.davidup;
pkg.name = "davidup-editor";
pkg.version = (await readRootVersion()) ?? "0.0.0";
pkg.private = true;
pkg.scripts = { start: "node bin/server.js" };
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log("build-editor: vendoring davidup into editor-dist/node_modules/davidup");
const vendorDir = join(EDITOR_DIST_DIR, "node_modules", "davidup");
await mkdir(vendorDir, { recursive: true });
await cp(ROOT_DIST_DIR, join(vendorDir, "dist"), { recursive: true });

const rootPkg = JSON.parse(
  await readFile(join(REPO_ROOT, "package.json"), "utf8"),
);
const vendorExports = {};
for (const [key, value] of Object.entries(rootPkg.exports)) {
  if (typeof value === "string") {
    vendorExports[key] = value;
    continue;
  }
  // Drop the "bun" source-condition — the vendored copy only ever runs
  // under plain Node inside the packaged editor.
  const { bun: _bun, ...rest } = value;
  vendorExports[key] = rest;
}
await writeFile(
  join(vendorDir, "package.json"),
  `${JSON.stringify(
    {
      name: "davidup",
      version: rootPkg.version,
      type: "module",
      private: true,
      exports: vendorExports,
    },
    null,
    2,
  )}\n`,
);

console.log(`build-editor: done -> ${EDITOR_DIST_DIR}`);

async function readRootVersion() {
  try {
    const raw = await readFile(join(REPO_ROOT, "package.json"), "utf8");
    return JSON.parse(raw).version;
  } catch {
    return undefined;
  }
}
