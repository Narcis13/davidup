import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// Demo Vite config for the split-file (v0.2 $ref) variant of the
// comprehensive demo. Same shape as comprehensive-browser but on a different
// port so both can run side-by-side.
export default defineConfig({
  root: HERE,
  server: {
    port: 5175,
    open: true,
    fs: {
      // Allow Vite to serve files from anywhere under the repo root.
      // Without this it'd refuse to read examples/ball.png from the page,
      // and it'd refuse to read the split JSON from comprehensive-split/.
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
