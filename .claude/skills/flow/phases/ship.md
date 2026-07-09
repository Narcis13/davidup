# Phase: ship

Close the task: prove it works one last time, distill what was learned,
render the journey as an HTML doc, mark it shipped. Ship is a gate, not a
formality — it is the only phase allowed to say "done".

## 1. Gates — all three, no exceptions without the user

- Every acceptance box ticked with evidence, or explicitly waived **by the
  user** (`— waived by user: <reason>` on the box's line).
- No open blocker findings in `# Review`.
- A review verdict exists. No verdict → send to `/flow review` first.

If a gate fails, say which and stop. Don't soften it.

## 2. Fresh verification

Re-run the acceptance checks **now**, in one batch — evidence gathered during
build may predate review fixes. Paste commands and one-line results into
`# Outcome`. This is the record a future reader trusts; make it literal
output, not paraphrase.

## 3. Write the Outcome

- What shipped, 2–3 sentences, as-built (including amendments).
- Verification evidence (from step 2).
- Follow-ups: promote every **Deferred** entry from the Build log into an
  explicit list the user can turn into future tasks.
- Open questions still unanswered, if any.

## 4. Distill memory

Re-read the Build log and Review sections once. Any fact that will still be
true and useful in the next task goes to `.flow/memory.md` (rules in
SKILL.md). Most tasks yield zero or one; that's normal.

## 5. Render the journey doc

Invoke the **to-doc** skill with the state file as source material. Tell it:

- Genre: implementation journal — the story of this task: intent, final
  approach (as built), the decisions and why, review findings and their
  resolutions, outcome with evidence, follow-ups.
- Audience: a teammate (or future you) reading it cold next month.
- Save to `docs/flow/<slug>.html` (create the directory if needed).

Then set `doc:` in the frontmatter to the resulting path.

## 6. Close

- `status: shipped`, `updated:` from `date +%F`.
- Report: one-line summary of what shipped, the doc path, the follow-up list.
- Draft a commit message from the state file (subject = task, body = key
  decisions + doc path), following the repo's conventions — but **do not
  commit unless the user asks**.
