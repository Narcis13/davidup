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
}

export interface AgentLoopResult {
  toolCallCount: number;
  iterations: number;
  stopReason: string | null;
  /** True when the agent stopped on its own (`end_turn`) rather than hitting the iteration cap or a refusal. */
  finishedNaturally: boolean;
  toolErrorCount: number;
  toolErrors: string[];
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

export interface ScorecardEntry {
  id: string;
  title: string;
  passed: boolean;
  agent: AgentLoopResult | null;
  validate: ValidateCheck;
  render: RenderCheck;
  frames: FrameInspectionCheck;
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
