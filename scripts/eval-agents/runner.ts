#!/usr/bin/env bun
// Agent eval harness entry point (`bun run eval:agents`, v1 plan Session 27).
//
// Runs every fixture in briefs.ts against a fresh standalone MCP server,
// driven by a real Claude Opus 4.8 authoring agent, scores each on
// validate-clean / render-success / frame-inspection, and writes a JSON
// scorecard. Sequential by design: each brief spawns its own MCP server
// subprocess and shells out to ffmpeg, and this is meant to run unattended
// in CI-nightly, not to minimize wall-clock.
//
// Requires ANTHROPIC_API_KEY (or another credential the Anthropic SDK can
// resolve, e.g. an `ant auth login` profile) — see the claude-api skill.

import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BRIEFS } from "./briefs.js";
import { REPO_ROOT } from "./assets.js";
import { EVAL_MODEL } from "./agentLoop.js";
import { runBrief } from "./runBrief.js";
import type { Scorecard, ScorecardEntry } from "./types.js";

const OUTPUT_PATH = join(REPO_ROOT, "eval-results", "scorecard.json");

function summarizeLine(entry: ScorecardEntry): string {
  const status = entry.passed ? "PASS" : "FAIL";
  const bits = [
    `validate=${entry.validate.valid ? "clean" : "FAIL"}`,
    `render=${entry.render.succeeded ? "ok" : "FAIL"}`,
    `frames=${entry.frames.allFramesNonBlank ? "ok" : "FAIL"}`,
    entry.agent ? `tools=${entry.agent.toolCallCount}` : "tools=n/a",
    entry.agent && !entry.agent.finishedNaturally ? "(hit iteration cap)" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `  [${status}] ${entry.id.padEnd(24)} ${bits} (${Math.round(entry.wallClockMs / 1000)}s)`;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    // eslint-disable-next-line no-console
    console.error(
      "[eval:agents] No ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN set and no local profile assumed — " +
        "the Anthropic SDK will fail on the first request. Set a credential and re-run.",
    );
  }

  const anthropic = new Anthropic();
  const results: ScorecardEntry[] = [];

  // eslint-disable-next-line no-console
  console.log(`[eval:agents] running ${BRIEFS.length} briefs against ${EVAL_MODEL}...`);

  for (const brief of BRIEFS) {
    // eslint-disable-next-line no-console
    console.log(`[eval:agents] → ${brief.id}`);
    const entry = await runBrief(brief, anthropic);
    results.push(entry);
    // eslint-disable-next-line no-console
    console.log(summarizeLine(entry));
  }

  const scorecard: Scorecard = {
    generatedAt: new Date().toISOString(),
    model: EVAL_MODEL,
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };

  mkdirSync(join(REPO_ROOT, "eval-results"), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(scorecard, null, 2));

  // eslint-disable-next-line no-console
  console.log(
    `\n[eval:agents] ${scorecard.passed}/${scorecard.total} briefs passed. Scorecard written to ${OUTPUT_PATH}`,
  );

  if (scorecard.failed > 0) {
    // eslint-disable-next-line no-console
    console.log(
      "[eval:agents] Failures are the product signal this harness exists to surface, not a script bug — " +
        "inspect the scorecard's `errors`/`agent.toolErrors` per brief before assuming CI is broken.",
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[eval:agents] fatal:", err);
  process.exitCode = 1;
});
