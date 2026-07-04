// Shape/sanity tests for the eval harness's brief fixtures
// (scripts/eval-agents/briefs.ts). Cheap and always runs — catches typos
// (duplicate ids, empty prompts) without spending any API budget.

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EVAL_ASSETS } from "../../scripts/eval-agents/assets.js";
import { BRIEFS } from "../../scripts/eval-agents/briefs.js";

describe("agent eval briefs", () => {
  it("has at least 10 fixtures", () => {
    expect(BRIEFS.length).toBeGreaterThanOrEqual(10);
  });

  it("every brief has a unique kebab-case id", () => {
    const ids = BRIEFS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every brief has a non-trivial title, prompt, and a sane iteration cap", () => {
    for (const brief of BRIEFS) {
      expect(brief.title.length).toBeGreaterThan(5);
      expect(brief.prompt.length).toBeGreaterThan(50);
      expect(brief.maxIterations).toBeGreaterThanOrEqual(10);
      expect(brief.maxIterations).toBeLessThanOrEqual(100);
    }
  });

  it("every referenced fixture asset actually exists on disk", () => {
    for (const category of Object.values(EVAL_ASSETS)) {
      for (const path of Object.values(category)) {
        expect(existsSync(path), `missing fixture asset: ${path}`).toBe(true);
      }
    }
  });
});
