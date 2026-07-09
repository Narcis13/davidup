# Phase: plan

Turn a task description into a grounded plan inside a new state file. The
plan is a contract for the diff: everything build touches must trace back to
it, or to a dated amendment. Write it accordingly — specific enough to hold
the diff accountable, no longer than that.

Input: everything after `plan` is the task description. Empty → show usage
and current tasks, stop.

## 1. Load context

- Read `.flow/memory.md` if it exists. Those facts were earned in past tasks;
  a plan that contradicts one is wrong until proven otherwise.
- If a state file for this task already exists (same slug, or the same task
  reworded), say so and resume it instead of creating a duplicate.

## 2. Scout before writing

A plan built on guessed file paths is worse than no plan — it looks
authoritative and is wrong.

- Read the code the task will touch. Grep for **call sites**, not just
  definitions — the callers are where the surprises live.
- Every path named in the plan must exist on disk, or be marked `(new)`.
- Scale scouting to the task: a one-file fix needs one file read. Don't
  spelunk the repo for an S task; don't skip the grep for an L one.

## 3. Size it — and say it

Classify S / M / L (definitions in SKILL.md) and state the size with one
clause of justification. Size drives everything downstream: plan depth,
whether to recommend `go` vs phased mode, review escalation.

## 4. Decide, don't enumerate

- Pick **one** approach. Name a rejected alternative in a single line only
  when a reasonable engineer would default to it — that line prevents the
  review from relitigating the choice. No option surveys.
- Order the Touchpoints/build sequence so the **riskiest assumption is
  attacked first** — the thing most likely to invalidate the plan (unknown
  API behavior, suspected race, questionable data shape). If step 1 kills the
  plan, you've spent minutes, not hours.
- Acceptance: 2–7 checks, each an **observable behavior with its verify
  command** ("`bun test render` passes incl. new case for alpha channel",
  "running X shows Y"). "Code compiles" is not an acceptance check. Include
  one negative case when the task has failure modes (bad input, missing
  file).

## 5. Ask only what changes the approach

At most 3 questions, via AskUserQuestion, and only when the answer would
alter the Approach or Acceptance — not naming, not style, not anything you
can decide and log. Everything else becomes a line in **Risks &
assumptions**: an assumption written down is a decision the user can veto
cheaply; a question asked needlessly is ceremony.

## 6. Write the state file

Create `.flow/<slug>.md` from the template in SKILL.md — full skeleton,
`status: planned`, today's date from `date +%F`. Fill Plan sections; leave
Build log / Review / Outcome empty.

Guardrails:
- An S-task plan fits in ~15 lines total. If yours is longer, cut.
- Never invent risks to fill the section — an empty Risks section is honest;
  a padded one trains readers to skip it.

## 7. Report

Size, approach in two sentences, the riskiest bit, and the next command
(`/flow build`, or `/flow go` if you'd recommend the one-session loop). Don't
start building — planning ends here so the user can redirect cheaply.
