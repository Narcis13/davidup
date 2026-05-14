# Design system — /to-doc

The canonical visual language for every document produced by /to-doc. Read this
file **before** composing any HTML. Do not introduce colors, fonts, spacing, or
component patterns outside this system without an explicit user override.

Aesthetic in one line: **deep dark, restrained, blue-accented, typographically
driven, surgically decorated.** Closer to Linear / Stripe Docs / Vercel than to
Notion / Medium / corporate-marketing.

---

## 1. Color palette

Use these tokens exactly. Declare them once in `:root`; reference them by name
everywhere else. No hex literals outside `:root`.

| Token              | Value                          | Use                                       |
|--------------------|--------------------------------|-------------------------------------------|
| `--bg`             | `#0A0E14`                      | Page background (the dark base)           |
| `--bg-2`           | `#11161F`                      | Cards, panels, table rows, callouts       |
| `--bg-3`           | `#161D29`                      | Hover state, elevated surface             |
| `--ink`            | `#E8ECF1`                      | Primary text (headlines, key prose)       |
| `--ink-2`          | `#C5CCD7`                      | Body prose, table cells                   |
| `--mute`           | `#7A8497`                      | Secondary text, captions, metadata        |
| `--mute-2`         | `#4A5363`                      | Tertiary text, dim labels                 |
| `--line`           | `rgba(255,255,255,0.06)`       | Subtle dividers, row separators           |
| `--line-2`         | `rgba(255,255,255,0.10)`       | Default borders, card borders             |
| `--accent`         | `#5B9BFF`                      | THE blue — links, accents, emphasis       |
| `--accent-2`       | `#7AAEFF`                      | Hover/active accent                       |
| `--accent-dim`     | `rgba(91,155,255,0.14)`        | Accent fills (chips, soft callouts)       |
| `--accent-line`    | `rgba(91,155,255,0.30)`        | Accent borders (cards, callout strips)    |
| `--good`           | `#5BD0A0`                      | State-only: pass / win / shipped          |
| `--warn`           | `#E8B66E`                      | State-only: in-progress / partial         |
| `--bad`            | `#F08A8A`                      | State-only: fail / blocked / lose         |

**Rules**

- Total color count on any single page must not exceed **6** of the named tokens
  above. Aggressively reuse.
- `--accent` is the **only** non-grayscale color used decoratively. `--good /
  --warn / --bad` are reserved for state cues (matrix tables, status pills).
- No pure white (`#FFF`) and no pure black (`#000`) anywhere. The base is
  `--bg`; the brightest foreground is `--ink`.
- Backgrounds darken downward through the z-stack: page (`--bg`) → card
  (`--bg-2`) → hover (`--bg-3`). Don't invert.

---

## 2. Typography

Three families, loaded together from Google Fonts. No icon fonts, no extra
families.

```css
--display: "Fraunces", Georgia, "Times New Roman", serif;
--body:    "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--mono:    "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

Preconnect + import line (use exactly this):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

Type scale:

| Role            | Family   | Size                          | Line   | Tracking      | Weight |
|-----------------|----------|-------------------------------|--------|---------------|--------|
| `h1` hero       | display  | `clamp(48px, 6.4vw, 88px)`    | 0.96   | -0.02em       | 400    |
| `h2` section    | display  | `clamp(30px, 4vw, 52px)`      | 1.04   | -0.02em       | 400    |
| `h3`            | display  | 22px                          | 1.2    | -0.01em       | 500    |
| `h4`            | display  | 18px                          | 1.25   | -0.01em       | 500    |
| `p.lead`        | display  | `clamp(19px, 1.8vw, 23px)`    | 1.4    | normal        | 300    |
| body            | body     | 16px                          | 1.55   | normal        | 400    |
| small           | body     | 13.5px                        | 1.5    | normal        | 400    |
| `.eyebrow`      | mono     | 11px                          | 1.4    | 0.18em UPPER  | 500    |
| code            | mono     | 0.92em                        | inherit| normal        | 400    |

- Italic is **display-only**. Use sparingly, for emphasis inside `h1`/`h2` and
  for pull-quotes. Body italics look weak on dark.
- Bold is **500**, not 700. Heavier weights look chunky on dark.
- Never letter-space body prose. Letter-spacing is reserved for `.eyebrow` and
  table headers.

---

## 3. Spacing & layout

Base scale (px): `4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64 · 96 · 128`.

- Section vertical padding: **96px** top & bottom.
- Section internal vertical rhythm: 16px (h2 → body), 24px (body → next block),
  36px (block → next h3).
- Card internal padding: 22–26px.
- Hairline between sections: `1px solid var(--line)` on `border-top`.

Containers:

```css
.wrap        { max-width: 1180px; margin: 0 auto; padding: 0 28px; }
.wrap-narrow { max-width:  860px; margin: 0 auto; padding: 0 28px; }
```

Section pattern (preferred for long-form docs):

```html
<section class="s" id="...">
  <div class="wrap">
    <div class="twoup">
      <div class="side">
        <h3>01 — rail label</h3>
        <p>one-line summary.</p>
      </div>
      <div>
        <p class="eyebrow">eyebrow</p>
        <h2>Section headline.</h2>
        <p class="lead">Lead paragraph.</p>
        <!-- body -->
      </div>
    </div>
  </div>
