/**
 * askJEV — a small, dependency-free adapter for TypeSafe's Jev (a "System One"
 * decision model) served through OpenRouter's Decisions API.
 *
 *   POST https://openrouter.ai/api/alpha/decisions   (model: "typesafe/jev-1.13")
 *
 * Also speaks TypeSafe's native endpoint (POST https://api.typesafe.ai/v1/systemone)
 * when `backend: "typesafe"` is passed — the request/answer shapes are identical.
 *
 * The model answers narrow, typed questions about a `state`. Your code owns the workflow.
 *
 * Runs under Bun (`bun jev/askJEV.ts --demo`) or Node >= 22.6 with type stripping
 * (`node --env-file=.env jev/askJEV.ts --demo`). Needs OPENROUTER_API_KEY
 * (or TYPESAFE_API_KEY for the native backend) in the environment.
 *
 * See jev/JEV_SYNTHESIS.md for the concepts behind every helper in here.
 */

// ─── Wire types ──────────────────────────────────────────────────────────────

/** state / instructions / criteria entries: text, JSON object, JSON array (or null). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Entry = string | { [k: string]: Json } | Json[] | null;

export interface NoulQuestion {
  type: "noul";
  instructions: Entry;
  criteria?: { true?: Entry; false?: Entry };
}
export interface ChoiceQuestion<K extends string = string> {
  type: "choice";
  instructions: Entry;
  /** option -> description (null when the name says it all). Up to 255 options. */
  criteria: Record<K, Entry>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: Entry;
  /** ordered levels, low -> high. 2..10 entries. Level number = array index. */
  criteria: Entry[];
}
export type Question = NoulQuestion | ChoiceQuestion<string> | ScoreQuestion;
export type Questions = Record<string, Question>;

export interface NoulAnswer {
  type: "noul";
  /** P(yes), 0..1. No separate confidence for Noul. */
  noul: number;
}
export interface ChoiceAnswer<K extends string = string> {
  type: "choice";
  choice: K;
  /** Full distribution over your options (sums to 1). Optional in OpenRouter's schema. */
  probabilities?: Record<K, number>;
  /** 0..1, derived from how peaked `probabilities` is. */
  confidence?: number;
}
export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted mean of level indexes: 0..(levels-1), can fall between levels. */
  score: number;
  /** Level index (as string) -> probability. */
  probabilities?: Record<string, number>;
  legend?: Record<string, Entry>;
  confidence?: number;
}
export type Answer = NoulAnswer | ChoiceAnswer<string> | ScoreAnswer;

export type AnswerFor<Q> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ChoiceQuestion<infer K>
    ? ChoiceAnswer<K>
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : never;

export type Answers<Q extends Questions> = { [K in keyof Q]: AnswerFor<Q[K]> };

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
  /** USD, reported by OpenRouter only. */
  cost?: number;
}

export interface JevResult<Q extends Questions> {
  answers: Answers<Q>;
  /** Versioned model id that answered (log it: aliases move). */
  model: string;
  usage: JevUsage;
  /** OpenRouter generation id / upstream provider, when present. */
  id?: string;
  provider?: string;
  /** Wall-clock ms for the successful attempt (includes network). */
  latencyMs: number;
  /** Number of attempts made (1 = no retries). */
  attempts: number;
  raw: unknown;
}

// ─── Question builders (mirror the official SDK's noul()/choice()/score()) ──

export function noul(instructions: Entry, criteria?: { true?: Entry; false?: Entry }): NoulQuestion {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}

export function choice<const C extends Record<string, Entry>>(
  instructions: Entry,
  criteria: C,
): ChoiceQuestion<Extract<keyof C, string>> {
  return { type: "choice", instructions, criteria };
}

/** Accepts a plain array of level descriptions (low -> high). */
export function score(instructions: Entry, criteria: Entry[]): ScoreQuestion {
  return { type: "score", instructions, criteria };
}

// ─── Options & errors ────────────────────────────────────────────────────────

