// Shared types for the agent eval harness (v1 plan Session 27 / §6 item 21).

export interface BriefFixture {
  /** Stable kebab-case id — used as the scorecard key and the render filename. */
  id: string;
  /** One-line label for human-readable summaries. */
  title: string;
  /**
   * The authoring brief, verbatim, as the agent's user-turn prompt. Should
   * read like a creative brief a client would actually send, not a spec —
   * the point is to measure whether an LLM can turn ordinary language into
   * a valid, good-looking composition through the MCP surface alone.
   */
  prompt: string;
  /** Hard cap on agent↔tool round trips before the harness gives up and scores whatever exists. */
  maxIterations: number;
  /**
   * The brief gives no file paths: everything comes from the asset library.
   * Scored by {@link LibraryCheck} — a `search_assets` before the first
   * `register_asset` / `use_asset`, and every composition asset a pinned
   * `asset:<id>@<sha12>` src.
   */
  library?: boolean;
}

/** One tool call the agent made, in order. */
export interface ToolTraceEntry {
  name: string;
  isError: boolean;
}

export interface AgentLoopResult {
  toolCallCount: number;
  iterations: number;
  stopReason: string | null;
  /** True when the agent stopped on its own (`end_turn`) rather than hitting the iteration cap or a refusal. */
  finishedNaturally: boolean;
  toolErrorCount: number;
  toolErrors: string[];
  /** Every tool call, in the order the agent made them. */
  toolTrace: ToolTraceEntry[];
  inputTokens: number;
  outputTokens: number;
  /** Last assistant text, truncated — kept for debugging a scorecard entry, not scored. */
  finalMessage: string;
}

export interface ValidateCheck {
  ran: boolean;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RenderCheck {
  ran: boolean;
  succeeded: boolean;
  outputPath?: string;
  fileSizeBytes?: number;
  durationMs?: number;
  frameCount?: number;
  error?: string;
}

export interface FrameCheck {
  timeSec: number;
  fractionOfDuration: number;
  nonBlank: boolean;
  stddev: number;
}

export interface FrameInspectionCheck {
  ran: boolean;
  probedWidth?: number;
  probedHeight?: number;
  probedDurationSec?: number;
  dimensionsMatch?: boolean;
  durationMatches?: boolean;
  frames: FrameCheck[];
  allFramesNonBlank: boolean;
}

/** "Find before placing" (asset-library plan S1), for a brief with `library: true`. */
export interface LibraryCheck {
  ran: boolean;
  passed: boolean;
  /** 0-based index in the tool trace of the first successful `search_assets`, or null. */
  firstSearch: number | null;
  /** 0-based index of the first `register_asset` / `use_asset`, or null. */
  firstPlace: number | null;
  /** Composition assets whose src is a pinned `asset:` src. */
  libraryAssets: string[];
  /** Composition assets that are not, as `id (src)`. */
  otherAssets: string[];
  errors: string[];
}

export interface ScorecardEntry {
  id: string;
  title: string;
  passed: boolean;
  agent: AgentLoopResult | null;
  validate: ValidateCheck;
  render: RenderCheck;
  frames: FrameInspectionCheck;
  /** Present for a `library` brief. */
  library?: LibraryCheck;
  errors: string[];
  wallClockMs: number;
}

export interface Scorecard {
  generatedAt: string;
  model: string;
  total: number;
  passed: number;
  failed: number;
  results: ScorecardEntry[];
}