</section>
```

`.twoup` is `grid-template-columns: 1fr 2fr; gap: 56px;` collapsing to `1fr` at
≤ 800px.

---

## 4. Components

### Topbar (long-form only)
- Sticky, `backdrop-filter: blur(10px)`, bg
  `color-mix(in oklab, var(--bg) 80%, transparent)`.
- 1px `--line` bottom border.
- Logo (left, display 22px with `.dot` in `--accent`), nav (mono 13px,
  `--mute`), version stamp (mono pill 11px).

### Hero
- 96–120px top padding; `h1` with optional `<small>` subhead inside.
- Optional decorative SVG background: faint grid, drifting dots, or radial
  gradient mesh. Opacity ≤ 0.18, mask to fade at the edges.
- Never use raster images or photos. SVG and canvas only.

### Cards
- `bg: var(--bg-2)`, `border: 1px solid var(--line-2)`, `border-radius: 6px`,
  padding 22–26px.
- Interactive cards: hover bg → `--bg-3`, border → `--accent-line`,
  transition 160ms.
- `.card.accent` adds `border-left: 3px solid var(--accent)`.

### Callout (Verdict / TL;DR / DoD / Decision)
- `bg: var(--bg-2)`, `border-left: 3px solid var(--accent)`,
  `border: 1px solid var(--line-2)` on the other three sides, radius 4px.
- A label line on top: mono 11px UPPERCASE letter-spacing 0.16em in `--accent`.
- Then a display-font headline (22px), then 1–2 lines of `--ink-2` body.

### Tables (matrix / comparison)
- Header row: `bg: var(--bg-2)`, mono 11px UPPERCASE letter-spacing 0.16em,
  color `--mute`.
- Row dividers: 1px `--line`.
- Cell padding: 14px 16px.
- State cues — always pair color **with** the textual label, never color alone:
  - `WIN` → `--good`
  - `MEH` → `--mute`
  - `LOSE` → `--bad`
- At ≤ 760px, collapse to one column with 1px dashed `--line` top dividers.

### Code blocks
- `bg: #06090F`, `color: #D7DEEA`, padding 18px 22px, radius 6px,
  border 1px `--line-2`.
- Mono 12.5px / line-height 1.6.
- **Hand-rolled syntax tokens** (no Prism, no highlight.js):
  - `.tok-k` keyword → `--accent-2`
  - `.tok-c` comment → `--mute`, italic
  - `.tok-s` string  → `#A8D9B5`
  - `.tok-a` attr / class → `--accent`
- Inline `code`: `bg: var(--bg-2)`, `color: var(--accent-2)`, 1px `--line`
  border, radius 3px, padding 1px 6px.

### Pills / chips
- Inline-block, mono 11px, padding 3px 10px, radius 999px.
- Default: `bg: var(--bg-2)`, border `--line-2`, color `--mute`.
- `.pill.accent`: bg `--accent-dim`, border `--accent-line`, color `--accent`.

### Eyebrow
- One per section, sits above the `h2`.
- Mono 11px UPPERCASE, letter-spacing 0.18em, color `--accent`, weight 500.

### Definition / acceptance list
- `border-left: 2px solid var(--accent-line)`, padding-left 14px, mono 12px,
  color `--mute`.
- Label like "Acceptance" or "Mitigation" in mono 10px UPPERCASE
  letter-spacing 0.12em, color `--accent`.

### Architecture / flow diagram (inline SVG)
- Use SVG, not canvas, unless you need > 1000 elements.
- Boxes: `fill: var(--bg-2)`, `stroke: var(--accent-line)`, stroke-width 1,
  rx 6.
