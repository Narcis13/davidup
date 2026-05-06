import { defineConfig } from "vite";

// Demo-only Vite config. The engine itself is not bundled here — main.ts
// imports source TS directly (vite resolves the .js → .ts on the fly).
export default defineConfig({
  root: __dirname,
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
