// "Find before placing" (asset-library plan S1): the check the eval harness
// scores a `library` brief with (scripts/eval-agents/libraryCheck.ts). Pure,
// no API key.

import { describe, expect, it } from "vitest";

import { checkLibraryUse } from "../../scripts/eval-agents/libraryCheck.js";
import type { ToolTraceEntry } from "../../scripts/eval-agents/types.js";

const t = (...names: string[]): ToolTraceEntry[] =>
  names.map((n) => (n.endsWith("!") ? { name: n.slice(0, -1), isError: true } : { name: n, isError: false }));
const PAPER = { id: "paper-warm", src: "asset:paper-warm@9ea61d248f38" };
const FOX = { id: "fox-sprite", src: "asset:fox-sprite@a8b6b8cb4e6b" };

describe("checkLibraryUse", () => {
  it("passes a search, a preview, then use_asset calls that leave pinned srcs", () => {
    const out = checkLibraryUse(
      t("create_composition", "search_assets", "get_asset_preview", "use_asset", "use_asset", "validate"),
      [PAPER, FOX],
    );
    expect(out).toMatchObject({ ran: true, passed: true, firstSearch: 1, firstPlace: 3, otherAssets: [], errors: [] });
    expect(out.libraryAssets).toEqual(["paper-warm", "fox-sprite"]);
  });

  it("counts register_asset with a hit's use.davidup args as placing", () => {
    expect(checkLibraryUse(t("search_assets", "register_asset", "add_sprite"), [PAPER]).passed).toBe(true);
  });

  it("fails a register before the first search", () => {
    const out = checkLibraryUse(t("register_asset", "search_assets", "use_asset"), [PAPER]);
    expect(out.passed).toBe(false);
    expect(out.errors).toEqual(["library: register_asset (call 1) came before the first search_assets (call 2)."]);
  });

  it("does not count a search that errored", () => {
    const out = checkLibraryUse(t("search_assets!", "use_asset", "search_assets"), [PAPER]);
    expect(out.firstSearch).toBe(2);
    expect(out.passed).toBe(false);
  });

  it("fails with no search, nothing placed, or no assets", () => {
    expect(checkLibraryUse(t("create_composition", "use_asset"), [PAPER]).errors).toEqual([
      "library: no search_assets call succeeded.",
    ]);
    expect(checkLibraryUse(t("search_assets"), []).errors).toEqual([
      "library: nothing was registered (no register_asset or use_asset call).",
      "library: the composition has no assets.",
    ]);
  });

  it("fails an asset that is a path, a global: src or an unpinned record", () => {
    const out = checkLibraryUse(t("search_assets", "use_asset", "register_asset", "register_asset"), [
      PAPER,
      { id: "logo", src: "/tmp/logo.png" },
      { id: "font", src: "global:fonts/Inter.ttf" },
      { id: "fox", src: "asset:fox-sprite" },
    ]);
    expect(out.passed).toBe(false);
    expect(out.otherAssets).toEqual(["logo (/tmp/logo.png)", "font (global:fonts/Inter.ttf)", "fox (asset:fox-sprite)"]);
  });
});