- Box labels: display 17px, `fill: var(--ink)`.
- Arrows: stroke 1.5px `--accent`, arrowhead via `<marker>`. Subtle, not thick.
- Annotations along arrows: mono 11px `--mute`.
- Always declare a `viewBox`; never hard-code width/height in px.

### Buttons (rare in docs; mainly for slide actions)
- Primary: bg transparent, 1px `--accent-line` border, color `--accent`,
  padding 10px 18px, radius 4px. Hover: bg `--accent-dim`.
- Secondary: same shape but color/border `--mute`, hover `--ink`.

### Footer
- 72px top padding, 96px bottom; 1px `--line` top border.
- Centered. One display-italic sig line in `--ink-2`. One mono line in `--mute`
  with date and authorship.

---

## 5. Visual punctuation — required mix

A doc that is only prose fails the "rich visuals" promise. For every non-trivial
doc, include at least **two** of the following:

1. Hero with faint inline-SVG or canvas background (grid, particle drift, or
   radial mesh).
2. One inline-SVG diagram (architecture, flow, comparison, decision tree).
3. One styled comparison or matrix table.
4. One phase / timeline strip (horizontal SVG ruler or vertical phase grid).
5. One bordered dark callout (Verdict / TL;DR / Decision / DoD).
6. One code block with hand-rolled syntax tokens.
7. One stats / metrics row (large display numerals + small mono labels).

Prefer inline SVG over canvas. Canvas only when the visual needs > 1000 elements
or per-pixel effects (rare for docs).

---

## 6. Motion

```css
--ease: cubic-bezier(0.2, 0.6, 0.2, 1);
```

- Hover transitions: **160ms** on color / border / background.
- Reveal animations (scroll-triggered, sparingly): 240ms ease-out, 12px
  translateY.
- Hero ambient motion (drifting dots, slow grid pan): perceived speed ≤
  ~0.5fps. Never distracting — the eye should not notice it on second glance.
- Always honor `prefers-reduced-motion: reduce` with:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

---

## 7. Slide variant

When rendering as slides (one `<section class="slide">` per slide):

- Each slide fills `100vh` × `100vw`.
- One headline (`h1` `clamp(56px, 7vw, 96px)`), one optional subhead, one
  visual focus.
- Slide counter: bottom-right corner, mono 11px `--mute`. Format `01 / 12` with
  the current number in `--accent`.
- Navigation hint (bottom-left, mono 11px `--mute`, opacity 0.6):
  `← →  navigate · space  next · ↑↓  jump 5 · home/end`.
- Keyboard nav: `←` / `→` / space / PageUp / PageDown advance one; `↑` / `↓`
  jump five; `Home` / `End` first/last. Update `location.hash` to current slide
  number so reload restores position.
- Transition: 240ms `var(--ease)`, fade + 8px translateY.
- Every fifth slide is a **rhythm slide**: `bg: var(--bg-2)`, `h1` in
  `--accent`, used to mark act breaks. Don't overuse.

---

## 8. Don'ts (hard constraints)

- **No external CSS / JS beyond Google Fonts.** No CDN script tags. No Prism,
  no Chart.js, no jQuery, no Tailwind CDN, no Alpine.
- **No images, no icon fonts, no emoji decoration.** All visuals are SVG,
  canvas, or pure CSS.
- **No drop shadows softer than `0 1px 0`.** The design earns depth through
  layering (`--bg` → `--bg-2` → `--bg-3`), not blur.
- **No `border-radius` > 8px.** 4–6px is the typical range.
- **No gradient text.** Hover/active states change color, not gradient.
- **No more than 2 typefaces visible per page.** Mono is the 3rd, reserved for
  metadata, eyebrows, and code.
- **No "fun" easter eggs, ASCII art, or sarcastic comments** in produced HTML.
- **No animated GIFs, no autoplaying audio/video.**
- **No `<table>` for layout.** Tables for tabular data only; use CSS grid for
  layout.
- **No hardcoded widths in px on diagrams.** SVGs use `viewBox` and scale
  responsively.

---

## 9. Project-local override

If the repo has `.claude/design.md` at its root (not inside the skill folder),
treat it as a **delta** on top of this file. Most projects shouldn't override —
the point of this system is consistency across docs. Override only for genuine
brand/visual identity reasons (e.g., a specific corporate palette), and document
the override at the top of the local file.