export type Backend = "openrouter" | "typesafe";

export interface AskOptions<Q extends Questions> {
  state: Entry;
  questions: Q;
  /** Default: "typesafe/jev-1.13" on OpenRouter, "jev-latest" on TypeSafe. Pin a version once thresholds are tuned. */
  model?: string;
  backend?: Backend;
  apiKey?: string;
  /** Per-attempt timeout. Default 15000 ms. */
  timeoutMs?: number;
  /** Retries after the first attempt on 408/429/5xx/network errors. Default 3. */
  maxRetries?: number;
  signal?: AbortSignal;
  /** OpenRouter observability extras (ignored by the TypeSafe backend). */
  sessionId?: string;
  user?: string;
  trace?: Record<string, string>;
  provider?: Record<string, unknown>;
  /** Log a one-line summary (model, latency, tokens, cost) to stderr. */
  verbose?: boolean;
}

export class JevError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "JevError";
    this.status = status;
    this.body = body;
  }
}

const ENDPOINTS: Record<Backend, string> = {
  openrouter: "https://openrouter.ai/api/alpha/decisions",
  typesafe: "https://api.typesafe.ai/v1/systemone",
};
const DEFAULT_MODEL: Record<Backend, string> = {
  openrouter: "typesafe/jev-1.13",
  typesafe: "jev-latest",
};
const RETRYABLE = (s: number) => s === 408 || s === 429 || s >= 500;

const env = (k: string): string | undefined => {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[k];
  return v && v.trim() ? v.trim() : undefined;
};

// ─── Client-side validation (limits from the Jev 1.13 docs) ─────────────────

export function validateQuestions(questions: Questions): void {
  const ids = Object.keys(questions);
  if (ids.length === 0) throw new JevError("questions must be non-empty");
  for (const id of ids) {
    const q = questions[id]!;
    if (q.type === "score") {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10)
        throw new JevError(`score "${id}": criteria must be an array of 2..10 levels`);
    } else if (q.type === "choice") {
      const n = Object.keys(q.criteria ?? {}).length;
      if (n < 2 || n > 255) throw new JevError(`choice "${id}": needs 2..255 options (got ${n})`);
    } else if (q.type !== "noul") {
      throw new JevError(`question "${id}": unknown type ${(q as { type: string }).type}`);
    }
  }
}

// ─── The adapter ─────────────────────────────────────────────────────────────

