# Phase: review

Adversarial review of the diff against the plan. You are not the author
here — the verdict comes from what's on disk, not from your memory of writing
it. If you built this in the same session, distrust your recall doubly:
re-read every changed file from disk **in full**, not just the hunks.

## 1. Get the actual diff

- Resolve the slug; set `status: reviewing`.
- Diff = `git diff <base>` plus untracked new files from
  `git status --porcelain` (read those whole). If `base:` is missing or
  invalid (rebase, manual commits), fall back to working tree + HEAD and say
  so in the Review section.
- `report-only` in the arguments → record findings but touch no code.

## 2. Three passes

**Pass 1 — correctness.** For each changed area ask: *what input, state, or
timing makes this wrong?* Attack angles — walk the list, it exists because
self-review reliably skips these:

- Boundaries: empty, zero, one, huge, negative, unicode, already-exists.
- Error paths and partial failure — when step 2 of 3 throws, who cleans up
  step 1?
- Nulls/undefined at the seams between changed and unchanged code.
- Async: ordering assumptions, unawaited promises, races on shared state.
- State that outlives the happy path: caches, listeners, files, cursors.
- API contracts **actually honored** — re-read the callee's code, not its
  name.
- Silent breakage of untouched callers: grep the call sites of anything whose
  signature or semantics changed.

**Pass 2 — contract.** The diff versus the state file:

- Every changed file appears in Touchpoints or an Amendment. Unexplained
  files → finding.
- Acceptance evidence is real: re-run at least the critical checks **now**.
  A box ticked without reproducible evidence → finding.
- Judgment calls visible in the diff but absent from the Build log → log
  them now, or flag if they need the user.

**Pass 3 — excess.** Code the diff adds that the task doesn't need:
speculative parameters, abstractions with one caller, dead branches, comments
narrating the diff. Simpler-is-available → finding.

## 3. Finding discipline

A finding must name a **concrete failure scenario** (this input/state → this
wrong outcome) or a specific excess. "Looks fragile" is not a finding. The
bar: would you stake a PR comment on it? Severities:

- **blocker** — wrong output, data loss, breaks existing callers.
- **should** — bites in a foreseeable case; fix before ship.
- **nit** — style/polish; fix only if trivial.

Record each under `# Review`:
`- **[blocker]** path:line — <defect>. Scenario: <input → outcome>. → <resolution>`

## 4. Resolve

Default: fix blockers and shoulds now, re-verify, mark
`→ fixed (<evidence>)`. Waiving a blocker is the **user's** call, never
yours — mark `→ waived by user: <reason>` only after they say so.

**Zero findings must be earned:** the verdict then lists which attack angles
you ran and what you checked. "LGTM" without that list is an unfinished
review.

## 5. Escalate when fresh eyes beat yours

Diff > ~400 lines, or it touches a subsystem you didn't read during build →
recommend the built-in `/code-review`, or spawn a general-purpose agent given
only the state file and the diff (no conversation context) and merge its
findings into yours.

## 6. Verdict

End `# Review` with one line: `Verdict: ready to ship — <why>` or
`Verdict: needs work — <what>`. Update `updated:`, report the findings table
to the user, and point at `/flow ship` or back to `/flow build`.
