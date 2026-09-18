// End-to-end smoke test for the agent eval harness (v1 plan Session 27):
// runs ONE brief through the real pipeline — spawn the standalone MCP
// server, drive it with a real Claude Opus 4.8 authoring agent, validate,
// render, inspect frames — and asserts the scorecard entry has the shape
// the runner depends on.
//
// This calls the real Anthropic API and costs real money, so unlike the
// rest of the integration suite (which the review specifically praised for
// having *no* skip guards) it is deliberately gated on a credential being
// present. It never runs in the `root` CI job; the agent-eval-nightly
// workflow is the only place ANTHROPIC_API_KEY is set, and that's
// intentional — this is the one test class that trades "always green" for
// "never silently free".

import { describe, expect, it } from "vitest";

const HAS_CREDENTIAL = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

describe.skipIf(!HAS_CREDENTIAL)("agent eval harness — live smoke (requires ANTHROPIC_API_KEY)", () => {
  it(
    "runs the product-promo brief end-to-end and produces a well-shaped scorecard entry",
    async () => {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const { BRIEFS } = await import("../../scripts/eval-agents/briefs.js");
      const { runBrief } = await import("../../scripts/eval-agents/runBrief.js");

      const brief = BRIEFS.find((b) => b.id === "product-promo");
      if (!brief) throw new Error("product-promo brief fixture not found");

      const entry = await runBrief(brief, new Anthropic());

      expect(entry.id).toBe("product-promo");
      expect(entry.agent).not.toBeNull();
      expect(entry.agent?.toolCallCount ?? 0).toBeGreaterThan(0);
      expect(entry.validate.ran).toBe(true);
      expect(entry.render.ran).toBe(true);

      // Full pass isn't asserted here — that's the metric this harness
      // exists to measure over time, not a fixed CI gate — but every stage
      // must have actually executed and reported a real shape.
      if (entry.render.succeeded) {
        expect(entry.frames.ran).toBe(true);
        expect(entry.frames.frames.length).toBe(3);
      }
    },
    10 * 60 * 1000,
  );
});
