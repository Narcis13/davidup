// Copies non-.ts assets that `tsc` doesn't emit into `dist/`.
//
// `src/cli/scaffold.ts` resolves its template directory relative to its own
// compiled location (`new URL("./templates/basic", import.meta.url)`), so
// `dist/cli/templates/**` must exist alongside `dist/cli/scaffold.js` or
// `davidup new` breaks the moment it runs from the built package instead of
// from source. Run after `tsc` as part of `npm run build`.

import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const SRC = join(REPO_ROOT, "src", "cli", "templates");
const DEST = join(REPO_ROOT, "dist", "cli", "templates");

await mkdir(dirname(DEST), { recursive: true });
await cp(SRC, DEST, { recursive: true });

console.log(`copy-templates: ${SRC} -> ${DEST}`);
