// Seed the global davidup library with a curated starter pack so a freshly
// installed machine has useful templates, behavior cards, and fonts ready
// the moment a new project is created.
//
// Targets the same root the editor watches:
//   $DAVIDUP_LIBRARY   (if set)
//   ~/.davidup/library (default)
//
// Idempotent — re-running overwrites files this script owns, and a run that
// would change nothing writes nothing. User-authored files under the library
// root are left alone unless they collide with an id this script ships
// (templates/behaviors are keyed by file basename).
//
// Fonts are put on the user asset shelf (docs/asset-library-plan.md D5):
//   $DAVIDUP_ASSETS    (if set)
//   ~/.davidup/assets  (default)
// as `font` records (licence OFL, the foundry as credit), and index.json
// lists them as `asset:<id>` srcs. index.json's `assets`, and any font entry
// the seed does not ship, are left as they are.
//
// Re-running is also the *upgrade* path: an already-seeded library is never
// rewritten behind the user's back, so a pack change only reaches disk when
// this script runs again. `<root>/.davidup-seed.json` records the pack
// version that wrote the files, and a run against an older library prints
// what the upgrade brings.
//
// USAGE
//   bun run scripts/seed-global-library.ts
//   bun run seed:library
//   DAVIDUP_LIBRARY=/tmp/lib DAVIDUP_ASSETS=/tmp/assets bun run scripts/seed-global-library.ts
//
// FLAGS
//   --skip-fonts      Don't put fonts on the user shelf (offline mode).
//                     Templates + behavior cards still get written.
//   --skip-existing   Leave files that already exist on disk, and font
//                     records already on the user shelf, untouched.
//   --dry-run         Print what would be written without touching disk.
//   --quiet           Suppress per-file logs (final summary still prints).
//   --help            This help text.

