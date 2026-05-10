import { defineConfig } from "vite";

// Demo-only Vite config. Engine source is imported as TS — vite resolves the
// `.js` specifiers to the on-disk `.ts` files at dev time.
export default defineConfig({
  root: __dirname,
  server: {
    port: 5176,
    open: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
