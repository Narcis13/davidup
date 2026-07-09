---
name: flow
description: >-
  Lightweight plan → build → review → ship workflow with one persistent state
  file per task in .flow/. Use when the user types /flow, asks to implement
  something "properly" / "with a plan", wants to resume earlier work ("continue
  the X task", "where were we"), or asks what work is in flight. State survives
  context resets; shipping renders an HTML journey doc via the to-doc skill.
argument-hint: "[plan|build|review|ship|go] [task description or slug]"
---

# /flow — plan → build → review → ship

One task = one state file = one honest record of the work, from idea to a
shipped HTML journey doc. The state file — not the conversation — is the
source of truth: a fresh session with zero context must be able to pick up
any task from its file alone.

## Routing

Parse `$ARGUMENTS`. The first word selects the phase:

| Input | Action |
|---|---|
| *(empty)* | **Status** — report all tasks (see below) |
| `plan <task>` | Read `phases/plan.md` (next to this file), run it |
| `build [slug]` | Read `phases/build.md`, run it |
| `review [slug] [report-only]` | Read `phases/review.md`, run it |
| `ship [slug]` | Read `phases/ship.md`, run it |
| `go <task>` — or any text that reads as a task description | **Full loop** (see below) |

If the first word looks like a mistyped phase name (`biuld`, `revew`), ask
rather than treating it as a task description. Natural-language requests route
the same way: "continue the dark-mode task" → whatever phase its status points
to; "is this diff okay?" with an active task → review.

Read only the phase file you need. The contract below always applies.

## The state file

Location: `.flow/<slug>.md` at the project root. Slug: kebab-case, 2–4 words
derived from the task, stable forever (`dark-mode-toggle`, `fix-render-race`).
Create `.flow/` on first use; no other setup exists.

Template — create it exactly like this, empty sections included (a stable
skeleton is what makes resume parsing trivial):

```markdown
---
task: <one-line imperative statement of the work>
status: planned
size: S|M|L
created: YYYY-MM-DD
updated: YYYY-MM-DD
base:            # git SHA recorded when build starts
doc:             # path to the HTML journey doc, set by ship
---

# Plan

## Intent
<the observable outcome and why it matters — one short paragraph>

## Approach
<how, grounded in file paths that were verified to exist>

## Touchpoints
<one line per file expected to change: `path — why`; new files marked (new)>

## Acceptance
- [ ] <observable check + how to verify it>

## Risks & assumptions

## Amendments
<!-- dated plan changes made during build; sections above are frozen once build starts -->

# Build log
<!-- decisions only — nothing a reader of plan + diff could infer -->

# Review

# Outcome
```

Status lifecycle: `planned → building → reviewing → shipped`. Any phase may
set `parked` — when parking, append one line to the current section: what
stopped you and the exact next action, so resume costs nothing.

Get dates from `date +%F`, never from memory. Update `updated:` on every
state write.

## Slug resolution (for `build`/`review`/`ship` without an argument)

Exactly one task with status not `shipped`/`parked` → use it. Several → list
them and ask. None → say so and point at `plan`.

## Principles — these four rules ARE the system

1. **The resume test.** After every state write, the file alone must let a
   stranger continue the work. Update state before any risky or long
   operation, not after.
2. **The file never lies.** The moment reality diverges from the plan, stop
   and write a dated amendment — then code. Superseded decisions stay in the
   log, marked superseded; never erased.
3. **Evidence over claims.** An acceptance box gets ticked only with the
   command that proved it and its result, appended to the box's line.
   "Should work" ticks nothing.
4. **Ceremony scales with size.** `S` (≤ ~30 min, ≤ 3 files): plan fits in
   ~15 lines, use `go`. `M` (half-day, one subsystem): full plan, `go` or
   phased. `L` (multi-session or multi-subsystem): phased, and consider
   splitting into several tasks — this system is deliberately too small for
   multi-week roadmaps. Never pad a small task's plan to look thorough.

## Project memory — `.flow/memory.md`

Verified, durable, non-obvious project facts earned during tasks ("editor is
pnpm, not npm — package-lock.json is stale"). Every phase starts by reading
it; every phase appends the moment it earns a fact. One bullet per fact, with
the consequence ("→ so do X"). Delete bullets proven wrong. Not a diary: no
task narration, nothing derivable from a glance at the code.

## Status (`/flow` with no arguments)

1. Read frontmatter of every `.flow/*.md` except `memory.md`. None → say so,
   give one-line usage, stop.
2. Table: task · status · size · updated. Flag stale tasks (`building`/
   `reviewing`, untouched > 7 days).
3. Drift check: `git status --porcelain` — changed files not covered by any
   active task's Touchpoints get one warning line.
4. End with the exact next command for the most recently updated active task.

## Full loop (`go`, or bare task text)

The whole pipeline in one session, for S/M tasks. Read `phases/plan.md` and
`phases/build.md` now; read `review.md` and `ship.md` when you reach them.
Same state file, same rules, compressed ceremony: plan at S depth, skip
clarifying questions unless the answer would change the approach, build, then
run the **full** review (go compresses planning, never review rigor), then
ship. If at any point the task reveals itself as L-sized: stop cleanly, park
with a note, and recommend phased mode — don't bulldoze through.