import { promises as fs, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { openLibrary, sha, standardShelves, type Entry, type EntryInput } from "../assetlib/index.js";

// ──────────────── CLI ────────────────

const argv = new Set(process.argv.slice(2));
const SKIP_FONTS = argv.has("--skip-fonts");
const SKIP_EXISTING = argv.has("--skip-existing");
const DRY_RUN = argv.has("--dry-run");
const QUIET = argv.has("--quiet");

// ──────────────── Paths ────────────────

const LIBRARY_ROOT =
  process.env.DAVIDUP_LIBRARY && process.env.DAVIDUP_LIBRARY.length > 0
    ? process.env.DAVIDUP_LIBRARY
    : join(homedir(), ".davidup", "library");

const SUBDIRS = ["templates", "behaviors", "scenes", "assets", "fonts"] as const;

// The user asset shelf the fonts are put on: $DAVIDUP_ASSETS, else
// ~/.davidup/assets (assetlib's standardShelves, the rule every reader uses).
const USER_SHELF = standardShelves().find((s) => s.name === "user")!.root;

// ──────────────── Seed version ────────────────
//
// A library on disk is just files: nothing re-seeds it, and neither the CLI
// nor the editor rewrites a template a user already has (the editor's
// `library_index` only reads and watches). So an existing `~/.davidup/library`
// keeps whatever pack version it was seeded with until the user re-runs this
// script — which is the upgrade path.
//
// `<root>/.davidup-seed.json` records which pack version wrote the files, so
// a later run can say what a re-seed would bring and `--skip-existing` can
// warn that it left stale copies behind. Nothing reads it at runtime; the
// dot prefix and the name keep it out of the library watcher's file kinds.

const SEED_VERSION = 3;
const SEED_MARKER = ".davidup-seed.json";

/** What each bump changed, newest last. Printed when upgrading a library. */
const SEED_CHANGELOG: Array<{ version: number; note: string }> = [
  {
    version: 2,
    note:
      "B-8: every centred label in the pack moved to text box mode " +
      "(anchorX/Y 0.5), so a label is centred on its measured block instead " +
      "of sitting with its baseline on the centre line. Nine templates moved; " +
      "`ctaButton` and `tagPill` labels now sit in the middle of their pill.",
  },
  {
    version: 3,
    note:
      "Asset library D5: the ten fonts are `font` records on the user asset " +
      "shelf (~/.davidup/assets; licence OFL, credited to their foundries) and " +
      "index.json lists them as `asset:<id>`. index.json's `assets` is no " +
      "longer reset. The files stay in fonts/, so `global:fonts/...` still resolves.",
  },
];

// Help is printed here rather than in the CLI section above so it can name
// the pack version and the marker file.
if (argv.has("--help") || argv.has("-h")) {
  process.stdout.write(`\
Seed the global davidup library at $DAVIDUP_LIBRARY (default ~/.davidup/library),
and put its fonts on the user asset shelf at $DAVIDUP_ASSETS (default
~/.davidup/assets).

USAGE
  bun run scripts/seed-global-library.ts [flags]

FLAGS
  --skip-fonts      Skip the fonts (templates + behaviors only).
  --skip-existing   Leave already-present files and font records untouched.
  --dry-run         Print actions without writing.
  --quiet           Final summary only.
  --help            This help text.

The library root location can be overridden via the DAVIDUP_LIBRARY env var,
which matches the editor's resolution rules (apps/editor/app/services/
global_library_root.ts).

An existing library is only upgraded by re-running this script — nothing
rewrites it automatically. ${SEED_MARKER} at the library root records the
pack version on disk (currently v${SEED_VERSION}); a run against an older one
lists what changed.
`);
  process.exit(0);
}

// ──────────────── Templates ────────────────
//
// Each template is a TemplateDefinition (see src/compose/templates.ts +
// src/compose/builtInTemplates.ts for the schema in code form). Ids must
// not collide with the engine built-ins (titleCard, lowerThird, captionBurst,
// bulletList, kenburnsImage) — the project library wins on collision today
// but shadowing built-ins from the global pool would surprise users.
//
// TEXT PLACEMENT (B-8). Every centred label here is authored in text **box**
// mode — `anchorX/Y: 0.5` with the item's `x`/`y` naming the centre of the
// measured block. The original pack predates text v2 (v1.1 S13), when anchors
// did nothing to text: it used `anchorX/Y: 0` with centre coordinates, which
// put the *baseline* on the centre line, so every label floated high inside
// its card (`ctaButton`'s most visibly). Point mode is still the right choice
// for text that should sit on a baseline you computed — none of these do.
//
// The block is (widest line) x (lineCount x lineHeight x fontSize), so its
// centre is a *typographic* centre: the glyphs of a line with no descenders
// land a few pixels above it (~0.1 x fontSize). That is the engine's box
// model, not something to correct per template with a magic offset.
//
// VERSIONS. Each doc carries a `version` string, bumped whenever a change
// moves the pixels a template already on disk produces. The re-anchoring
// above took the nine templates that carry text from "1" to "2"; the two
// without text (`progressBar`, `logoBadge`) are unchanged and stay at "1".
// `SEED_VERSION` above is the pack-wide counter written to the marker file.

interface TemplateDoc {
  id: string;
  /**
   * Bumped when this template's output moves. Passed through to the written
   * file and surfaced by the editor's library catalog.
   */
  version: string;
  description: string;
  params: Array<{
    name: string;
    type: "number" | "string" | "color" | "boolean";
    required?: boolean;
    default?: unknown;
    description?: string;
  }>;
  items: Record<string, unknown>;
  tweens: unknown[];
}

const TEMPLATES: TemplateDoc[] = [
  // ───── endCard ─────
  {
    id: "endCard",
    version: "2",
    description:
      "Outro card with title and subtitle that fade in, hold, then fade out. Pair with an audio bed for a tidy clip ending.",
    params: [
      { name: "title", type: "string", required: true, description: "Outro headline." },
      { name: "subtitle", type: "string", default: "", description: "Tagline under the title." },
      { name: "x", type: "number", default: 640, description: "Center x." },
      { name: "y", type: "number", default: 340, description: "Title center y." },
      {
        name: "subtitleY",
        type: "number",
        default: 420,
        description: "Subtitle center y. Compute manually (no arithmetic in placeholders).",
      },
      { name: "fontDisplay", type: "string", required: true, description: "Title font asset id." },
      { name: "fontMono", type: "string", required: true, description: "Subtitle font asset id." },
      { name: "titleSize", type: "number", default: 96 },
      { name: "subtitleSize", type: "number", default: 32 },
      { name: "color", type: "color", default: "#ffffff" },
      { name: "accentColor", type: "color", default: "#9aa7ff" },
      {
        name: "holdEnd",
        type: "number",
        default: 1.6,
        description: "When the fade-out begins (seconds from template start).",
      },
    ],
    items: {
      title: {
        type: "text",
        text: "${params.title}",
        font: "${params.fontDisplay}",
        fontSize: "${params.titleSize}",
        color: "${params.color}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      subtitle: {
        type: "text",
        text: "${params.subtitle}",
        font: "${params.fontMono}",
        fontSize: "${params.subtitleSize}",
        color: "${params.accentColor}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.subtitleY}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      { $behavior: "fadeIn", target: "title", start: 0, duration: 0.5, easing: "easeOutQuad" },
      {
        $behavior: "fadeIn",
        target: "subtitle",
        start: 0.25,
        duration: 0.5,
        easing: "easeOutQuad",
      },
      {
        $behavior: "fadeOut",
        target: "title",
        start: "${params.holdEnd}",
        duration: 0.6,
        easing: "easeInQuad",
      },
      {
        $behavior: "fadeOut",
        target: "subtitle",
        start: "${params.holdEnd}",
        duration: 0.6,
        easing: "easeInQuad",
      },
    ],
  },

  // ───── quoteCard ─────
  {
    id: "quoteCard",
    version: "2",
    description:
      "Large pull-quote with attribution line. Quote pops in; attribution fades in shortly after.",
    params: [
      { name: "quote", type: "string", required: true, description: "Quote text (single line)." },
      { name: "attribution", type: "string", required: true, description: "Person + role." },
      { name: "x", type: "number", default: 640 },
      { name: "y", type: "number", default: 340, description: "Quote center y." },
      {
        name: "attributionY",
        type: "number",
        default: 460,
        description: "Attribution center y.",
      },
      { name: "fontSerif", type: "string", required: true, description: "Display/serif font id." },
      { name: "fontSans", type: "string", required: true, description: "Attribution font id." },
      { name: "quoteSize", type: "number", default: 72 },
      { name: "attributionSize", type: "number", default: 28 },
      { name: "color", type: "color", default: "#ffffff" },
      { name: "accentColor", type: "color", default: "#b8c0ff" },
    ],
    items: {
      quote: {
        type: "text",
        text: "${params.quote}",
        font: "${params.fontSerif}",
        fontSize: "${params.quoteSize}",
        color: "${params.color}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      attribution: {
        type: "text",
        text: "${params.attribution}",
        font: "${params.fontSans}",
        fontSize: "${params.attributionSize}",
        color: "${params.accentColor}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.attributionY}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        $behavior: "popIn",
        target: "quote",
        start: 0,
        duration: 0.7,
        easing: "easeOutBack",
        params: { fromScale: 0.85, toScale: 1, fromOpacity: 0, toOpacity: 1 },
      },
      {
        $behavior: "fadeIn",
        target: "attribution",
        start: 0.45,
        duration: 0.4,
        easing: "easeOutQuad",
      },
    ],
  },

  // ───── statBig ─────
  {
    id: "statBig",
    version: "2",
    description:
      "Hero stat: oversized number / metric on top, a small label underneath. Number pops in with scale-up, label fades in.",
    params: [
      { name: "value", type: "string", required: true, description: 'The number — pass a string like "99%" or "12K".' },
      { name: "label", type: "string", required: true, description: "Caption under the stat." },
      { name: "x", type: "number", default: 640 },
      { name: "y", type: "number", default: 360, description: "Number center y." },
      {
        name: "labelY",
        type: "number",
        default: 470,
        description: "Label center y.",
      },
      { name: "fontNumber", type: "string", required: true, description: "Display font id for the number." },
      { name: "fontLabel", type: "string", required: true, description: "Label font id." },
      { name: "valueSize", type: "number", default: 220 },
      { name: "labelSize", type: "number", default: 36 },
      { name: "color", type: "color", default: "#ffd166" },
      { name: "labelColor", type: "color", default: "#ffffff" },
    ],
    items: {
      value: {
        type: "text",
        text: "${params.value}",
        font: "${params.fontNumber}",
        fontSize: "${params.valueSize}",
        color: "${params.color}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      label: {
        type: "text",
        text: "${params.label}",
        font: "${params.fontLabel}",
        fontSize: "${params.labelSize}",
        color: "${params.labelColor}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.labelY}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        $behavior: "popIn",
        target: "value",
        start: 0,
        duration: 0.6,
        easing: "easeOutBack",
        params: { fromScale: 0.4, toScale: 1, fromOpacity: 0, toOpacity: 1 },
      },
      {
        $behavior: "fadeIn",
        target: "label",
        start: 0.35,
        duration: 0.4,
        easing: "easeOutQuad",
      },
    ],
  },

  // ───── ctaButton ─────
  {
    id: "ctaButton",
    version: "2",
    description:
      "Animated call-to-action: rounded pill rectangle with centered text inside, both pop in together.",
    params: [
      { name: "label", type: "string", required: true, description: "Button text." },
      { name: "x", type: "number", default: 640, description: "Button center x." },
      { name: "y", type: "number", default: 620, description: "Button center y." },
      { name: "width", type: "number", default: 360 },
      { name: "height", type: "number", default: 88 },
      { name: "cornerRadius", type: "number", default: 44 },
      { name: "fillColor", type: "color", default: "#ff6b35" },
      { name: "textColor", type: "color", default: "#ffffff" },
      { name: "font", type: "string", required: true, description: "Font asset id for the label." },
      { name: "fontSize", type: "number", default: 32 },
    ],
    items: {
      bg: {
        type: "shape",
        kind: "rect",
        width: "${params.width}",
        height: "${params.height}",
        fillColor: "${params.fillColor}",
        cornerRadius: "${params.cornerRadius}",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      label: {
        type: "text",
        text: "${params.label}",
        font: "${params.font}",
        fontSize: "${params.fontSize}",
        color: "${params.textColor}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        $behavior: "popIn",
        target: "bg",
        start: 0,
        duration: 0.5,
        easing: "easeOutBack",
        params: { fromScale: 0.7, toScale: 1, fromOpacity: 0, toOpacity: 1 },
      },
      {
        $behavior: "fadeIn",
        target: "label",
        start: 0.2,
        duration: 0.4,
        easing: "easeOutQuad",
      },
      {
        $behavior: "pulse",
        target: "bg",
        start: 1.0,
        duration: 0.6,
        easing: "easeInOutQuad",
        params: { peakScale: 1.06, fromScale: 1 },
      },
    ],
  },

  // ───── sectionDivider ─────
  {
    id: "sectionDivider",
    version: "2",
    description:
      "Horizontal accent line that sweeps in from the left with an optional centered label that fades in above.",
    params: [
      { name: "label", type: "string", default: "", description: 'Centered text above the rule. Pass "" to hide.' },
      { name: "x", type: "number", default: 200, description: "Left edge x of the rule." },
      { name: "y", type: "number", default: 540, description: "Rule y position." },
      { name: "labelY", type: "number", default: 490, description: "Label center y." },
      { name: "width", type: "number", default: 880, description: "Final width of the rule." },
      { name: "height", type: "number", default: 4 },
      { name: "color", type: "color", default: "#ffd166" },
      { name: "labelColor", type: "color", default: "#ffffff" },
      { name: "labelX", type: "number", default: 640, description: "Label center x." },
      { name: "font", type: "string", required: true, description: "Font asset id for the label." },
      { name: "fontSize", type: "number", default: 28 },
    ],
    items: {
      rule: {
        type: "shape",
        kind: "rect",
        width: 0,
        height: "${params.height}",
        fillColor: "${params.color}",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      label: {
        type: "text",
        text: "${params.label}",
        font: "${params.font}",
        fontSize: "${params.fontSize}",
        color: "${params.labelColor}",
        align: "center",
        transform: {
          x: "${params.labelX}",
          y: "${params.labelY}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        target: "rule",
        property: "width",
        from: 0,
        to: "${params.width}",
        start: 0,
        duration: 0.7,
        easing: "easeOutCubic",
      },
      {
        $behavior: "fadeIn",
        target: "label",
        start: 0.3,
        duration: 0.4,
        easing: "easeOutQuad",
      },
    ],
  },

  // ───── progressBar ─────
  {
    id: "progressBar",
    version: "1",
    description:
      "Track + fill horizontal bar. The fill animates from 0 to `fillWidth`. Drop in below a label or stat.",
    params: [
      { name: "x", type: "number", default: 240, description: "Left edge x of the track." },
      { name: "y", type: "number", default: 560, description: "Track y." },
      { name: "trackWidth", type: "number", default: 800 },
      { name: "height", type: "number", default: 24 },
      { name: "cornerRadius", type: "number", default: 12 },
      { name: "trackColor", type: "color", default: "#1d2046" },
      { name: "fillColor", type: "color", default: "#7ce0c0" },
      {
        name: "fillWidth",
        type: "number",
        default: 560,
        description: "Target width of the fill. Set this to (percent / 100) * trackWidth manually.",
      },
      { name: "duration", type: "number", default: 1.2, description: "Fill animation duration." },
    ],
    items: {
      track: {
        type: "shape",
        kind: "rect",
        width: "${params.trackWidth}",
        height: "${params.height}",
        fillColor: "${params.trackColor}",
        cornerRadius: "${params.cornerRadius}",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      fill: {
        type: "shape",
        kind: "rect",
        width: 0,
        height: "${params.height}",
        fillColor: "${params.fillColor}",
        cornerRadius: "${params.cornerRadius}",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
    },
    tweens: [
      {
        target: "fill",
        property: "width",
        from: 0,
        to: "${params.fillWidth}",
        start: 0,
        duration: "${params.duration}",
        easing: "easeOutCubic",
      },
    ],
  },

  // ───── tagPill ─────
  {
    id: "tagPill",
    version: "2",
    description:
      "Small rounded label — a colored pill with text. Useful for category badges or status chips.",
    params: [
      { name: "label", type: "string", required: true, description: "Pill text." },
      { name: "x", type: "number", default: 120, description: "Pill center x." },
      { name: "y", type: "number", default: 120, description: "Pill center y." },
      { name: "width", type: "number", default: 180 },
      { name: "height", type: "number", default: 48 },
      { name: "cornerRadius", type: "number", default: 24 },
      { name: "fillColor", type: "color", default: "#7ce0c0" },
      { name: "textColor", type: "color", default: "#0a0e27" },
      { name: "font", type: "string", required: true, description: "Font asset id." },
      { name: "fontSize", type: "number", default: 22 },
    ],
    items: {
      bg: {
        type: "shape",
        kind: "rect",
        width: "${params.width}",
        height: "${params.height}",
        fillColor: "${params.fillColor}",
        cornerRadius: "${params.cornerRadius}",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      label: {
        type: "text",
        text: "${params.label}",
        font: "${params.font}",
        fontSize: "${params.fontSize}",
        color: "${params.textColor}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        $behavior: "popIn",
        target: "bg",
        start: 0,
        duration: 0.4,
        easing: "easeOutBack",
        params: { fromScale: 0.5, toScale: 1, fromOpacity: 0, toOpacity: 1 },
      },
      {
        $behavior: "fadeIn",
        target: "label",
        start: 0.12,
        duration: 0.3,
        easing: "easeOutQuad",
      },
    ],
  },

  // ───── countdown321 ─────
  {
    id: "countdown321",
    version: "2",
    description:
      'Sequenced "3", "2", "1" burst captions — each pops in then out 0.4s later. Drop at clip start as an opener.',
    params: [
      { name: "x", type: "number", default: 640 },
      { name: "y", type: "number", default: 360 },
      { name: "font", type: "string", required: true, description: "Display font asset id." },
      { name: "fontSize", type: "number", default: 320 },
      { name: "color", type: "color", default: "#ff6b35" },
      {
        name: "stepDuration",
        type: "number",
        default: 0.8,
        description: "Seconds each digit holds before the next.",
      },
      {
        name: "twoStart",
        type: "number",
        default: 0.8,
        description: "Start of the '2' beat. Set = stepDuration.",
      },
      {
        name: "oneStart",
        type: "number",
        default: 1.6,
        description: "Start of the '1' beat. Set = 2*stepDuration.",
      },
    ],
    items: {
      three: {
        type: "text",
        text: "3",
        font: "${params.font}",
        fontSize: "${params.fontSize}",
        color: "${params.color}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      two: {
        type: "text",
        text: "2",
        font: "${params.font}",
        fontSize: "${params.fontSize}",
        color: "${params.color}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      one: {
        type: "text",
        text: "1",
        font: "${params.font}",
        fontSize: "${params.fontSize}",
        color: "${params.color}",
        align: "center",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        $behavior: "popIn",
        target: "three",
        start: 0,
        duration: 0.3,
        easing: "easeOutBack",
        params: { fromScale: 0.4, toScale: 1, fromOpacity: 0, toOpacity: 1 },
      },
      {
        $behavior: "fadeOut",
        target: "three",
        start: 0.5,
        duration: 0.2,
        easing: "easeInQuad",
      },
      {
        $behavior: "popIn",
        target: "two",
        start: "${params.twoStart}",
        duration: 0.3,
        easing: "easeOutBack",
        params: { fromScale: 0.4, toScale: 1, fromOpacity: 0, toOpacity: 1 },
      },
      {
        $behavior: "fadeOut",
        target: "two",
        start: 1.3,
        duration: 0.2,
        easing: "easeInQuad",
      },
      {
        $behavior: "popIn",
        target: "one",
        start: "${params.oneStart}",
        duration: 0.3,
        easing: "easeOutBack",
        params: { fromScale: 0.4, toScale: 1, fromOpacity: 0, toOpacity: 1 },
      },
      {
        $behavior: "fadeOut",
        target: "one",
        start: 2.1,
        duration: 0.2,
        easing: "easeInQuad",
      },
    ],
  },

  // ───── logoBadge ─────
  {
    id: "logoBadge",
    version: "1",
    description:
      "Image sprite framed by a rounded square that pops in. Use for logo stings or speaker headshots.",
    params: [
      {
        name: "asset",
        type: "string",
        required: true,
        description: "Image asset id (must be registered on the composition).",
      },
      { name: "x", type: "number", default: 640 },
      { name: "y", type: "number", default: 360 },
      { name: "size", type: "number", default: 360 },
      { name: "frameColor", type: "color", default: "#1d2046" },
      { name: "cornerRadius", type: "number", default: 32 },
      { name: "imageWidth", type: "number", default: 320 },
      { name: "imageHeight", type: "number", default: 320 },
    ],
    items: {
      frame: {
        type: "shape",
        kind: "rect",
        width: "${params.size}",
        height: "${params.size}",
        fillColor: "${params.frameColor}",
        cornerRadius: "${params.cornerRadius}",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      img: {
        type: "sprite",
        asset: "${params.asset}",
        width: "${params.imageWidth}",
        height: "${params.imageHeight}",
        transform: {
          x: "${params.x}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        $behavior: "popIn",
        target: "frame",
        start: 0,
        duration: 0.5,
        easing: "easeOutBack",
        params: { fromScale: 0.6, toScale: 1, fromOpacity: 0, toOpacity: 1 },
      },
      {
        $behavior: "fadeIn",
        target: "img",
        start: 0.2,
        duration: 0.4,
        easing: "easeOutQuad",
      },
    ],
  },

  // ───── subtitleBar ─────
  {
    id: "subtitleBar",
    version: "2",
    description:
      "Letterbox-style subtitle bar across the bottom: dark backing rectangle slides in from below, caption text fades in over it.",
    params: [
      { name: "text", type: "string", required: true, description: "Caption text." },
      { name: "barY", type: "number", default: 640, description: "Final y of the bar." },
      { name: "barHeight", type: "number", default: 96 },
      { name: "barColor", type: "color", default: "#0a0e27" },
      { name: "barWidth", type: "number", default: 1280 },
      {
        name: "barFromY",
        type: "number",
        default: 760,
        description: "Off-screen start y for the slide. Should be > barY.",
      },
      { name: "textX", type: "number", default: 640 },
      {
        name: "textY",
        type: "number",
        default: 688,
        description: "Caption center y. Defaults to the bar's centre (barY + barHeight / 2).",
      },
      { name: "textColor", type: "color", default: "#ffffff" },
      { name: "font", type: "string", required: true },
      { name: "fontSize", type: "number", default: 36 },
    ],
    items: {
      bar: {
        type: "shape",
        kind: "rect",
        width: "${params.barWidth}",
        height: "${params.barHeight}",
        fillColor: "${params.barColor}",
        transform: {
          x: 0,
          y: "${params.barFromY}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0,
          anchorY: 0,
          opacity: 1,
        },
      },
      caption: {
        type: "text",
        text: "${params.text}",
        font: "${params.font}",
        fontSize: "${params.fontSize}",
        color: "${params.textColor}",
        align: "center",
        transform: {
          x: "${params.textX}",
          y: "${params.textY}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        $behavior: "slideIn",
        target: "bar",
        start: 0,
        duration: 0.45,
        easing: "easeOutCubic",
        params: { from: "${params.barFromY}", to: "${params.barY}", axis: "y" },
      },
      {
        $behavior: "fadeIn",
        target: "caption",
        start: 0.25,
        duration: 0.4,
        easing: "easeOutQuad",
      },
    ],
  },

  // ───── compareSplit ─────
  {
    id: "compareSplit",
    version: "2",
    description:
      'Two-column "vs" cards. Left card slides in from the left, right card from the right. Drop two short labels on top.',
    params: [
      { name: "leftLabel", type: "string", required: true },
      { name: "rightLabel", type: "string", required: true },
      { name: "y", type: "number", default: 360, description: "Vertical center for both cards." },
      { name: "cardWidth", type: "number", default: 480 },
      { name: "cardHeight", type: "number", default: 280 },
      { name: "leftX", type: "number", default: 320, description: "Center x of the left card." },
      { name: "rightX", type: "number", default: 960, description: "Center x of the right card." },
      {
        name: "leftFromX",
        type: "number",
        default: -200,
        description: "Off-screen start x for the left card slide.",
      },
      {
        name: "rightFromX",
        type: "number",
        default: 1480,
        description: "Off-screen start x for the right card slide.",
      },
      { name: "leftColor", type: "color", default: "#ff6b35" },
      { name: "rightColor", type: "color", default: "#7ce0c0" },
      { name: "textColor", type: "color", default: "#ffffff" },
      { name: "font", type: "string", required: true },
      { name: "fontSize", type: "number", default: 56 },
      { name: "cornerRadius", type: "number", default: 28 },
    ],
    items: {
      leftCard: {
        type: "shape",
        kind: "rect",
        width: "${params.cardWidth}",
        height: "${params.cardHeight}",
        fillColor: "${params.leftColor}",
        cornerRadius: "${params.cornerRadius}",
        transform: {
          x: "${params.leftFromX}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
      rightCard: {
        type: "shape",
        kind: "rect",
        width: "${params.cardWidth}",
        height: "${params.cardHeight}",
        fillColor: "${params.rightColor}",
        cornerRadius: "${params.cornerRadius}",
        transform: {
          x: "${params.rightFromX}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 1,
        },
      },
      leftText: {
        type: "text",
        text: "${params.leftLabel}",
        font: "${params.font}",
        fontSize: "${params.fontSize}",
        color: "${params.textColor}",
        align: "center",
        transform: {
          x: "${params.leftX}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
      rightText: {
        type: "text",
        text: "${params.rightLabel}",
        font: "${params.font}",
        fontSize: "${params.fontSize}",
        color: "${params.textColor}",
        align: "center",
        transform: {
          x: "${params.rightX}",
          y: "${params.y}",
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0,
        },
      },
    },
    tweens: [
      {
        $behavior: "slideIn",
        target: "leftCard",
        start: 0,
        duration: 0.5,
        easing: "easeOutCubic",
        params: { from: "${params.leftFromX}", to: "${params.leftX}", axis: "x" },
      },
      {
        $behavior: "slideIn",
        target: "rightCard",
        start: 0.1,
        duration: 0.5,
        easing: "easeOutCubic",
        params: { from: "${params.rightFromX}", to: "${params.rightX}", axis: "x" },
      },
      {
        $behavior: "fadeIn",
        target: "leftText",
        start: 0.35,
        duration: 0.35,
        easing: "easeOutQuad",
      },
      {
        $behavior: "fadeIn",
        target: "rightText",
        start: 0.45,
        duration: 0.35,
        easing: "easeOutQuad",
      },
    ],
  },
];

// ──────────────── Behaviors ────────────────
//
// These eleven cards mirror the engine's built-ins: they carry no `tweens`
// body, so re-registering the name preserves the built-in expand() and only
// the catalog metadata comes from the file. Writing them makes the built-ins
// draggable from the Library panel without changing runtime semantics.
//
// A card that *does* carry a `tweens` body is executable (v1.1 S19) — that's
// how user-authored library behaviors ship real motion. `swoopIn` below is the
// worked example; see src/compose/behaviors.ts for the body's shape.

interface BehaviorDoc {
  name: string;
  description: string;
  params: Array<{
    name: string;
    type: "number" | "string" | "color" | "colorArray" | "axis";
    required?: boolean;
    default?: unknown;
    description?: string;
  }>;
  /**
   * Executable body. Times are absolute against the applied block: `${$.start}`
   * is where it lands, `${$.duration}` how long it was given.
   */
  tweens?: Array<Record<string, unknown>>;
}

const BEHAVIORS: BehaviorDoc[] = [
  {
    name: "fadeIn",
    description: "Opacity from `fromOpacity` (default 0) to `toOpacity` (default 1).",
    params: [
      { name: "fromOpacity", type: "number", default: 0, description: "Opacity at start." },
      { name: "toOpacity", type: "number", default: 1, description: "Opacity at end." },
    ],
  },
  {
    name: "fadeOut",
    description: "Opacity from `fromOpacity` (default 1) to `toOpacity` (default 0).",
    params: [
      { name: "fromOpacity", type: "number", default: 1 },
      { name: "toOpacity", type: "number", default: 0 },
    ],
  },
  {
    name: "popIn",
    description: "Scale-up + fade-in. Defaults: 0.2→1 scale, 0→1 opacity.",
    params: [
      { name: "fromScale", type: "number", default: 0.2 },
      { name: "toScale", type: "number", default: 1 },
      { name: "fromOpacity", type: "number", default: 0 },
      { name: "toOpacity", type: "number", default: 1 },
    ],
  },
  {
    name: "popOut",
    description: "Scale-down + fade-out. Defaults: 1→0.2 scale, 1→0 opacity.",
    params: [
      { name: "fromScale", type: "number", default: 1 },
      { name: "toScale", type: "number", default: 0.2 },
      { name: "fromOpacity", type: "number", default: 1 },
      { name: "toOpacity", type: "number", default: 0 },
    ],
  },
  {
    name: "slideIn",
    description: "Translate from an offset value back to a resting position on the chosen axis.",
    params: [
      { name: "from", type: "number", required: true, description: "Offset the slide starts at." },
      { name: "axis", type: "axis", required: true, description: '"x" or "y".' },
      { name: "to", type: "number", default: 0, description: "Resting value at end." },
    ],
  },
  {
    name: "slideOut",
    description: "Translate from a resting value out to an offset on the chosen axis.",
    params: [
      { name: "to", type: "number", required: true },
      { name: "axis", type: "axis", required: true },
      { name: "from", type: "number", default: 0 },
    ],
  },
  {
    name: "rotateSpin",
    description: "Rotate by `turns` full turns. Set fromRotation if you need a non-zero baseline.",
    params: [
      { name: "turns", type: "number", default: 1 },
      { name: "fromRotation", type: "number", default: 0 },
    ],
  },
  {
    name: "kenburns",
    description: "Slow positional drift + scale drift — the classic still-frame Ken Burns move.",
    params: [
      { name: "fromScale", type: "number", required: true },
      { name: "toScale", type: "number", required: true },
      { name: "pan", type: "number", required: true, description: "Pixels to drift along the axis." },
      { name: "axis", type: "axis", default: "x" },
      { name: "fromPosition", type: "number", default: 0 },
    ],
  },
  {
    name: "shake",
    description: "Oscillate by ±amplitude for `cycles` full cycles. Returns to center at end.",
    params: [
      { name: "amplitude", type: "number", required: true, description: "Peak displacement (px)." },
      { name: "cycles", type: "number", required: true, description: "Full cycles (≥ 1)." },
      { name: "axis", type: "axis", default: "x" },
      { name: "center", type: "number", default: 0 },
    ],
  },
  {
    name: "colorCycle",
    description: "Tween a color property through ≥2 color stops, evenly dividing the duration.",
    params: [
      { name: "colors", type: "colorArray", required: true, description: "Stops (≥ 2)." },
      { name: "property", type: "string", default: "tint", description: 'e.g. "tint", "fillColor", "color".' },
    ],
  },
  {
    name: "pulse",
    description: "Scale out then back in. Set peakScale to the bulge size.",
    params: [
      { name: "peakScale", type: "number", required: true },
      { name: "fromScale", type: "number", default: 1 },
    ],
  },
  // The one executable card (v1.1 S19) — a library behavior with a real body,
  // not a mirror of a built-in. Slides in from `distance` on the chosen axis
  // while fading up over the first `fadeFraction` of the block.
  {
    name: "swoopIn",
    description:
      "Slide in from an offset while fading up — a library behavior with an executable `tweens` body (edit this file to tune it).",
    params: [
      {
        name: "distance",
        type: "number",
        default: 120,
        description: "Pixels to travel; negative comes from the other side.",
      },
      { name: "axis", type: "axis", default: "y", description: '"x" or "y".' },
      {
        name: "fadeFraction",
        type: "number",
        default: 0.5,
        description: "Share of the block the fade-up occupies (0–1).",
      },
    ],
    tweens: [
      {
        property: "transform.${params.axis}",
        from: "${params.distance}",
        to: 0,
        easing: "easeOutCubic",
        suffix: "slide",
      },
      {
        property: "transform.opacity",
        from: 0,
        to: 1,
        duration: "${$.duration * params.fadeFraction}",
        suffix: "opacity",
      },
    ],
  },
];

// ──────────────── Fonts ────────────────
//
// Files are downloaded from the @fontsource jsdelivr mirror and put on the
// user asset shelf as `font` records (D5): licence OFL, the foundry as
// credit, the mirror URL as source, `family` and `weight` from the spec
// (assetlib does not read WOFF2, so the spec says what the file would).
// index.json lists each as `asset:<id>`, which resolves through the shelves.
//
// The file is also kept at <library>/fonts/<file>.woff2, so a composition
// that still says `global:fonts/<file>.woff2` resolves unchanged; a run finds
// the bytes there (or on the shelf) before it downloads anything.

interface FontSpec {
  id: string;
  family: string;
  weight: number;
  file: string;
  url: string;
  description: string;
  /** The foundry or designer, as the record's credit. */
  credit: string;
  tags: string[];
}

const FONTS: FontSpec[] = [
  {
    id: "inter-bold",
    family: "Inter",
    weight: 700,
    file: "inter-700.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff2",
    description: "Inter Bold — modern UI sans-serif, great default headline.",
    credit: "Inter by Rasmus Andersson",
    tags: ["sans", "ui", "headline"],
  },
  {
    id: "inter-regular",
    family: "Inter Regular",
    weight: 400,
    file: "inter-400.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff2",
    description: "Inter Regular — body copy and small caption text.",
    credit: "Inter by Rasmus Andersson",
    tags: ["sans", "ui", "body"],
  },
  {
    id: "bebas-neue",
    family: "Bebas Neue",
    weight: 400,
    file: "bebas-neue-400.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2",
    description: "Bebas Neue — narrow display caps, classic lower-third stalwart.",
    credit: "Bebas Neue by Dharma Type (Ryoichi Tsunekawa)",
    tags: ["sans", "display", "condensed", "caps"],
  },
  {
    id: "anton",
    family: "Anton",
    weight: 400,
    file: "anton-400.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/anton/files/anton-latin-400-normal.woff2",
    description: "Anton — heavy single-weight impact for hero titles.",
    credit: "Anton by Vernon Adams",
    tags: ["sans", "display", "condensed", "impact"],
  },
  {
    id: "playfair-display-bold",
    family: "Playfair Display",
    weight: 700,
    file: "playfair-display-700.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2",
    description: "Playfair Display Bold — high-contrast serif for editorial quotes.",
    credit: "Playfair Display by Claus Eggers Sørensen",
    tags: ["serif", "display", "editorial"],
  },
  {
    id: "montserrat-bold",
    family: "Montserrat",
    weight: 700,
    file: "montserrat-700.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/montserrat/files/montserrat-latin-700-normal.woff2",
    description: "Montserrat Bold — geometric sans for posters and stat callouts.",
    credit: "Montserrat by Julieta Ulanovsky",
    tags: ["sans", "geometric", "poster"],
  },
  {
    id: "space-grotesk",
    family: "Space Grotesk",
    weight: 500,
    file: "space-grotesk-500.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2",
    description: "Space Grotesk Medium — quirky-but-clean modern sans.",
    credit: "Space Grotesk by Florian Karsten",
    tags: ["sans", "grotesque"],
  },
  {
    id: "jetbrains-mono",
    family: "JetBrains Mono",
    weight: 500,
    file: "jetbrains-mono-500.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2",
    description: "JetBrains Mono Medium — code overlays and technical captions.",
    credit: "JetBrains Mono by JetBrains",
    tags: ["mono", "code"],
  },
  {
    id: "caveat-bold",
    family: "Caveat",
    weight: 700,
    file: "caveat-700.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/caveat/files/caveat-latin-700-normal.woff2",
    description: "Caveat Bold — handwritten accent for annotations and arrows.",
    credit: "Caveat by Impallari Type",
    tags: ["handwritten", "script", "annotation"],
  },
  {
    id: "dm-sans",
    family: "DM Sans",
    weight: 500,
    file: "dm-sans-500.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2",
    description: "DM Sans Medium — friendly geometric sans for product UI.",
    credit: "DM Sans by Colophon Foundry",
    tags: ["sans", "geometric", "ui"],
  },
];

// ──────────────── Plumbing ────────────────

interface WriteResult {
  kind: "wrote" | "unchanged" | "skipped" | "would-write" | "failed";
  reason?: string;
}

interface Counter {
  wrote: number;
  unchanged: number;
  skipped: number;
  failed: number;
}
const counter = (): Counter => ({ wrote: 0, unchanged: 0, skipped: 0, failed: 0 });

const summary = {
  templates: counter(),
  behaviors: counter(),
  fonts: counter(),
};

function log(line: string): void {
  if (!QUIET) process.stdout.write(`${line}\n`);
}

function warn(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function ensureDirs(): Promise<void> {
  if (DRY_RUN) {
    log(`(dry-run) mkdir -p ${LIBRARY_ROOT} + subdirs ${SUBDIRS.join(", ")}`);
    return;
  }
  await fs.mkdir(LIBRARY_ROOT, { recursive: true });
  for (const sub of SUBDIRS) {
    await fs.mkdir(join(LIBRARY_ROOT, sub), { recursive: true });
  }
}

// Writes `text` unless the file already says exactly that, so a second run
// changes nothing on disk.
async function writeText(absPath: string, text: string): Promise<WriteResult> {
  try {
    if ((await fs.readFile(absPath, "utf8")) === text) return { kind: "unchanged" };
  } catch {
    // Missing or unreadable: write it.
  }
  if (DRY_RUN) return { kind: "would-write" };
  await fs.mkdir(dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, text, "utf8");
  return { kind: "wrote" };
}

async function writeJson(absPath: string, value: unknown): Promise<WriteResult> {
  if (SKIP_EXISTING && existsSync(absPath)) {
    return { kind: "skipped", reason: "exists" };
  }
  return writeText(absPath, `${JSON.stringify(value, null, 2)}\n`);
}

// The pack version that wrote the files currently on disk, plus the per-id
// versions, so a re-run can report exactly what it is about to change.
interface SeedMarker {
  seedVersion: number;
  templates: Record<string, string>;
}

async function readMarker(): Promise<SeedMarker | null> {
  try {
    const raw = await fs.readFile(join(LIBRARY_ROOT, SEED_MARKER), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Partial<SeedMarker>;
    if (typeof obj.seedVersion !== "number") return null;
    return { seedVersion: obj.seedVersion, templates: obj.templates ?? {} };
  } catch {
    // Missing, unreadable or not JSON — treat as "seeded before markers", which
    // is what a library from an earlier pack actually is.
    return null;
  }
}

async function writeMarker(): Promise<WriteResult> {
  const value = {
    $generatedBy: "scripts/seed-global-library.ts",
    $note:
      "Records which seed pack wrote this library. Re-run `bun run seed:library` to upgrade; nothing reads this file at runtime.",
    seedVersion: SEED_VERSION,
    templates: Object.fromEntries(TEMPLATES.map((t) => [t.id, t.version])),
  };
  return writeText(join(LIBRARY_ROOT, SEED_MARKER), `${JSON.stringify(value, null, 2)}\n`);
}

// ──────────────── Fonts on the user shelf ────────────────

type Library = ReturnType<typeof openLibrary>;

/** The record the seed puts for a font: everything but what the bytes decide. */
function fontEntry(f: FontSpec): EntryInput {
  const [name, rest] = f.description.split(" — ");
  const desc = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : f.description;
  return {
    id: f.id,
    kind: "font",
    name: name!,
    desc,
    tags: ["font", ...f.tags],
    licence: "OFL",
    credit: f.credit,
    source: f.url,
    family: f.family,
    weight: f.weight,
    style: "normal",
  } as EntryInput;
}

/** The shelf already holds `entry` as the seed would put it. */
function sameRecord(had: Entry, entry: EntryInput, bytes: Uint8Array): boolean {
  if (had.sha !== sha(bytes)) return false;
  const was = had as unknown as Record<string, unknown>;
  // A stored entry is keyed by its id and does not carry it.
  return Object.entries(entry).every(([k, v]) => k === "id" || JSON.stringify(was[k]) === JSON.stringify(v));
}

// A font's bytes: the <library>/fonts copy, else the shelf's blob when its
// record came from the same URL, else a download. null when only a download
// would have them and this is a dry run.
async function fontBytes(lib: Library, f: FontSpec, had: Entry | undefined): Promise<Uint8Array | null> {
  const copy = join(LIBRARY_ROOT, "fonts", f.file);
  if (existsSync(copy)) return fs.readFile(copy);
  const shelf = lib.shelf("user");
  if (had && had.source === f.url && existsSync(shelf.blobPath(had))) return fs.readFile(shelf.blobPath(had));
  if (DRY_RUN) return null;
  const res = await fetch(f.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function seedFont(lib: Library, f: FontSpec): Promise<WriteResult> {
  const shelf = lib.shelf("user");
  const had = shelf.entries.get(f.id);
  if (SKIP_EXISTING && had) return { kind: "skipped", reason: "on the user shelf" };
  let bytes: Uint8Array | null;
  try {
    bytes = await fontBytes(lib, f, had);
  } catch (err) {
    return { kind: "failed", reason: (err as Error).message };
  }
  if (!bytes) return { kind: "would-write", reason: "download and put" };

  // Keep the global:fonts/<file> path resolving for compositions that name it.
  const copy = join(LIBRARY_ROOT, "fonts", f.file);
  if (!DRY_RUN && !existsSync(copy)) {
    await fs.mkdir(dirname(copy), { recursive: true });
    await fs.writeFile(copy, bytes);
  }

  const entry = fontEntry(f);
  if (had && sameRecord(had, entry, bytes)) return { kind: "unchanged" };
  if (DRY_RUN) return { kind: "would-write", ...(had ? { reason: "replace" } : {}) };
  try {
    // assetlib does not read WOFF2; the entry already names what it would
    // (family, weight, style), so the probe has nothing to add.
    const out = await lib.put("user", entry, bytes, { probes: { fontMeta: () => ({}) }, by: "seed" });
    for (const w of out.warnings) warn(`  font      ${f.id}: ${w}`);
    // A replaced blob nothing else on the shelf holds goes with its thumb.
    if (had && had.sha !== out.entry.sha && ![...shelf.entries.values()].some((e) => e.sha === had.sha)) {
      for (const p of [shelf.blobPath(had), shelf.thumbPath(had)]) await fs.rm(p, { force: true });
    }
    return { kind: "wrote", ...(had ? { reason: "replaced" } : {}) };
  } catch (err) {
    return { kind: "failed", reason: (err as Error).message };
  }
}

// index.json: the seed's fonts as `asset:<id>` srcs, in pack order, then any
// font entry the pack does not ship; every other key (`assets` among them)
// as it was. A pack font that is on no shelf keeps the entry it had.
async function writeIndex(onShelf: Set<string>): Promise<WriteResult> {
  const path = join(LIBRARY_ROOT, "index.json");
  let prev: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(path, "utf8"));
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("not an object");
      prev = raw as Record<string, unknown>;
    } catch (err) {
      return { kind: "failed", reason: `index.json is not a JSON object (${(err as Error).message}); left as it is` };
    }
  }
  const old = (Array.isArray(prev.fonts) ? prev.fonts : []) as unknown[];
  const idOf = (e: unknown) => (typeof e === "object" && e !== null ? (e as { id?: unknown }).id : undefined);
  const ours = new Set(FONTS.map((f) => f.id));
  const fonts = [
    ...FONTS.flatMap((f) =>
      onShelf.has(f.id)
        ? [{ id: f.id, type: "font", family: f.family, src: `asset:${f.id}`, description: f.description }]
        : old.filter((e) => idOf(e) === f.id),
    ),
    ...old.filter((e) => !ours.has(idOf(e) as string)),
  ];
  return writeJson(path, {
    ...prev,
    $generatedBy: "scripts/seed-global-library.ts",
    $note:
      "Fonts are listed here so the Library panel shows them; the seed's are `asset:<id>` records on the user asset shelf (~/.davidup/assets). Re-running the seed rewrites its own font entries; other entries and `assets` are left as they are.",
    fonts,
  });
}

// ──────────────── Main ────────────────

async function main(): Promise<void> {
  log(`davidup library seed → ${LIBRARY_ROOT} (pack v${SEED_VERSION})`);
  if (!SKIP_FONTS) log(`  fonts → user asset shelf ${USER_SHELF}`);
  if (DRY_RUN) log("(dry-run: no files will change)");

  const previous = await readMarker();
  if (previous !== null && previous.seedVersion < SEED_VERSION) {
    log(`  upgrading a library seeded at pack v${previous.seedVersion}:`);
    for (const entry of SEED_CHANGELOG) {
      if (entry.version > previous.seedVersion) log(`    v${entry.version}  ${entry.note}`);
    }
  }

  await ensureDirs();

  // Templates ────────
  for (const tpl of TEMPLATES) {
    const path = join(LIBRARY_ROOT, "templates", `${tpl.id}.template.json`);
    const res = await writeJson(path, tpl);
    bump(summary.templates, res);
    log(`  template  ${tpl.id.padEnd(20)}  ${describe(res)}`);
  }

  // Behaviors ────────
  for (const beh of BEHAVIORS) {
    const path = join(LIBRARY_ROOT, "behaviors", `${beh.name}.behavior.json`);
    const res = await writeJson(path, beh);
    bump(summary.behaviors, res);
    log(`  behavior  ${beh.name.padEnd(20)}  ${describe(res)}`);
  }

  // Fonts ────────
  if (SKIP_FONTS) {
    log("(skipping fonts — --skip-fonts; index.json left as it is)");
  } else {
    const lib = openLibrary({ shelves: [{ name: "user", root: USER_SHELF }] });
    const onShelf = new Set<string>();
    for (const f of FONTS) {
      const res = await seedFont(lib, f);
      bump(summary.fonts, res);
      log(`  font      ${f.id.padEnd(28)}  ${describe(res, "put")}`);
      if (lib.shelf("user").has(f.id) || res.kind === "would-write") onShelf.add(f.id);
    }
    const res = await writeIndex(onShelf);
    if (res.kind === "failed") summary.fonts.failed += 1;
    log(`  index     ${"index.json".padEnd(20)}  ${describe(res)}`);
  }

  // Seed marker ────────
  //
  // Only claim the new pack version when this run actually owned every file.
  // `--skip-existing` deliberately leaves earlier copies in place, so the
  // marker keeps naming the version that wrote them and the user is told how
  // to pick the new ones up.
  const keptStale =
    SKIP_EXISTING &&
    summary.templates.skipped + summary.behaviors.skipped > 0 &&
    (previous === null || previous.seedVersion < SEED_VERSION);
  if (keptStale) {
    warn(
      `--skip-existing left ${summary.templates.skipped} template(s) and ` +
        `${summary.behaviors.skipped} behavior(s) from an earlier pack in place. ` +
        `Re-run without --skip-existing to upgrade them to pack v${SEED_VERSION}.`,
    );
  } else {
    const res = await writeMarker();
    log(`  marker    ${SEED_MARKER.padEnd(20)}  ${describe(res)}`);
  }

  // Summary ────────
  const line = (name: string, c: Counter, verb = "wrote") =>
    `  ${name.padEnd(10)} ${c.wrote} ${verb} / ${c.unchanged} unchanged / ${c.skipped} skipped${c.failed ? ` / ${c.failed} failed` : ""}`;
  process.stdout.write(
    [
      "",
      `Seeded ${LIBRARY_ROOT}`,
      line("templates", summary.templates),
      line("behaviors", summary.behaviors),
      line("fonts", summary.fonts, DRY_RUN ? "to put" : "put"),
      "",
    ].join("\n"),
  );

  const anyFailed =
    summary.templates.failed + summary.behaviors.failed + summary.fonts.failed > 0;
  if (anyFailed) {
    warn("One or more entries failed. Re-run after restoring network or use --skip-fonts.");
    process.exit(1);
  }
}

function bump(counter: Counter, res: WriteResult): void {
  if (res.kind === "wrote" || res.kind === "would-write") counter.wrote += 1;
  else if (res.kind === "unchanged") counter.unchanged += 1;
  else if (res.kind === "skipped") counter.skipped += 1;
  else if (res.kind === "failed") counter.failed += 1;
}

function describe(res: WriteResult, verb = "write"): string {
  const past = verb === "write" ? "wrote" : verb;
  switch (res.kind) {
    case "wrote":
      return res.reason ? `${past} (${res.reason})` : past;
    case "unchanged":
      return "unchanged";
    case "would-write":
      return `would ${res.reason ?? verb} (dry-run)`;
    case "skipped":
      return `skipped (${res.reason})`;
    case "failed":
      return `failed (${res.reason})`;
  }
}

main().catch((err) => {
  warn(`seed-global-library: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
