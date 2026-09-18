# Jev / TypeSafe "System One" — Synthesis

> A distilled, opinionated reading of the full TypeSafe documentation (109 pages, mirrored in
> [`jev/docs/`](docs/)), plus the OpenRouter Decisions API spec (in [`jev/docs/openrouter/`](docs/openrouter/)).
> Written 2026-09-18 against **jev-1.13.0** (docs reviewed through 2026-09-18), Python SDK v0.7.0, JS SDK v0.6.0.
> Companion adapter: [`jev/askJEV.ts`](askJEV.ts) — full source reproduced in [Appendix A](#appendix-a--askjevts-full-source).

---

## 0. TL;DR (read this if nothing else)

1. **Jev is not a chatbot and not an LLM in the usual sense.** It never generates text. You send a `state` (text or JSON)
   and a map of typed `questions`. It returns, for every question, a **calibrated probability distribution constrained to
   the answers you defined**. There are three question types:
   - **Noul**: yes/no. Returns `noul` = P(yes).
   - **Choice**: one of N unordered options. Returns `choice`, `probabilities`, `confidence`.
   - **Score**: a position on an ordered rubric. Returns `score` (the expected level), `probabilities`, `legend`, `confidence`.
2. **It is fast and extremely cheap.** Calls take about 100–150 ms. Input costs $0.042 per million tokens (≈ 100–1000× cheaper than
   an LLM call) and output tokens are free. Questions in one request run **in parallel, in isolation**, against a state that is ingested once.
   Adding questions is almost free, while adding round trips is not.
3. **The architecture it wants is "AI-powered software", not "agents".** Code owns control flow, arithmetic, dates,
   thresholds and side effects. Jev answers narrow, atomic, System-1 judgments ("could a knowledgeable human answer this in a second?").
4. **Decomposition is the #1 skill.** Split any broad judgment into many atomic questions, ask them all in one call
   (including speculative ones), and combine them in code with weights, rules, bands or a downstream classical ML model.
5. **Uncertainty is a feature.** Use `confidence` (Choice/Score) or a band on `noul` (for example 0.3–0.7 = unsure) to decide
   whether to act, ask for confirmation, or escalate to a human or a reasoning LLM. Scale thresholds with the risk of each action.
6. **Known weak spots in 1.13:**
   - literal reading of instructions
   - math, counting and numeric closeness
   - date comparison
   - multi-hop indirection
   - large irrelevant state (context rot)
   - adversarial or injected text
   - contradictory instructions vs. criteria
   - no guaranteed structural invariants (Noul ≠ yes/no Choice; P(x) + P(¬x) ≠ 1)
   - generation

   Workarounds: keep math in code, extract parts via Choice, filter state, and ask directly.
7. **Through OpenRouter:** `POST https://openrouter.ai/api/alpha/decisions` with `model: "typesafe/jev-1.13"`. The body shape is the same
   as the native API. The response adds `id`, `provider` and `usage.cost`. In OpenRouter's schema, `probabilities` and `confidence`
   are *optional*, so code must tolerate their absence. Our adapter: `askJEV({ state, questions })`.

---

## 1. What Jev is (the concept)

### 1.1 "System One" and "Machine Native Intelligence"
TypeSafe named the model class after Kahneman's *System 1*: fast, intuitive, gut-check judgments. The opposite is *System 2*,
which is slow and deliberate. Their bet (the "AI primer" and manifesto) is that large-scale automation will be **~99%
machine-to-machine and ~1% human interaction**. The interface that matters is therefore the *machine interface*, with
software-like properties: **structure, reliability, observability, testability, speed, consistency, low cost**.
Their slogan is "Building prod, not God".

### 1.2 How it's trained: RLCD
There are three post-training families:
- **RLHF** (human preference) produced chatbots. It rewards sycophancy and confident hallucination, and it causes *mode dropping*:
  the distribution narrows toward a preferred style. RLHF was co-invented by TypeSafe cofounder Diogo Almeida.
- **RLVR** (verifiable rewards) produced reasoning models. They are strong but slow and expensive.
- **RLCD, Reinforcement Learning for Calibrated Decisions**, is TypeSafe's approach. The output contract:
  - no text is generated;
  - the model returns decisions and probabilities;
  - the probabilities are optimized against outcomes, so that across many predictions events assigned 0.8 happen about 80% of the time.

Calibration is a property of **groups** of predictions. It is not a guarantee about any single answer.

### 1.3 What it is *not*
- Not generative: no replies, no code, no explanations of its reasoning.
- Not an agent: it never picks its own next action.
- Not fine-tuned per customer: the same weights serve everyone. You shape it through `state`, `instructions` and `criteria`.
- Not multimodal: it takes text only (a string, a JSON object, or an array). Pre-process images, audio and video into text or fields first.
- English first: other languages, including CJK, work at lower accuracy.
- Not trained on customer data. Zero data retention (ZDR) is available for enterprise customers.

### 1.4 Three software architectures (the framing that matters)
| Architecture | Who owns control flow | Where AI sits |
|---|---|---|
| Traditional software | Code (a decision tree of reliable primitives) | nowhere |
| LLM agents | The model (it picks its next step in a loop) | everywhere, and every loop is a chance to go off the rails |
| **AI-powered software** (TypeSafe's target) | **Code** | only at the narrow points that need "programmable common sense" over unstructured data |

The adapter's header comment says the same thing: *"The model answers narrow, typed questions about the state. Your code owns the workflow."*

---

## 2. The API contract

### 2.1 Native endpoint
```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json
```
Request body:
```jsonc
{
  "state": "string | object | array",       // required: the content to judge
  "model": "jev-latest",                     // required on raw HTTP (SDKs default it)
  "questions": {                             // required, non-empty map; keys are YOURS
    "<id>": { "type": "noul" | "choice" | "score", "instructions": ..., "criteria": ... }
  }
}
```
Response body:
```jsonc
{
  "model": "jev-1.13.0",                     // versioned id that actually answered: log it
  "answers": { "<id>": { "type": ..., ... } },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```
`GET /v1/models` lists the aliases. Versioned IDs such as `jev-1.13.0` are always accepted.

### 2.2 Via OpenRouter (what we use)
```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer $OPENROUTER_API_KEY
HTTP-Referer: <site url>          (optional, for rankings)
X-OpenRouter-Title: <site name>   (optional)
```
- **Model:** `typesafe/jev-1.13`.
- **Required fields:** `model`, `state`, `questions`, the same as native.
- **Extra optional request fields** (from the OpenRouter OpenAPI spec):
  - `session_id` (≤256 chars, observability grouping; also accepted as the `x-session-id` header)
  - `user`
  - `trace` (`trace_id`, `trace_name`, `span_name`, `generation_name`, `parent_span_id`, plus custom keys)
  - `provider` (routing preferences: `zdr`, `data_collection`, `order`, `only`, `ignore`, `sort`, `max_price`, …)
- **Extra response fields:** `id`, `provider`, and `usage.cost` (USD).
- **Schema caveat:** OpenRouter's answer schemas mark only `type` + `choice` / `score` / `noul` as required.
  `probabilities`, `confidence` and `legend` are declared but optional, so always null-check them.
- **Schema differences from native:**
  - OpenRouter's Score schema allows `minItems: 1`, but the native API and SDKs require ≥2 levels (and at most 10).
  - OpenRouter's Noul `criteria.true/false` omit `null`.

  The adapter validates to the stricter native rules.
- **Errors:** 400, 401, 402 (insufficient credits), 403, 404, 413 (payload too large), 429, 500, 502, 503, 524 (edge timeout),
  529 (provider overloaded). Retry 408, 429 and 5xx with exponential backoff, and honor `retry-after` / `retry-after-ms`.
- **Verified 2026-09-18:** the endpoint exists and answers `401 {"error":{"message":"Missing Authentication header"}}` without a
  valid key. `typesafe/jev-1.13` is *not* listed in `/api/v1/models`, which only lists chat models.
- **Not yet verified:** OpenRouter's price for Jev. Read `usage.cost` from real responses.

### 2.3 Question types (request side)
| Type | `instructions` | `criteria` | Limits |
|---|---|---|---|
| `noul` | required | optional `{ "true": ..., "false": ... }` | none |
| `choice` | required | required map `option → description` (`null` allowed) | **up to 255 options** (one cookbook says "reliable up to ~240") |
| `score` | required | required **ordered array** of level descriptions, low → high | **2 to 10 levels**; 11 returns a server error |

`instructions`, each Choice option value, each Score level, and Noul `true`/`false` can all be a **string, a JSON object,
an array, or null**. This "EntryType" structure is first-class, and the model is trained to read it (see §5.4).

Two details about what the model sees:
- **Question IDs are never sent to the model.** Write the full question in `instructions`, even when the ID looks self-explanatory.
- **Choice option *names* are sent** along with their descriptions, so option keys carry meaning.

### 2.4 Answer types (response side)
| Type | Fields | Meaning |
|---|---|---|
| Noul | `noul` | P(yes), from 0 to 1. **No `confidence`.** |
| Choice | `choice`, `probabilities`, `confidence` | `choice` = argmax; `probabilities` sum to 1 over *your* options |
| Score | `score`, `legend`, `probabilities`, `confidence` | `score` = Σ level × P(level); it can fall between levels. `probabilities` is keyed `"0"`, `"1"`, … (the Python SDK uses int keys) |

Every answer is **constrained to your options**: the model can never return an out-of-schema value. Every answer is also
**independent**: you can add or remove questions without changing the other answers. The parallel-questions cookbook
confirmed this empirically: batched and single-question answers were identical within noise.

### 2.5 Models, pricing, limits (jev-1.13)
| Item | Value |
|---|---|
| Versioned ID | `jev-1.13.0` (OpenRouter: `typesafe/jev-1.13`) |
| Aliases | `jev-latest` = latest stable (SDK default); `jev-preview` = latest build (currently the same as latest) |
| Price | **$0.042 per 1M input tokens**; output tokens free (TypeSafe direct pricing) |
| Rate limits | 250k tokens/s, 1,200 req/min, adjusted dynamically; 429 when over |
| Context | **64k tokens** for state + all questions; **32k** for state + the single longest question (≈150k characters of English) |
| Latency | ~100 ms typical; 110–114 ms measured in the consistency cookbooks; "150 ms" in marketing |

Aliases move when new releases ship. **Pin `jev-1.13.0`** (or `typesafe/jev-1.13`) once you have tuned thresholds against
it, and log `response.model`.

### 2.6 Official SDKs (for reference; our adapter replaces them for OpenRouter)
- **Python** `typesafe-sdk` (≥3.10):
  - Clients: `TypeSafeClient` / `AsyncTypeSafeClient`, called as `client.system_one(state, questions, response_model=?, retry=?, extra_body=?)`.
  - Question classes: `Noul`, `Choice`, `Score`, `NoulCriteria`.
  - Typed accessors: `result.nouls[...]`, `.choices[...]`, `.scores[...]`.
  - Environment variables: `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`, `TYPESAFE_LOG_LEVEL`.
  - Retries by default on 408, 429 and 5xx.
- **JS/TS** `@typesafe-ai/sdk` (Node ≥20):
  - Call: `new TypeSafeClient().systemOne({ state, questions })`.
  - Builders: `noul(instr, crit?)`, `choice(instr, crit)`, `score(instr, [levels])`.
  - Answer types are inferred from the question literals.
  - Defaults: timeout 10 s per attempt; retries 2 with backoff 500 ms → 5 s and 25% jitter; `Retry-After` honored.
- **Agent skill:** `claude plugin marketplace add typesafe-ai/skills && claude plugin install typesafe@typesafe-ai`
  (invoke it as `/typesafe:typesafe-ai`), or `npx skills add typesafe-ai/skills --skill typesafe-ai`.

---

## 3. The three primitives in depth

### 3.1 Choosing the type
- **Choice**: exactly one of a known set of **unordered** options (department, document type, language, intent, tool).
  Add an `other` / `none` option whenever the list might not cover every input.
- **Score**: a **spectrum** whose steps you can *describe as situations* (severity, frustration, relevance, skill).
- **Noul**: a **clean yes/no** where the probability itself is the signal (is this a refund request? does this contain PII?).
- **Tie-breaker:** pick the type whose answer maps most directly onto code. A Choice maps to N code paths, a Score to a threshold, a Noul to an `if`.
- **Trap:** "Is the candidate strong in Python?" as a Noul returns 0.5, which means *"yes and no are equally likely"*, **not** "medium skill".
  If you want a degree, use a Score with defined levels. If you want a yes/no, define the condition precisely:
  "Does the resume state the candidate used Python at work?"

### 3.2 Choice
- `probabilities` is **relative**: it always sums to 1, so *something* always wins even when nothing fits.
  Pair a Choice with an **absolute Noul** ("does *any* option fit?") or a `none` option when "no answer" is possible.
  The semantic_find, skill_suggestion and pre-parsed-extraction cookbooks all do this.
- **Give the model the full list rather than a shortlist.** Extra options cost only a few tokens each.
- **Option order is part of the question** (hierarchical cookbook).
- **Options can be the payload itself:** line IDs (`L052`), verbatim candidate strings, function-argument literals, skill names.
  Use `null` descriptions when the content is already in the state.
- **Contrastive criteria**: when two options get confused, give each one an object with the same keys, e.g.
  `{ what, not_for, examples }`. The key names are yours; none are reserved. The model sees them, so keep them short and descriptive.
- **Deep taxonomies**: use one Choice per tree level, with each option's *value* being its subtree so the model can see what lives
  below. Use **beam search** (K=3, length-normalized geometric-mean path score) rather than greedy descent.
  In the cookbook, beam got 4/4 leaves and greedy got 2/4.

### 3.3 Score
- `score = Σ i·P(i)`. It is an **expected position**, not a measurement:
  - 1.0 can mean 100% on level 1, or 50/50 on levels 0 and 2. Read `probabilities` and `confidence` alongside it.
  - **Do not interpolate numbers** from a score. 1.3 on a "$1k / $10k" scale does not mean $4.6k. Scores are weak in numeric calibration.
- **Each level is judged on its own. The model doesn't see level numbers or neighbors.** Consequences:
  - "Worse than previous" means nothing to it.
  - Numeric-only levels fail. The docs example: `["0","1","2"]` gave score 0.57 at confidence 0.35, while descriptive levels on the same input gave 0.0 at 1.0.
  - **Describe situations, not degrees.** "Broken feature but a workaround exists" works; "moderately severe" doesn't.
- **One dimension per Score.** "Punctual and smart and experienced" is three questions.
- **Give a rare extreme its own level** (for example "abusive or threatening" above "very angry").
- **Use as many levels as you can describe distinctly (≤10).** Three is fine.
- **Normalize before combining:** `score / (levels − 1)` puts every scale on 0..1.
- **Structured levels** (`{what, examples}` / `{summary, signals}`) sharpen the distribution, but only when the examples resemble
  real inputs. In the docs, an unrelated example barely moved the result (1.30 → 1.28), while a matching one moved it to 1.07 with confidence 0.54 → 0.90.
- **Low Score confidence** means the levels overlap for this input, the question measures more than one thing, or the state lacks the evidence.
- **Levels can *be* the actions**, e.g. "different product" / "possibly the same, needs a curator" / "same product".
  Then rounding `score` to the nearest level *is* the policy, with no fitted thresholds (entity-alignment cookbook).

### 3.4 Noul
- It returns only `noul` = P(yes). Most code thresholds it or uses a **band**, e.g. `< 0.3` no, `> 0.7` yes, otherwise unsure.
- **Phrase it so that high = yes.** For flags, phrase it so that **true = the bad or actionable case** ("is this wrong?", "is this an injection?").
- The instruction can be a question or a statement to judge for truth. Try both on your data.
- Add `criteria: {true, false}` when the boundary is subtle, and use objects with `what` + `examples` on each side.
  **Never invert them** (true → "no"). Contradictory instructions and criteria degrade answers.
- **A Noul is absolute; a Choice is relative.** One Noul per option can be low for *every* option, which is exactly the
  "none fits" signal a Choice can't give you.

---

## 4. Confidence and calibration

- `confidence` (Choice and Score only) is a 0..1 statistic **derived from the shape of `probabilities`**: peaked means high, flat means low.
  The exact formula is not published. It is *not* the winner's probability: a 0.45/0.44 split and "0.45 with the rest scattered"
  get different confidences. For a Noul, P itself is the signal.
- The raw `probabilities` are always there, so you can use your own measure: top-1 probability, **margin** (top1 − top2),
  **normalized entropy**, the minimum across parts, and so on. The adapter ships `margin()` and `entropy()`.
- **The three-path pattern:** high → act automatically; medium → proceed with care (confirm, flag, gather more); low → don't act
  (human, clarification, a different system or a reasoning LLM).
- **Thresholds scale with risk, per action, within the same system.** The docs example:
  - global floor at 0.5–0.6 → human;
  - read-only `check_balance` acts above the floor;
  - destructive `approve_transfer` acts only above 0.85–0.9, and otherwise asks the user to confirm.
- **Thresholds seen across the docs** (all labeled "illustrative, tune on your data"):

| Where | Gate |
|---|---|
| Confidence page | floor 0.5; high-stakes act > 0.9 |
| Voice-banking pattern | floor 0.6; transfer > 0.85 |
| How-to-build example | topic confidence < 0.75 → human |
| Intent routing | < 0.5 → human |
| Citation check | auto-accept ≥ 0.8 |
| SIC classification | ≥ 0.9 → fine label, else coarser parent label |
| Date extraction | min(used-part confidence) < 0.6 → review |
| Choice consistency | top probability ≥ 0.6 |
| Noul consistency | 0.3–0.7 = uncertain |
| Semantic find | exists ≥ 0.7 found; < 0.35 absent |
| SDE cascade | any P(wrong) > 0.7 → escalate |

- **Choose thresholds empirically:** plot confidence against accuracy on labeled data. Higher confidence after a prompt edit
  does **not** prove the edit is better; check it against known answers.
- **Don't carry a threshold tuned on a Noul over to a Choice** (or between different questions).
- **"If all you want is the best option, just take the argmax.** Confidence thresholds are for *deciding whether to act*" (agent-skill page).

### 4.1 Self-consistency (measured)
Borderline inputs, 15 repeats each:
- **Probability standard deviation:** ≈ 0.01 on both the Noul and Choice rubrics. Most LLM conditions were 2.5–5.6× noisier.
  One exception: Claude Haiku at temperature 0 was more repeatable on Choice (0.0012), but not on Noul.
- **Speed and cost:** about 111–114 ms and $0.000043–46 per call, against 0.8–14 s and 22–900× the cost for the LLMs.
- **Near thresholds:** values close to a threshold can still flip. `covered` moved between 0.43 and 0.53 across the 0.5 line.
  Bands turn such flips into "uncertain" rather than wrong answers.
- **Repeatability is not accuracy.**

---

## 5. Designing state and questions (the craft)

### 5.1 The design loop (from "How to build with TypeSafe")
1. **Use code when you can.** Deterministic rules, math, dates, regexes, parsers and schema validation stay in code.
   Avoid agent `while` loops when a workflow can express the same behavior.
2. **Decompose the state.** Send **only** the context the questions need. Irrelevant material causes context rot and lowers
   accuracy. Don't rely on knowledge in the weights when your own knowledge base can supply current facts.
3. **Structure the state.** Use nested JSON with descriptive keys. **Point at fields with backticked dot/index paths** in the
   instructions, e.g. ``Does `support.tickets[0].message` and `commerce.orders[0].charges` indicate a duplicate charge?``
4. **Decompose the questions.** *"Probably the most important concept."* Ask the narrowest, most explicit, atomic questions you can.
   - Spam example: "Is `message` spam?" becomes six Nouls: requests_credentials, offers_unexpected_reward,
     creates_time_pressure, sender_identity_mismatch, link_domain_mismatch, disguises_link_destination.
   - Tool-trace example: "Are the tool calls correct?" becomes nine Nouls, one per call × property: relevance, argument match,
     schema conformance, ID linkage, coordinate reuse, date and unit match.
5. **Structure the questions.** Use JSON objects in instructions and criteria (`question`, `focus`, `inspect`, `compare`,
   `what`, `not_for`, `examples`, `signals`) instead of dense prose. Keep the same keys across options.
6. **Ask a lot of questions in one request**, including speculative ones.
7. **Combine in code** with weighted sums, rules, bands and min/max aggregation, or feed the probabilities as features into a classical ML model.
8. **Route on uncertainty**: escalate low-confidence cases to a human or an expensive reasoning model.

### 5.2 One request or two?
Questions in one request can't see each other's answers. Make a **second request only when your code literally cannot build it
without the first answer**:
- the first answer determines what data to fetch into the state;
- the state is made of things that didn't exist yet (e.g. blocks formed from pass-1 merges);
- the next question's options depend on the answer (taxonomy descent).

Otherwise ask everything up front. The measured numbers: 13 questions in one call vs. 13 calls was **12.2× cheaper and 10× faster**
on a 54k-character document, with identical answers. The primitives page quotes 11.5× and 9.6× for the same experiment.

### 5.3 Writing instructions: rules of thumb
- **Answer the question you wrote.** Jev reads literally; scoping words, negations and implied conditions are taken at face value.
  "When you catch yourself explaining what you *meant*, that explanation is the missing half of the instruction."
- Ask the **narrowest fact that decides the threshold**. In autoformat, "Is this line picking up mid-sentence?" gave 17 correct blocks;
  "Are these the same paragraph?" gave 12, because it merged list items.
- Phrase questions about the **idea**, not the user's likely words. In function calling, "is amd tracking nvidia" still reached `rolling_correlation`.
- Spell out **roles** when two slots share a value set, e.g. `symbol` = "the one being measured, named first";
  `benchmark` = "the second one, the yardstick".
- **Gate questions** should ask whether an *action* is wanted, not what the subject is ("explain monads" is also "about software").
- **Separate "states the specific thing" from "is on the same topic"** in criteria (rerank, citation check).
- **Put your constants in one file.** Questions and thresholds are the main thing humans need to review in TypeSafe code
  (agent-skill page), and "agents aren't great at writing questions".

### 5.4 Structure: where JSON is allowed and why it helps
`instructions`, Choice option values, Score levels and Noul `true`/`false` can all be objects or arrays. Use them to:
- **label the parts** of a multi-part question: `{question, focus, inspect, compare:[paths]}`;
- **pass supporting data as-is**: a schema field spec, a taxonomy subtree, a DB row, `{field:{name,type,unit,description}, extracted_value, question}`;
- **sharpen boundaries** with `{what, not_for, examples}` on every option (use identical keys so options compare like with like).

---

## 6. Jaggedness: known failure modes of jev-1.13 and their fixes

| # | Failure mode | Do this instead |
|---|---|---|
| 1 | **Literal reading**: answers what you wrote, not what you meant | State the exact condition; put boundary cases in criteria; split interpretations into two literal questions |
| 2 | **Math and numbers**: counting, hex/RGB closeness, interpolating a Score | Compute in code. To count matches, ask one Noul per item and sum in code. Pass named buckets ("red") rather than `#ff0000` |
| 3 | **Date/time comparison**: ordering, durations, windows, quarters | Extract parts via Choice (month 12+none, day 1–31+none, year list+none/out_of_range, mode absolute/relative/none, weekday, week_offset); do calendar math in code |
| 4 | **Indirection**: double negatives, property-of-a-property, multi-hop | Ask directly; name the relevant state path |
| 5 | **Large irrelevant state**: context rot | Retrieve and filter first; use a relevance Noul per chunk if you can't filter |
| 6 | **Adversarial content**: injected instructions or self-advocating text move answers | Be explicit in criteria; test edge cases. An injection Noul is a **filter, not a security boundary** |
| 7 | **Contradictory instructions vs. criteria** (e.g. inverted Noul criteria) | Treat criteria as an extension of the instruction; align the wording |
| 8 | **Structural invariants not guaranteed**: `noul` ≠ Choice P(yes) (0.22 vs 0.01 in the docs); P(refund) + P(not refund) = 1.19 | Ask each decision one way; enforce identities in code; don't port thresholds between question forms |
| 9 | **Generation** | Use a generative model to produce candidates; let Jev *pick* among them |

The "avoid" list: asking what code can compute exactly; hiding several judgments in one question; System-2 tasks
(layers of indirection); sending more state than the question needs.

---

## 7. Architectural patterns

1. **Speculative fan-out.** Put every question the code *might* need into one call, including ones that only matter on some
   branches. Branch in code and ignore the irrelevant answers.
   - Support triage: category + bug_severity + has_repro + refund_requested + frustration.
   - Smart-home demo: category, room, device, and action on lights, all at once.
   - Anti-pattern: sequential calls that "wait until you know you need it".
2. **Confidence-gated routing.** The answer says *what*; confidence says *whether to act*. Use a global floor plus per-action thresholds scaled by risk.
3. **Composite scoring.** Split a judgment into atomic Scores (e.g. python_depth, team_leadership, system_design,
   generalist), normalize them, and weight them in code. Different weight vectors give different rankings (Senior IC vs. EM) from the same call.
   Weights are transparent and cheap to retune.
4. **Intent routing.** Jev sits in front of expensive resources as a ~100 ms classifier. Each intent goes to deterministic code,
   a specialist LLM, or a human; a complexity Score plus its confidence decides between LLM and human.
5. **LLM pairing** (smart-home demo): a Noul "does this request contain several actions?" triggers an LLM split into atomic
   commands, which are re-evaluated individually. An "is this general chat?" answer triggers an LLM fallback. Jev's added latency is negligible.

### 7.1 The aggregation toolkit (collected from the cookbooks)
| Aggregation | Use when | Seen in |
|---|---|---|
| Weighted sum of normalized scores/nouls | Several independent dimensions of quality or risk | composite scoring, how-to-build spam risk |
| **Max / any-flag** over per-field nouls | One confident "this is wrong" must not be averaged away | SDE cascade |
| **Min** confidence over the parts actually used | One bad part spoils the whole (function args, date parts) | function calling, date extraction |
| Mean of gate nouls (flipping inverted questions) | Soft "should we do anything at all" gate | skill suggestion |
| Geometric-mean path probability | Comparing paths of different depth | hierarchical beam search |
| Round Score to nearest level | Levels *are* the actions | entity alignment |
| Two-threshold band (yes / unsure / no) | Abstain instead of flipping near 0.5 | noul consistency, guardrails, semantic find |
| Ordered rule list, first match wins | Security checks must precede quality checks | RAG passage gate (injection → contradiction → relevance → evidence) |
| Probabilities as ML features | You have ground-truth outcomes | AutoResearch (CatBoost on Score mean + spread, Noul P) |

---

## 8. Cookbook recipes (condensed)

Each recipe: the problem, then how Jev is used, then the key result. All use jev-1.12 or 1.13, and their numbers are illustrative.

1. **Parallel questions.** One call with 13 questions about the GDPR article is 12× cheaper and 10× faster than 13 calls,
   with the same answers. *Batch everything about a state.*
2. **Semantic find.** Prefix every line with `L{nnn}|`. One Choice over line IDs locates the answer. One `exists` Noul catches
   "not in this document", which a Choice can't express because it always sums to 1. Thresholds: ≥ 0.7 found, < 0.35 absent.
   Capped at 255 lines per request; use a two-pass window for longer documents.
3. **Pre-parsed value extraction.** A regex over-finds candidates. Jev *picks* one (Choice over the verbatim strings, plus `none`).
   Code copies and normalizes it (E.164 phone numbers, Decimal amounts). Side Choices and Nouls supply attributes (country,
   currency, credit vs. charge). Jev can never invent or transpose characters.
4. **Date extraction.** Seven part-Choices in one call; code assembles the date and does the math. Confidence = the minimum over the
   parts used; below 0.6 goes to review. 6/6 correct, including "next Thursday" and "not stated".
5. **Citation check.** An exact string match in code catches fabricated quotes for free. A three-way Choice
   (`supports` / `contradicts` / `says_nothing`) then judges `{claim, section}`, and auto-accepts at ≥ 0.8. It caught a verbatim quote from a section that says the opposite.
6. **Classification using confidence.** A 75-option SIC major-group Choice over 10-K text. At confidence ≥ 0.9, report the group
   (90% correct); otherwise report the parent division (70% correct). 48/60 were useful vs. 39/60 without the fallback. No second call is needed.
7. **Hierarchical classification.** One Choice per node over its children, with neutral `c0..cN` keys. Beam search with K=3 and a
   geometric-mean path score beat greedy descent (4/4 vs 2/4).
8. **Classifying RAG passages.** Four Nouls per (query, passage): is_relevant, contains_answer_evidence,
   contradicts_query_premise, contains_prompt_injection. An ordered rule list sorts each passage into accepted, conflicting or excluded,
   and the generator receives these as separate blocks. It dropped similarity-rank-1 injected text and surfaced passages ranked 8–11 that embeddings had missed.
9. **Re-ranking.** BM25 top-30, then one Noul per (query, passage) whose criteria separate "establishes the specific proposition"
   from "same topic". Top-1 went from 5% to 18% and top-10 from 38% to 62%, for $0.06 over 1,200 calls.
10. **Entity alignment.** A Score whose three levels are *different / possibly the same (curator) / same*; round to the nearest level.
    Diagnostic Nouls (same_name, same_brewery, same_style) explain the result to curators. Numeric ABV comparison stays in code.
11. **Function calling.** For each typed function, `Literal` arguments become Choices, `list[Literal]` arguments become one Noul per member,
    and `bool` arguments become Nouls. Every argument gets a "`stated`?" Noul, so unstated arguments fall back to defaults instead of
    confident guesses. That is 54 questions in one call; call confidence = the minimum over its judgments. 14/14 correct.
12. **Skill suggestion.** Progressive disclosure for an agent with 182 skills:
    - **Call 1:** a wide Choice over all skill names, plus action-gate Nouls.
    - **Call 2:** re-rank the top 3 using the full `SKILL.md` text, with a per-candidate "fits?" Noul.

    The result is injected as a one-line hint to the agent. Wrong loads fell 2.3× and needless loads 2.4×.
13. **LLM guardrails.** Input and output batteries of hazard Nouls (jailbreak, harmful request, medical advice, self-harm,
    policy broken) plus a severity Score. A named policy maps them to block, review, support or pass. The same cached probabilities
    under "strict" vs. "permissive" policies give different routings.
14. **SDE cascade.** A cheap LLM extracts; Jev verifies each field with seven "is it wrong?" Nouls (hallucinated, off_target,
    format_violation, …); any flag above 0.7 escalates to a reasoning model. This beats the holistic judge (0.56) with
    field flags of 0.95. It lies on a better cost/quality Pareto frontier than any single model.
15. **Autoformat (structure recovery).**
    - **Pass 1:** one Noul per line break, "does this line continue a torn sentence?", with thresholds that depend on punctuation.
    - **Pass 2:** block-type Choices plus speculative companions (heading level, step, callout kind).

    Code renders the Markdown, so every character comes from the input. 62 questions ran in one call in 0.5 s.
16. **AutoResearch feature discovery.** An LLM proposes Score and Noul features; Jev answers them for every row; CatBoost trains on them;
    the errors feed the next round of proposals. Held-out RMSE improved from 2.466 (bag of words) to 1.772. *Use Jev as a feature
    extractor for classical ML.*
17. **Self-consistency (Noul and Choice).** Probability standard deviation ≈ 0.01 at about 110 ms, far below most LLM conditions.
    Bands and abstention turn residual jitter into "uncertain".

### 8.1 Operational notes from the cookbooks
- Keep concurrency modest: 4–12 workers. The public endpoint rate-limits at around 8 concurrent requests on a shared key.
- Cache **tokens, not cost**, so a price change needs no re-run. Include a rubric or question fingerprint in cache keys, or edits will serve stale answers.
- Pin datasets, document revisions and model versions. Record `response.model`.
- `usage` fields may be null; default them to 0.

---

## 9. Where it fits: the use-case map

Its "category killers":
- **AI automation software**: run a workflow a million times in the background with no co-pilot.
- **Real-time apps**: ~150 ms, faster than human perception, so it can sit in UIs and games.
- **AI map-reduce over big data**: about 100× cheaper per judgment, enough to classify giant corpora and agent traces.
- **Universal verification**: check other AIs' prompts, extractions, reasoning traces and tool calls for a fraction of the LLM call's cost.
- **Harness engineering**: model routing, semantic context retrieval, guardrails, trace classification.

Decision shapes: classification, detection, scoring, routing, search, retrieval, ranking, verification, ML feature extraction,
and structured-data extraction (by picking among candidates).

Industries listed: search/RAG, scientific screening, model routing, guardrails, semantic code linting in CI, predictive
features, recruiting, lead generation, customer support, insurance claims, financial crime/KYC, legal and compliance, marketplaces,
trust and safety, advertising, gaming, risk, demand forecasting, knowledge graphs.

### 9.1 Ideas worth testing in *this* repo (davidup)
Candidates for our future experiment sessions, each a narrow judgment inside code that already owns the workflow:
- **MCP intent → tool routing.** Classify a natural-language edit request ("make the title pop in slower") into the
  davidup MCP tool (`update_tween` / `add_tween` / `update_item` / …). Add `stated?` Nouls per argument (function-calling cookbook)
  and gate on the minimum confidence before auto-applying.
- **Easing and behavior picker.** Offer a Choice over `list_easings` / `list_behaviors` with descriptive criteria for "feel" words
  (snappy, floaty, bouncy). This is a good test of Jev's semantic mapping versus literal reading.
- **Composition critique battery.** From `get_composition` JSON plus a brief, a speculative fan-out of Nouls and Scores:
  - "Is the text legible against its background?" (pass *named* colors, never hex; see jaggedness #2)
  - "Does the pacing match the brief's energy?"
  - "Is any item off-canvas at t?" (**no**: that is geometry, keep it in code)
- **Asset/footage tagging.** Score and Choice over transcripts or captions (Jev is text-only) to pick B-roll for a scene.
- **Validator message triage.** Classify engine warnings by severity and likely cause for the editor UI.
- **Capability probes.** Measure Jev's jagged edges ourselves: counting, hex vs. named colors, dates, negation, JSON-path
  pointing, 255-option Choices, 10-level Scores, Noul vs. Choice agreement, and repeatability.

---

## 10. The adapter: `askJEV()`

Source: [`jev/askJEV.ts`](askJEV.ts). It has no dependencies and runs under Bun or Node ≥22.6 (type stripping).
It passes `tsc --strict` with the repo's compiler flags and was tested against a mocked fetch (529 → retry → 200) and against
the live endpoint's 401 path. **It has not yet been run with a real key.** The first thing to do when the key is available is
`bun jev/askJEV.ts --demo`.

### 10.1 Setup
```bash
export OPENROUTER_API_KEY=sk-or-...        # or put it in davidup/.env (Bun auto-loads .env)
bun jev/askJEV.ts --demo                   # run the support-ticket demo
node --env-file=.env jev/askJEV.ts --demo  # same, under Node
bun jev/askJEV.ts path/to/request.json     # {state, questions, model?} from a file
echo '{"state":"...","questions":{...}}' | bun jev/askJEV.ts -
bun jev/askJEV.ts --demo --typesafe        # native endpoint with TYPESAFE_API_KEY instead
```
Optional environment variables:
- `JEV_MODEL` overrides the model. The defaults are `typesafe/jev-1.13` on OpenRouter and `jev-latest` native.
- `OPENROUTER_SITE_URL` and `OPENROUTER_SITE_NAME` set the attribution headers.

### 10.2 API surface
```ts
import { askJEV, askJEVMany, noul, choice, score,
         gate, noulBand, normalizedScore, scoreLevel, ranked, margin, entropy, composite } from "./jev/askJEV.ts";

const res = await askJEV({
  state: { ticket: "Help! My payouts have been failing for 3 days.", customer_tier: "pro" },
  questions: {
    is_urgent:   noul("Does `ticket` convey urgency?", { true: "Explicitly time-sensitive", false: "No urgency expressed" }),
    department:  choice("Which team should handle `ticket`?", {
                   billing: "Payments, invoicing, refunds", technical: "Bugs, outages, integrations", sales: "Pricing, upgrades, new accounts" }),
    frustration: score("How frustrated is the customer in `ticket`?", ["Calm", "Frustrated", "Very angry"]),
  },
  // optional: model, backend: "typesafe", timeoutMs (15000), maxRetries (3), signal, sessionId, trace, provider, verbose
});

res.answers.department.choice        // typed as "billing" | "technical" | "sales"
res.answers.department.probabilities // may be undefined on OpenRouter; check before use
res.answers.is_urgent.noul           // number
res.model; res.usage.cost; res.latencyMs; res.attempts; res.raw

if (res.answers.is_urgent.noul > 0.8 && res.answers.department.choice === "billing") { /* escalateToBilling(...) */ }
```

| Helper | Does |
|---|---|
| `noul(instr, {true,false}?)`, `choice(instr, criteria)`, `score(instr, levels[])` | Builders mirroring the official JS SDK. `choice` keeps the literal option keys, so `answer.choice` is a union type |
| `askJEV(opts)` | One request. Validates limits (Score 2–10 levels, Choice 2–255 options, non-empty questions), retries 408/429/5xx/network errors with backoff and jitter, honors `retry-after(-ms)`, and turns OpenRouter's "200 with an error body" into an exception |
| `askJEVMany(states, questions, {concurrency=8})` | The same questions over many states (map-reduce). Errors are returned per item instead of rejecting the whole batch |
| `gate(conf, {act=.8, review=.5})` | Returns `"act" \| "review" \| "escalate"` |
| `noulBand(a, lo=.3, hi=.7)` | Returns `"yes" \| "no" \| "unsure"` |
| `normalizedScore(a, levels)` | `score / (levels − 1)`, on a 0..1 scale |
| `scoreLevel(a)` | The argmax level as an integer |
| `ranked(a)` / `margin(a)` / `entropy(p)` | Sorted options / top-1 minus top-2 / normalized Shannon entropy: alternatives to `confidence` |
| `composite(signals, weights)` | Weighted mean of 0..1 signals |
| `JevError` | `.status` and `.body` for API errors |

### 10.3 Conventions for our experiment sessions
- Keep each experiment's **questions and thresholds in one constants block** at the top of its file.
- Log `res.model`, `usage` and `latencyMs` with every result. Pin `typesafe/jev-1.13` once thresholds are tuned.
- Prefer one call with many questions over many calls. Use `askJEVMany` (concurrency ≤ 8) for corpora.
- Record surprising failures in a `jev/findings.md` log: the input, the question, the expected answer, what Jev returned, and a hypothesis.
  The TypeSafe team asks for these on Discord.

---

## 11. Open questions and inconsistencies noticed in the docs

- The **`confidence` formula** is unpublished; a promised "separate cookbook" on alternative measures does not exist yet.
- The quickstart's sample Score response **omits `probabilities`**, which the API reference marks as required. OpenRouter's schema
  makes it optional. So: tolerate its absence.
- **Context budget** is stated as "64k total / 32k state + longest question" on the Models page and "around 32,000 tokens" on the Primitives page.
- **Choice cap** is 255 per the docs, but one cookbook calls it "reliable up to ~240".
- **Batching speedup:** the Primitives page says 11.5× / 9.6×; the cookbook itself says 12.2× / 10.0×.
- **Autoformat cost** is $0.0015 in the prose and $0.0003 in the printed output.
- Cookbooks use three different environment variables for the base URL (`TYPESAFE_ENDPOINT`, `TYPESAFE_BASE_URL`, and a literal URL).
  The SDK's official one is `TYPESAFE_BASE_URL`.
- **OpenRouter pricing** for `typesafe/jev-1.13` and whether OpenRouter always forwards `probabilities` and `confidence` are to be
  verified on the first live call.

---

## 12. Doc map (local mirror)

| Area | Files |
|---|---|
| Concepts | `introduction.md`, `introduction/quickstart.md`, `introduction/machine-learning-primer.md`, `concepts/system-one.md`, `concepts/state.md`, `concepts/how-to-build-with-system-one.md`, `concepts/use-case-map.md` |
| Primitives | `primitives.md`, `primitives/{choice,score,noul,advanced}.md`, `confidence.md` |
| Reference | `api.md`, `models.md`, `model-jaggedness/jev-1.13.md`, `legal.md`, `agent-skill.md` |
| Patterns and demos | `patterns.md`, `patterns/{fan-out,confidence-routing,composite-scoring,intent-routing}.md`, `demos/smart-home.md` |
| Cookbooks (17) | `cookbooks/*.md` |
| SDKs | `sdk/python/**`, `sdk/javascript/**` |
| OpenRouter | `openrouter/decisions-api-reference.md` (OpenAPI), `openrouter/decisions-typescript-sdk.md` |
| Indexes | `llms.txt`, `llms-full.txt` (the whole site in one file), `urls.txt` |

Note: the `.md` pages embed a large Mintlify `TypesafeExample` JSX component (an LZ-string compressor used for playground links).
When reading the raw files, skip the `export function …` blocks; the example payloads are in the `<TypesafeExample example={{…}} />` props.

---

## Appendix A — `askJEV.ts` (full source)

This is a snapshot of [`jev/askJEV.ts`](askJEV.ts) as of this writing. The `.ts` file is the source of truth.

```ts
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
```
