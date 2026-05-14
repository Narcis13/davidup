---
name: to-doc
description: Compose a self-contained, richly visual HTML document with an embedded AI-readable markdown frontmatter block. Trigger when the user says "/to-doc", "make this a doc", "render as HTML", "write this up as HTML", "compose a PRD/vision/proposal as HTML", "turn this into slides", "make a deck", or otherwise asks for context-to-be-turned-into a beautiful standalone .html artifact (long-form scrolling doc OR slide deck). Produces a single HTML file that is dark + blue-accent + minimalist for human readers and carries a YAML + markdown extraction of all meaningful content inside a hidden <script type="text/markdown" id="ai-frontmatter"> block for future AI agents. Always reads design.md before composing; uses inline SVG/canvas/JS for rich visuals; never depends on external CSS/JS beyond Google Fonts.
---

# /to-doc

Compose a standalone `.html` document from the surrounding context. The output
is one file that is **beautiful to human readers** *and* **perfectly indexed
for any future AI agent** that opens it.

## The shape of the output

Every doc has two layers in the same `.html` file:

1. **Visible layer (humans)** — dark + blue-accent + minimalist HTML, rendered
   using inline `<style>`, inline `<svg>`, and inline `<canvas>` + `<script>`
   only where dynamic visuals earn their cost. No external CSS/JS dependencies
   beyond Google Fonts.

2. **AI-frontmatter layer (agents)** — a
   `<script type="text/markdown" id="ai-frontmatter">` block at the end of
   `<head>` (immediately after `</style>`, before `</head>`) containing YAML
   metadata + a complete markdown extraction of every meaningful piece of
   visible content. This is the canonical text source.

The visible layer is for humans. The frontmatter layer is for agents. Together
they form a single artifact.

## Workflow

### 1. Read the design system

Read `design.md` (in this skill folder) **first, every time**. It defines
colors, typography, spacing, components, motion, and slide rules. Do not
deviate from its tokens. If the repo has a project-local
`.claude/design.md` at its root, treat it as a delta on top of the skill
default.

### 2. Gather and shape the content

Pull from the conversation, files the user has referenced, and the codebase.
Decide:

- **Genre** — PRD, vision, retro, analysis, proposal, design doc, status
  update, postmortem, decision record, lightning talk?
- **Format** — long-form scrolling doc (default) or slide deck? See
  [Format choice](#format-choice).
- **Audience** — solo founder reading it tomorrow vs. an investor reading it
  once vs. an AI agent that will regenerate adjacent docs later.
- **Outline** — write 4–10 numbered top-level sections with a one-line thesis
  each, *before* composing HTML. Compose to the outline.

Ask one clarifying question only if genre or format is genuinely ambiguous.
Otherwise infer and proceed.

### 3. Plan visual punctuation

A prose-only doc fails the "rich visuals" promise. Pick at least **two** from
the menu in `design.md` § 5 (hero background, inline-SVG diagram, comparison
table, phase strip, callout, code block with hand-rolled tokens, stats row).

Prefer inline SVG over canvas. Reach for canvas only when the visual genuinely
needs > 1000 elements or per-pixel effects.

### 4. Compose the HTML

Start from one of the scaffolds in `assets/`:

- `assets/template-longform.html` — scrolling doc with sticky topbar, two-up
  sections, footer.
- `assets/template-slides.html` — full-viewport slides with keyboard nav and
  counter.

Both scaffolds already wire the design tokens, Google-Fonts preconnect, the
empty AI-frontmatter slot, and the base components. **Copy the scaffold first,
then replace TODO-marked content.** Don't rewrite the tokens or component CSS
unless `design.md` demands it.

Compose top-down: hero → sections → visual punctuation → conclusion → footer.

### 5. Build the AI frontmatter

After the visible content is final, walk the doc top to bottom and extract every
meaningful piece into the script block. Format:

```html
<script type="text/markdown" id="ai-frontmatter">
---
doc_type: <prd | proposal | retro | vision | analysis | design | decision | slides | other>
doc_title: <full title>
version: <semver or omit>
date: <YYYY-MM-DD>
author_email: <if user is known, else omit>
companion_to: <other doc filename or omit>
sections:
  - <slug> — <one-line summary>
---

# <doc title>

<full markdown body mirroring visible order>
</script>
```

**Frontmatter contract rules:**

- Place the `<script>` immediately before `</head>`, after `</style>`. Precede
  it with an HTML comment explaining the contract to a future maintainer.
- The body must include **every** fact, list, table, code block, quote,
  acceptance criterion, and rationale visible in the doc. Decorative visuals
  (hero background, divider art) can be omitted.
- Convert HTML tables to markdown tables. Convert color-coded states (green /
  red / etc.) to explicit text labels (`WIN` / `LOSE` / `MEH` / `OK` / `FAIL`).
- Mirror the section order of the visible doc.
- If the body would contain a literal `</script>` substring, rewrite it as
  `<\/script>` so the parser doesn't terminate the block early.
- Use `[[name]]` cross-references only when linking to other /to-doc artifacts;
  otherwise plain markdown.

The frontmatter is **not a summary** — it is a faithful, structured
re-expression. A future agent must be able to answer any question about the doc
using only the frontmatter.

### 6. Save the file

Default save location, in priority order:

1. `vision/<slug>.html` if `vision/` exists in the repo.
2. `docs/<slug>.html` if `docs/` exists.
3. Same directory as the file the user is currently working on.
4. Repo root.

Slug is kebab-case from the doc title, optionally prefixed with project +
version (e.g., `davidup-v1.0-editor-prd.html`).

## Format choice

Pick **slides** when:

- User said "slides", "deck", "presentation", "pitch".
- The narrative is ≤ 15 atomic ideas, each summarisable in one headline.
- Reading mode is linear / sequential, not exploratory.
- There are no wide tables or matrices.

Pick **long-form** (default) when:

- Content has cross-references between sections.
- The reader will ctrl-F.
- There are tables, matrices, numbered acceptance criteria, code blocks, or
  step lists.
- Word count > ~2000 words of substance.

When in doubt, pick long-form.

## Quality bar (verify before declaring done)

- [ ] Visible doc opens cleanly at 1440×900, 1024×768, and 768×1024.
- [ ] No external CSS/JS beyond Google Fonts. No CDN script tags.
- [ ] All visible colors come from CSS variables in `:root`. No hex literals
      outside `:root`.
- [ ] All typography uses the three families declared in `design.md`.
- [ ] AI frontmatter exists, is valid YAML at the top, and contains every
      visible fact (read the frontmatter back and compare to the visible
      outline).
- [ ] File size < 250 KB. If larger, the canvas/SVG decoration is too heavy —
      simplify.
- [ ] Long-form: sticky topbar present, section anchors work, footer present.
- [ ] Slides: ←/→/space advance, ↑/↓ jump five, Home/End jump to first/last,
      slide counter visible, hash-restore on reload.
- [ ] No placeholder strings (`TODO`, `lorem`, `xxx`) and no emoji in produced
      HTML unless the user explicitly asked for them.
- [ ] No `console.log` left in produced JS.

If any item fails, fix before announcing completion.

## Files in this skill

- `SKILL.md` — this file.
- `design.md` — design system (palette, type, spacing, components, motion,
  slide rules, hard don'ts). **Read every time, before composing.**
- `assets/template-longform.html` — scaffold for scrolling docs.
- `assets/template-slides.html` — scaffold for slide decks.
