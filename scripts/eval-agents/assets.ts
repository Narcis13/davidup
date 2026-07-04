// Repo-relative fixture paths handed to the authoring agent so it can
// `register_asset` real files without a filesystem tool (the agent only has
// the MCP surface — no bash/glob — so it can't hunt for fonts/images the way
// the review's §2.4 human-driven proof run did; R-30 documents that cold
// start). Absolute paths so the standalone MCP server (spawned with
// `cwd: REPO_ROOT`, see mcpSession.ts) resolves them regardless of a caller's
// own working directory.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");

export interface EvalAssetKit {
  fonts: {
    display: string; // BebasNeue — condensed display face, good for titles
    mono: string; // JetBrains Mono — good for body/ticker text
  };
  images: {
    ball: string; // examples/ball.png — simple PNG sprite, transparent bg
  };
  audio: {
    tone: string; // short mono tone, safe stand-in for "background music"
  };
  video: {
    small: string; // tests/drivers/fixtures/video/small.mp4
  };
}

export const EVAL_ASSETS: EvalAssetKit = {
  fonts: {
    display: join(REPO_ROOT, "examples", "fonts", "BebasNeue-Regular.ttf"),
    mono: join(REPO_ROOT, "examples", "fonts", "JetBrainsMono-Bold.ttf"),
  },
  images: {
    ball: join(REPO_ROOT, "examples", "ball.png"),
  },
  audio: {
    tone: join(REPO_ROOT, "tests", "drivers", "fixtures", "audio", "tone-mono.wav"),
  },
  video: {
    small: join(REPO_ROOT, "tests", "drivers", "fixtures", "video", "small.mp4"),
  },
};
