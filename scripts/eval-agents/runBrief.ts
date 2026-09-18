// Runs one brief end-to-end: spawn a fresh standalone MCP server, drive it
// with an authoring agent, then — independent of whatever the agent itself
// did — the harness validates, renders, and inspects frames of whatever
// composition exists in the server when the agent stops. This mirrors
// DAVIDUP_V1_REVIEW.md §2.4 (the hand-driven prototype), scripted.

import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { runAgentLoop } from "./agentLoop.js";
import { REPO_ROOT } from "./assets.js";
import { callMcpTool, listClaudeTools, openMcpSession } from "./mcpSession.js";
import type { BriefFixture, FrameCheck, RenderCheck, ScorecardEntry, ValidateCheck } from "./types.js";
import { extractFrameRgba, frameStats, isNonBlank, probeVideo, resolveFfmpegPaths } from "./videoInspect.js";

const RENDER_DIR = join(REPO_ROOT, "eval-results", "renders");
const SAMPLE_FRACTIONS = [0.1, 0.5, 0.9];
// ffprobe's container duration is rarely bit-exact with the authored
// duration (muxer rounding); allow slack of a couple frames at a modest fps.
const DURATION_TOLERANCE_SEC = 0.5;

async function checkValidate(client: Awaited<ReturnType<typeof openMcpSession>>["client"]): Promise<ValidateCheck> {
  try {
    const outcome = await callMcpTool(client, "validate", {});
    const body = outcome.structured as { valid?: boolean; errors?: string[]; warnings?: string[] } | undefined;
    return {
      ran: true,
      valid: body?.valid === true,
      errors: body?.errors ?? [],
      warnings: body?.warnings ?? [],
    };
  } catch (err) {
    return {
      ran: true,
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings: [],
    };
  }
}

async function getCompositionMeta(
  client: Awaited<ReturnType<typeof openMcpSession>>["client"],
): Promise<{ width: number; height: number; duration: number } | undefined> {
  try {
    const outcome = await callMcpTool(client, "get_composition", {});
    const body = outcome.structured as { json?: { composition?: { width?: number; height?: number; duration?: number } } } | undefined;
    const meta = body?.json?.composition;
    if (!meta || meta.width === undefined || meta.height === undefined || meta.duration === undefined) {
      return undefined;
    }
    return { width: meta.width, height: meta.height, duration: meta.duration };
  } catch {
    return undefined;
  }
}

async function renderBrief(
  client: Awaited<ReturnType<typeof openMcpSession>>["client"],
  briefId: string,
): Promise<RenderCheck> {
  mkdirSync(RENDER_DIR, { recursive: true });
  const outputPath = join(RENDER_DIR, `${briefId}.mp4`);
  try {
    const outcome = await callMcpTool(client, "render_to_video", { outputPath });
    if (outcome.isError) {
      return { ran: true, succeeded: false, error: outcome.textBlocks.join(" ") || "render_to_video reported an error." };
    }
    const body = outcome.structured as {
      result?: { outputPath?: string; durationMs?: number; frameCount?: number } | null;
    } | undefined;
    const result = body?.result;
    if (!result?.outputPath || !existsSync(result.outputPath)) {
      return { ran: true, succeeded: false, error: "render_to_video returned no usable output file." };
    }
    const size = statSync(result.outputPath).size;
    if (size <= 0) {
      return { ran: true, succeeded: false, outputPath: result.outputPath, fileSizeBytes: size, error: "Rendered file is empty." };
    }
    return {
      ran: true,
      succeeded: true,
      outputPath: result.outputPath,
      fileSizeBytes: size,
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      ...(result.frameCount !== undefined ? { frameCount: result.frameCount } : {}),
    };
  } catch (err) {
    return { ran: true, succeeded: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runBrief(brief: BriefFixture, anthropic: Anthropic): Promise<ScorecardEntry> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const session = await openMcpSession();

  let agent: ScorecardEntry["agent"] = null;
  let validate: ValidateCheck = { ran: false, valid: false, errors: [], warnings: [] };
  let render: RenderCheck = { ran: false, succeeded: false };
  let frames: ScorecardEntry["frames"] = { ran: false, frames: [], allFramesNonBlank: false };

  try {
    const tools = await listClaudeTools(session.client);
    agent = await runAgentLoop({
      anthropic,
      mcpClient: session.client,
      tools,
      userPrompt: brief.prompt,
      maxIterations: brief.maxIterations,
    });

    validate = await checkValidate(session.client);
    if (!validate.valid) {
      errors.push(`validate: ${validate.errors.join("; ") || "invalid (no error detail)"}`);
    }

    const compMeta = await getCompositionMeta(session.client);
    render = await renderBrief(session.client, brief.id);
    if (!render.succeeded) {
      errors.push(`render: ${render.error ?? "unknown failure"}`);
    }

    if (render.succeeded && render.outputPath) {
      try {
        const ff = await resolveFfmpegPaths();
        const probe = probeVideo(ff.ffprobe, render.outputPath);
        const expectedDuration = compMeta?.duration;
        const durationMatches =
          expectedDuration === undefined || Math.abs(probe.durationSec - expectedDuration) <= DURATION_TOLERANCE_SEC;
        const dimensionsMatch =
          compMeta === undefined || (probe.width === compMeta.width && probe.height === compMeta.height);

        const frameChecks: FrameCheck[] = SAMPLE_FRACTIONS.map((fraction) => {
          const timeSec = probe.durationSec * fraction;
          const rgba = extractFrameRgba(ff.ffmpeg, render.outputPath as string, timeSec);
          const stats = frameStats(rgba);
          return {
            timeSec,
            fractionOfDuration: fraction,
            nonBlank: isNonBlank(rgba),
            stddev: stats.stddev,
          };
        });

        frames = {
          ran: true,
          probedWidth: probe.width,
          probedHeight: probe.height,
          probedDurationSec: probe.durationSec,
          dimensionsMatch,
          durationMatches,
          frames: frameChecks,
          allFramesNonBlank: frameChecks.every((f) => f.nonBlank),
        };

        if (!dimensionsMatch) errors.push("frames: rendered dimensions do not match the authored composition.");
        if (!durationMatches) errors.push("frames: rendered duration does not match the authored composition.");
        if (!frames.allFramesNonBlank) {
          const blankAt = frameChecks.filter((f) => !f.nonBlank).map((f) => `${Math.round(f.fractionOfDuration * 100)}%`);
          errors.push(`frames: blank/near-blank frame(s) at ${blankAt.join(", ")}.`);
        }
      } catch (err) {
        errors.push(`frames: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await session.close();
  }

  const passed = validate.valid && render.succeeded && frames.allFramesNonBlank && errors.length === 0;

  return {
    id: brief.id,
    title: brief.title,
    passed,
    agent,
    validate,
    render,
    frames,
    errors,
    wallClockMs: Date.now() - startedAt,
  };
}
