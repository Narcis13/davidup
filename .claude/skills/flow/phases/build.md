# Phase: build

Implement the plan while keeping the state file continuously true. Two
outputs, maintained in parallel: the diff, and a Build log holding only what
the diff can't say.

## 1. Open the task

- Resolve the slug (rule in SKILL.md). Read the state file and
  `.flow/memory.md`.
- `status: planned` → set `building` and record `base:` with
  `git rev-parse HEAD`. If the working tree is already dirty, note the
  pre-existing files on the `base:` line so review doesn't blame them on you.
- `status: shipped` → refuse; that task is closed. No plan at all → offer
  `/flow plan`, or for an S task write the 15-line plan inline first.
- **Resuming mid-build:** say in two lines what the state file claims is done
  and what remains, check `git status` agrees, then continue. Don't re-verify
  work whose acceptance boxes already carry evidence.

## 2. Work in increments, riskiest first

- Follow the plan's order — the riskiest assumption was deliberately put
  first. If it fails, that's a cheap amendment, not a crisis.
- Each increment leaves the tree consistent (typecheck/build passes). After
  each: run the verification relevant to what changed — not the full suite
  every time, not nothing.
- Tick an acceptance box **only** by appending evidence to its line:
  `- [x] ... — verified: <command> → <one-line result>`.

## 3. The divergence protocol

The moment the approach changes — the plan missed something, an assumption
died, a better path appeared — **stop coding**. Write a dated entry under
`## Amendments`: what changed, why, which plan lines it invalidates. Then
code. The plan sections above Amendments are frozen once build starts; the
file must describe what you are actually building at all times, because a
context reset can happen mid-edit.

## 4. Build log discipline

Log only what a reader of plan + diff could **not** infer:

- **Judgment calls** — naming, placement, library choice, error handling, API
  shape, defaults — with the reasoning.
- **Tradeoffs** — the alternative you rejected and why; especially things
  you'd revisit if requirements change.
- **Surprises & footguns** — the codebase or a dependency behaved
  unexpectedly; a future maintainer would be bitten too.
- **Deferred** — noticed but consciously not done, so it can become a
  follow-up instead of scope creep.
- **Guesses** — the spec was silent, you chose; the user should confirm.

Never log: play-by-play of edits (the diff shows it), plan restatement,
commentary on your own process. Entry format: `## <short heading>`, one
sentence stating the decision, then `**Why:**`, optionally
`**Alternative:**`. 2–5 lines each. If a later entry reverses an earlier one,
add the new entry referencing the old — don't delete.

Footgun discoveries that outlive this task go to `.flow/memory.md`
**immediately**, not at ship — a parked task must not hold memory hostage.

## 5. Scope discipline

The diff should contain nothing the plan (+ amendments) doesn't explain.
Improvements you notice along the way go to the Build log as **Deferred**,
not into the code. Match the style of surrounding code; you are a guest in
it.

## 6. Exit

Update the state file (it should already be current — this is a check, not a
task). Then:

- All acceptance boxes ticked with evidence → say so, suggest `/flow review`.
- Stopping early → make the state pass the resume test: exact next action,
  current increment status, any half-done edit named. Say precisely what
  remains.
