import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// Demo Vite config for the v0.4 four-scenes-60s browser preview. Same shape
// as comprehensive-split-browser but on a different port so all browser
// demos can run side-by-side.
export default defineConfig({
  root: HERE,
  server: {
    port: 5177,
    open: true,
    fs: {
      // Allow Vite to serve files from anywhere under the repo root so it
      // can read the entry composition + scene JSON under
      // examples/four-scenes-60s/ and the font under examples/fonts/.
      allow: [REPO_ROOT],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // main.ts uses top-level await for the precompile pass; default Vite
    // target (chrome87/safari14) refuses to transpile that.
    target: "esnext",
  },
});
