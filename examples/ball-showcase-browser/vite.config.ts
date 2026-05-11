import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// Dev server for the ball-showcase browser preview. Same shape as
// four-scenes-browser; just a different port so demos can run side-by-side.
export default defineConfig({
  root: HERE,
  server: {
    port: 5178,
    open: true,
    fs: {
      // Vite needs to read the entry composition + scenes + snippet + ball.png
      // + fonts, all of which live outside this directory.
      allow: [REPO_ROOT],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // main.ts uses top-level await for the precompile pass.
    target: "esnext",
  },
});