export async function askJEV<const Q extends Questions>(opts: AskOptions<Q>): Promise<JevResult<Q>> {
  const backend = opts.backend ?? "openrouter";
  const apiKey = opts.apiKey ?? env(backend === "openrouter" ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY");
  if (!apiKey)
    throw new JevError(`missing API key: set ${backend === "openrouter" ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY"}`);
  validateQuestions(opts.questions);

  const body: Record<string, unknown> = {
    model: opts.model ?? env("JEV_MODEL") ?? DEFAULT_MODEL[backend],
    state: opts.state,
    questions: opts.questions,
  };
  if (backend === "openrouter") {
    if (opts.sessionId) body.session_id = opts.sessionId;
    if (opts.user) body.user = opts.user;
    if (opts.trace) body.trace = opts.trace;
    if (opts.provider) body.provider = opts.provider;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (backend === "openrouter") {
    headers["HTTP-Referer"] = env("OPENROUTER_SITE_URL") ?? "https://github.com/Narcis13/davidup";
    headers["X-OpenRouter-Title"] = env("OPENROUTER_SITE_NAME") ?? "davidup-jev-lab";
  }

  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) throw new JevError("aborted");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const t0 = performance.now();
    let retryAfterMs: number | undefined;

    try {
      const res = await fetch(ENDPOINTS[backend], {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const latencyMs = Math.round(performance.now() - t0);
      let json: any;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = text;
      }

      if (!res.ok) {
        const msg = json?.error?.message ?? json?.detail ?? (typeof json === "string" ? json : res.statusText);
        const err = new JevError(`Jev ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, res.status, json);
        if (!RETRYABLE(res.status) || attempt === maxRetries) throw err;
        lastErr = err;
        const ra = res.headers.get("retry-after-ms") ?? res.headers.get("retry-after");
        if (ra && Number.isFinite(Number(ra)))
          retryAfterMs = res.headers.has("retry-after-ms") ? Number(ra) : Number(ra) * 1000;
      } else {
        // OpenRouter can return 200 with an error object when the upstream fails mid-flight.
        if (json?.error) throw new JevError(`Jev error: ${json.error.message ?? JSON.stringify(json.error)}`, json.error.code, json);
        if (!json?.answers) throw new JevError("Jev response has no `answers`", res.status, json);
        const result: JevResult<Q> = {
          answers: json.answers,
          model: json.model,
          usage: json.usage ?? { input_tokens: 0, output_tokens: 0 },
          id: json.id,
          provider: json.provider,
          latencyMs,
          attempts: attempt + 1,
          raw: json,
        };
        if (opts.verbose) {
          const u = result.usage;
          console.error(
            `[jev] ${result.model} ${latencyMs}ms q=${Object.keys(opts.questions).length} in=${u.input_tokens} out=${u.output_tokens}` +
              (u.cost != null ? ` $${u.cost}` : "") +
              (attempt ? ` (attempt ${attempt + 1})` : ""),
          );
        }
        return result;
      }
    } catch (e) {
      if (e instanceof JevError && !(e.status && RETRYABLE(e.status))) throw e;
      if (opts.signal?.aborted) throw new JevError("aborted");
      lastErr = e instanceof JevError ? e : new JevError(`network/timeout: ${(e as Error).message}`);
      if (attempt === maxRetries) throw lastErr;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    // exponential backoff (500ms doubling, cap 5s, 25% jitter) unless the server told us how long
    const backoff = Math.min(500 * 2 ** attempt, 5_000) * (1 - Math.random() * 0.25);
    await new Promise((r) => setTimeout(r, Math.min(retryAfterMs ?? backoff, 60_000)));
  }
  throw lastErr ?? new JevError("unreachable");
}

// ─── Fan-out over many states (map-reduce style) ────────────────────────────

/**
 * Ask the same questions about many states with bounded concurrency.
 * Failures are returned per item instead of rejecting the whole batch.
 */
export async function askJEVMany<const Q extends Questions>(
  states: Entry[],
  questions: Q,
  opts: Omit<AskOptions<Q>, "state" | "questions"> & { concurrency?: number } = {},
): Promise<Array<{ state: Entry; result?: JevResult<Q>; error?: JevError }>> {
  const out: Array<{ state: Entry; result?: JevResult<Q>; error?: JevError }> = new Array(states.length);
  let next = 0;
  const worker = async () => {
    while (next < states.length) {
      const i = next++;
      const state = states[i]!;
      try {
        out[i] = { state, result: await askJEV({ ...opts, state, questions }) };
      } catch (e) {
        out[i] = { state, error: e instanceof JevError ? e : new JevError(String(e)) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, states.length) }, worker));
  return out;
}

// ─── Answer helpers ──────────────────────────────────────────────────────────

/** Score -> 0..1 by dividing by the top level index (levels - 1). Use before weighting scores together. */
export function normalizedScore(a: ScoreAnswer, levels: number): number {
  return levels > 1 ? a.score / (levels - 1) : 0;
}

/** Most likely level as an integer (argmax of probabilities, falling back to rounding `score`). */
export function scoreLevel(a: ScoreAnswer): number {
  if (!a.probabilities) return Math.round(a.score);
  return Number(Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0]![0]);
}

/** Options sorted by probability, highest first. */
export function ranked<K extends string>(a: ChoiceAnswer<K>): Array<[K, number]> {
  return (Object.entries(a.probabilities ?? { [a.choice]: 1 }) as Array<[K, number]>).sort((x, y) => y[1] - x[1]);
}

/** Gap between the top two options — a cheap alternative confidence measure. */
export function margin(a: ChoiceAnswer<string>): number {
  const r = ranked(a);
  return (r[0]?.[1] ?? 0) - (r[1]?.[1] ?? 0);
}

/** Normalized Shannon entropy of a distribution (0 = certain, 1 = uniform). */
export function entropy(probabilities: Record<string, number>): number {
  const ps = Object.values(probabilities);
  if (ps.length < 2) return 0;
  const h = -ps.reduce((s, p) => (p > 0 ? s + p * Math.log(p) : s), 0);
  return h / Math.log(ps.length);
}

/** Three-way confidence gate: act / review / escalate. Tune thresholds per action risk. */
export function gate(
  confidence: number | undefined,
  { act = 0.8, review = 0.5 }: { act?: number; review?: number } = {},
): "act" | "review" | "escalate" {
  const c = confidence ?? 0;
  return c >= act ? "act" : c >= review ? "review" : "escalate";
}

/** Noul -> boolean with an explicit uncertainty band, e.g. [0.3, 0.7] -> "unsure". */
export function noulBand(a: NoulAnswer, lo = 0.3, hi = 0.7): "yes" | "no" | "unsure" {
  return a.noul >= hi ? "yes" : a.noul <= lo ? "no" : "unsure";
}

/** Weighted sum of already-normalized 0..1 signals; weights are renormalized to sum to 1. */
export function composite(signals: Record<string, number>, weights: Record<string, number>): number {
  let s = 0;
  let w = 0;
  for (const [k, wk] of Object.entries(weights)) {
    s += wk * (signals[k] ?? 0);
    w += Math.abs(wk);
  }
  return w ? s / w : 0;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
//   bun jev/askJEV.ts --demo                  run the support-ticket demo
//   bun jev/askJEV.ts request.json            send {state, questions, model?} from a file
//   echo '{...}' | bun jev/askJEV.ts -        same, from stdin
//   add --typesafe to use the native TypeSafe endpoint instead of OpenRouter

const DEMO = {
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    is_urgent: noul("Does this message convey urgency?", {
      true: "Explicitly time-sensitive",
      false: "No urgency expressed",
    }),
    department: choice("Which team should handle this?", {
      billing: "Payments, invoicing, refunds",
      technical: "Bugs, outages, integrations",
      sales: "Pricing, upgrades, new accounts",
    }),
    frustration: score("How frustrated is the customer?", ["Calm", "Frustrated", "Very angry"]),
  },
};

async function main(argv: string[]) {
  const backend: Backend = argv.includes("--typesafe") ? "typesafe" : "openrouter";
  const arg = argv.find((a) => !a.startsWith("--"));
  let req: { state: Entry; questions: Questions; model?: string };
  if (argv.includes("--demo") || !arg) {
    req = DEMO;
  } else {
    const { readFileSync } = await import("node:fs");
    req = JSON.parse(readFileSync(arg === "-" ? 0 : arg, "utf8"));
  }

  const res = await askJEV({ ...req, backend, verbose: true });
  console.log(JSON.stringify({ model: res.model, latencyMs: res.latencyMs, usage: res.usage, answers: res.answers }, null, 2));

  if (req === DEMO) {
    const a = res.answers as Answers<typeof DEMO.questions>;
    console.error(
      `\nurgent=${noulBand(a.is_urgent)} (${a.is_urgent.noul.toFixed(3)})  ` +
        `department=${a.department.choice} [${gate(a.department.confidence)}]  ` +
        `frustration=${a.frustration.score.toFixed(2)}/2`,
    );
    if (a.is_urgent.noul > 0.8 && a.department.choice === "billing") console.error("→ escalateToBilling()");
  }
}

const isMain =
  (import.meta as { main?: boolean }).main ??
  (typeof process !== "undefined" && process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href);
if (isMain) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof JevError ? `${e.message}${e.body ? `\n${JSON.stringify(e.body)}` : ""}` : e);
    process.exit(1);
  });
}
