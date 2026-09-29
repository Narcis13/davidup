// "Find before placing" (docs/asset-library-plan.md S1): a brief that gives
// no paths passes only when the agent searched the asset library before it
// registered anything, and every asset the composition ends up with is a
// library record pinned to its bytes (`asset:<id>@<sha12>`, what `use_asset`
// and a hit's `use.davidup` write). Pure, so tests/eval checks it without an
// API key.

import type { LibraryCheck, ToolTraceEntry } from "./types.js";

const PLACING = new Set(["register_asset", "use_asset"]);
const PINNED = /^asset:(pack:)?[a-z0-9][a-z0-9-]*@[0-9a-f]{12,}$/;

export function checkLibraryUse(
  trace: ReadonlyArray<ToolTraceEntry>,
  assets: ReadonlyArray<{ id: string; src: string }>,
): LibraryCheck {
  const at = (i: number) => (i === -1 ? null : i);
  const firstSearch = at(trace.findIndex((t) => t.name === "search_assets" && !t.isError));
  const firstPlace = at(trace.findIndex((t) => PLACING.has(t.name)));
  const libraryAssets = assets.filter((a) => PINNED.test(a.src)).map((a) => a.id);
  const otherAssets = assets.filter((a) => !PINNED.test(a.src)).map((a) => `${a.id} (${a.src})`);

  const errors: string[] = [];
  if (firstSearch === null) errors.push("library: no search_assets call succeeded.");
  if (firstPlace === null) errors.push("library: nothing was registered (no register_asset or use_asset call).");
  if (firstSearch !== null && firstPlace !== null && firstPlace < firstSearch) {
    errors.push(
      `library: ${trace[firstPlace]!.name} (call ${firstPlace + 1}) came before the first search_assets (call ${firstSearch + 1}).`,
    );
  }
  if (assets.length === 0) errors.push("library: the composition has no assets.");
  if (otherAssets.length > 0) errors.push(`library: not pinned library records: ${otherAssets.join(", ")}.`);

  return { ran: true, passed: errors.length === 0, firstSearch, firstPlace, libraryAssets, otherAssets, errors };
}
