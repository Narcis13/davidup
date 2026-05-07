import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// Demo Vite config. The page imports source TS directly — Vite resolves
// .js → .ts on the fly. We allow serving from the repo root so static
// assets (ball.png, fonts/*.ttf) tucked next to the engine source can be
// referenced via ?url imports without copying into a public/ dir.
export default defineConfig({
  root: HERE,
  server: {
    port: 5174,
    open: true,
    fs: {
      // Allow Vite to serve files from anywhere under the repo root.
      // Without this it'd refuse to read examples/ball.png from the page.
      allow: [REPO_ROOT],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
