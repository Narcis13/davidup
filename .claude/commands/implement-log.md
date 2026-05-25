---
description: Implement a spec while keeping a running implementation-notes log of decisions, changes, and tradeoffs — then render it as a polished HTML doc via /to-doc
argument-hint: <SPEC describing what to build>
---

# Task

Implement the following spec:

```
$ARGUMENTS
```

If `$ARGUMENTS` is empty, stop and tell the user the correct usage: `/implement-log <SPEC describing what to build>`.

# How to work

You will do two things in parallel as you implement:

1. **Build the thing.** Plan, write code, run it, fix it, verify it. Normal implementation work.
2. **Keep a running log** at `implementation-notes.md` in the current working directory. Treat this file as a live document — update it as you make decisions, not in a final pass at the end.

## What goes into `implementation-notes.md`

Only things the user could NOT infer from reading the spec + the diff. Specifically:

- **Decisions not in the spec** — judgment calls you had to make (naming, file placement, library choice, error handling, API shape, defaults) and the reasoning. One short paragraph per decision.
- **Deviations from the spec** — places where you intentionally did something different from what the spec literally said, and why (spec was ambiguous, conflicted with existing code, would break a constraint, etc.).
- **Tradeoffs** — alternatives you considered and rejected, with the reason. Especially: things you'd revisit if requirements change.
- **Surprises / footguns** — unexpected behavior in the existing codebase, gotchas a future maintainer should know, dependencies that behaved unexpectedly.
- **Deferred / out-of-scope** — anything you noticed but consciously did NOT do, so the user can decide whether it's a follow-up.
- **Open questions** — things you guessed at because the spec was silent, that the user should confirm.

Do NOT log: a play-by-play of what files you edited (the diff shows that), restatements of the spec, generic encouragement, or commentary on your own thought process.

## Format of `implementation-notes.md`

Start the file with this header on the first write:

```markdown
# Implementation notes

**Spec:** $ARGUMENTS

**Started:** <current date/time>

---
```

Then append sections as you work. Use `## <short heading>` per entry. Lead each entry with the decision/fact in one sentence, then a short **Why:** line. If relevant, add a **Alternative considered:** line. Keep entries tight — 2–5 lines each is the target.

Append to the file frequently (as soon as a decision crystallizes), not in a batch at the end. If you correct an earlier decision, do not delete the old entry — add a new entry that supersedes it and reference the original.

# When the implementation is done

1. Briefly verify the implementation works (run tests, type-check, or otherwise confirm — match the scope of the spec).
2. Make sure `implementation-notes.md` reflects the final state. Skim it once; tighten anything bloated.
3. Invoke the `/to-doc` skill to render `implementation-notes.md` as a polished, self-contained HTML document. Pass the markdown file (or its content) to the skill so it composes the final `implementation-notes.html` next to the source.
4. Report back to the user with:
   - one-sentence summary of what got built,
   - the path to `implementation-notes.html`,
   - any **Open questions** entries from the log that need their input.

# Guardrails

- Do not invent decisions to log — if the spec was complete and you made no judgment calls in a section, the log can be short. Quality over volume.
- If `implementation-notes.md` already exists when you start, do not overwrite it blindly. Tell the user, and ask whether to append, archive the old one, or abort.
- Treat the log as user-facing documentation, not a scratchpad. Write so a teammate reading it cold next month understands the decisions without needing the conversation.
