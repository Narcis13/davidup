// Seed the global davidup library with a curated starter pack so a freshly
// installed machine has useful templates, behavior cards, and fonts ready
// the moment a new project is created.
//
// Targets the same root the editor watches:
//   $DAVIDUP_LIBRARY   (if set)
//   ~/.davidup/library (default)
//
// Idempotent — re-running overwrites files this script owns. User-authored
// files under the library root are left alone unless they collide with an
// id this script ships (templates/behaviors are keyed by file basename).
//
// USAGE
//   bun run scripts/seed-global-library.ts
//   bun run seed:library
//   DAVIDUP_LIBRARY=/tmp/lib bun run scripts/seed-global-library.ts
//
// FLAGS
//   --skip-fonts      Don't download font files (offline mode). Templates +
//                     behavior cards still get written.
//   --skip-existing   Leave files that already exist on disk untouched.
//   --dry-run         Print what would be written without touching disk.
//   --quiet           Suppress per-file logs (final summary still prints).
//   --help            This help text.

import { promises as fs, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ──────────────── CLI ────────────────

const argv = new Set(process.argv.slice(2));
const SKIP_FONTS = argv.has("--skip-fonts");
const SKIP_EXISTING = argv.has("--skip-existing");
const DRY_RUN = argv.has("--dry-run");
const QUIET = argv.has("--quiet");

if (argv.has("--help") || argv.has("-h")) {
  process.stdout.write(`\
Seed the global davidup library at $DAVIDUP_LIBRARY (default ~/.davidup/library).

USAGE
  bun run scripts/seed-global-library.ts [flags]

FLAGS
  --skip-fonts      Skip font downloads (templates + behaviors only).
  --skip-existing   Leave already-present files untouched.
  --dry-run         Print actions without writing.
  --quiet           Final summary only.
  --help            This help text.

The library root location can be overridden via the DAVIDUP_LIBRARY env var,
which matches the editor's resolution rules (apps/editor/app/services/
global_library_root.ts).
`);
  process.exit(0);
}

// ──────────────── Paths ────────────────

const LIBRARY_ROOT =
  process.env.DAVIDUP_LIBRARY && process.env.DAVIDUP_LIBRARY.length > 0
    ? process.env.DAVIDUP_LIBRARY
    : join(homedir(), ".davidup", "library");

const SUBDIRS = ["templates", "behaviors", "scenes", "assets", "fonts"] as const;

// ──────────────── Templates ────────────────
//
// Each template is a TemplateDefinition (see src/compose/templates.ts +
// src/compose/builtInTemplates.ts for the schema in code form). Ids must
// not collide with the engine built-ins (titleCard, lowerThird, captionBurst,
// bulletList, kenburnsImage) — the project library wins on collision today
// but shadowing built-ins from the global pool would surprise users.

interface TemplateDoc {
  id: string;
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
    description:
      "Outro card with title and subtitle that fade in, hold, then fade out. Pair with an audio bed for a tidy clip ending.",
    params: [
      { name: "title", type: "string", required: true, description: "Outro headline." },
      { name: "subtitle", type: "string", default: "", description: "Tagline under the title." },
      { name: "x", type: "number", default: 640, description: "Center x." },
      { name: "y", type: "number", default: 340, description: "Title baseline y." },
      {
        name: "subtitleY",
        type: "number",
        default: 420,
        description: "Subtitle baseline y. Compute manually (no arithmetic in placeholders).",
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
    description:
      "Large pull-quote with attribution line. Quote pops in; attribution fades in shortly after.",
    params: [
      { name: "quote", type: "string", required: true, description: "Quote text (single line)." },
      { name: "attribution", type: "string", required: true, description: "Person + role." },
      { name: "x", type: "number", default: 640 },
      { name: "y", type: "number", default: 340, description: "Quote baseline y." },
      {
        name: "attributionY",
        type: "number",
        default: 460,
        description: "Attribution baseline y.",
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
    description:
      "Hero stat: oversized number / metric on top, a small label underneath. Number pops in with scale-up, label fades in.",
    params: [
      { name: "value", type: "string", required: true, description: 'The number — pass a string like "99%" or "12K".' },
      { name: "label", type: "string", required: true, description: "Caption under the stat." },
      { name: "x", type: "number", default: 640 },
      { name: "y", type: "number", default: 360, description: "Number baseline y." },
      {
        name: "labelY",
        type: "number",
        default: 470,
        description: "Label baseline y.",
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
    description:
      "Horizontal accent line that sweeps in from the left with an optional centered label that fades in above.",
    params: [
      { name: "label", type: "string", default: "", description: 'Centered text above the rule. Pass "" to hide.' },
      { name: "x", type: "number", default: 200, description: "Left edge x of the rule." },
      { name: "y", type: "number", default: 540, description: "Rule y position." },
      { name: "labelY", type: "number", default: 490, description: "Label baseline y." },
      { name: "width", type: "number", default: 880, description: "Final width of the rule." },
      { name: "height", type: "number", default: 4 },
      { name: "color", type: "color", default: "#ffd166" },
      { name: "labelColor", type: "color", default: "#ffffff" },
      { name: "labelX", type: "number", default: 640, description: "Label anchor x (center recommended)." },
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
      { name: "textY", type: "number", default: 700, description: "Caption baseline y." },
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
          anchorX: 0,
          anchorY: 0,
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
// User-authored behaviors are descriptor-only in v1.0 (see
// src/compose/behaviors.ts §6 audit) — the catalog gets metadata, but the
// engine's built-in expand() is preserved when a name is re-registered.
// Writing these files makes the eleven engine built-ins draggable from the
// Library panel without changing their runtime semantics.

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
];

// ──────────────── Fonts ────────────────
//
// Files are downloaded from the @fontsource jsdelivr mirror. They land under
// <library>/fonts/<file>.woff2 and are registered in index.json with
// `global:fonts/<file>.woff2` URLs — the browser asset loader rewrites that
// prefix to /library-files/... at runtime (see src/assets/browser.ts).

interface FontSpec {
  id: string;
  family: string;
  file: string;
  url: string;
  description: string;
}

const FONTS: FontSpec[] = [
  {
    id: "inter-bold",
    family: "Inter",
    file: "inter-700.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff2",
    description: "Inter Bold — modern UI sans-serif, great default headline.",
  },
  {
    id: "inter-regular",
    family: "Inter Regular",
    file: "inter-400.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff2",
    description: "Inter Regular — body copy and small caption text.",
  },
  {
    id: "bebas-neue",
    family: "Bebas Neue",
    file: "bebas-neue-400.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2",
    description: "Bebas Neue — narrow display caps, classic lower-third stalwart.",
  },
  {
    id: "anton",
    family: "Anton",
    file: "anton-400.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/anton/files/anton-latin-400-normal.woff2",
    description: "Anton — heavy single-weight impact for hero titles.",
  },
  {
    id: "playfair-display-bold",
    family: "Playfair Display",
    file: "playfair-display-700.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2",
    description: "Playfair Display Bold — high-contrast serif for editorial quotes.",
  },
  {
    id: "montserrat-bold",
    family: "Montserrat",
    file: "montserrat-700.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/montserrat/files/montserrat-latin-700-normal.woff2",
    description: "Montserrat Bold — geometric sans for posters and stat callouts.",
  },
  {
    id: "space-grotesk",
    family: "Space Grotesk",
    file: "space-grotesk-500.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2",
    description: "Space Grotesk Medium — quirky-but-clean modern sans.",
  },
  {
    id: "jetbrains-mono",
    family: "JetBrains Mono",
    file: "jetbrains-mono-500.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2",
    description: "JetBrains Mono Medium — code overlays and technical captions.",
  },
  {
    id: "caveat-bold",
    family: "Caveat",
    file: "caveat-700.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/caveat/files/caveat-latin-700-normal.woff2",
    description: "Caveat Bold — handwritten accent for annotations and arrows.",
  },
  {
    id: "dm-sans",
    family: "DM Sans",
    file: "dm-sans-500.woff2",
    url: "https://cdn.jsdelivr.net/npm/@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2",
    description: "DM Sans Medium — friendly geometric sans for product UI.",
  },
];

// ──────────────── Plumbing ────────────────

interface WriteResult {
  kind: "wrote" | "skipped" | "would-write" | "failed";
  reason?: string;
}

const summary = {
  templates: { wrote: 0, skipped: 0, failed: 0 },
  behaviors: { wrote: 0, skipped: 0, failed: 0 },
  fonts: { wrote: 0, skipped: 0, failed: 0 },
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

async function writeJson(absPath: string, value: unknown): Promise<WriteResult> {
  if (SKIP_EXISTING && existsSync(absPath)) {
    return { kind: "skipped", reason: "exists" };
  }
  if (DRY_RUN) return { kind: "would-write" };
  await fs.mkdir(dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { kind: "wrote" };
}

async function downloadFont(spec: FontSpec): Promise<WriteResult> {
  const dest = join(LIBRARY_ROOT, "fonts", spec.file);
  if (SKIP_EXISTING && existsSync(dest)) {
    return { kind: "skipped", reason: "exists" };
  }
  if (DRY_RUN) {
    return { kind: "would-write" };
  }
  try {
    const res = await fetch(spec.url);
    if (!res.ok) {
      return { kind: "failed", reason: `HTTP ${res.status}` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    await fs.mkdir(dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    return { kind: "wrote" };
  } catch (err) {
    return { kind: "failed", reason: (err as Error).message };
  }
}

// ──────────────── Main ────────────────

async function main(): Promise<void> {
  log(`davidup library seed → ${LIBRARY_ROOT}`);
  if (DRY_RUN) log("(dry-run: no files will change)");

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
  const fontEntries: Array<Record<string, unknown>> = [];
  if (SKIP_FONTS) {
    log("(skipping font downloads — --skip-fonts)");
  } else {
    for (const f of FONTS) {
      const res = await downloadFont(f);
      bump(summary.fonts, res);
      log(`  font      ${f.id.padEnd(28)}  ${describe(res)}`);
      // Even if the download failed or was skipped, register the entry in
      // index.json — the file may already exist on disk from a prior run.
      // Skip only when the destination genuinely doesn't exist (a fresh
      // failure with no fallback file).
      const dest = join(LIBRARY_ROOT, "fonts", f.file);
      if (!existsSync(dest) && !DRY_RUN) continue;
      fontEntries.push({
        id: f.id,
        type: "font",
        family: f.family,
        src: `global:fonts/${f.file}`,
        description: f.description,
      });
    }
  }

  // index.json with the font catalog. Templates and behaviors are written
  // as one-file-per-definition (see above), so they're discovered by the
  // library watcher without needing an inline reference here.
  const indexPath = join(LIBRARY_ROOT, "index.json");
  const indexValue = {
    $generatedBy: "scripts/seed-global-library.ts",
    $note:
      "Fonts are registered here so they're discoverable in the Library panel and via list_fonts. Edit by re-running the seed script — overwrites are intentional.",
    assets: [] as unknown[],
    fonts: fontEntries,
  };
  if (fontEntries.length > 0 || !existsSync(indexPath)) {
    const res = await writeJson(indexPath, indexValue);
    log(`  index     ${"index.json".padEnd(20)}  ${describe(res)}`);
  } else {
    log("  index     index.json            skipped (no fonts to register)");
  }

  // Summary ────────
  process.stdout.write(
    [
      "",
      `Seeded ${LIBRARY_ROOT}`,
      `  templates  ${summary.templates.wrote} wrote / ${summary.templates.skipped} skipped${
        summary.templates.failed ? ` / ${summary.templates.failed} failed` : ""
      }`,
      `  behaviors  ${summary.behaviors.wrote} wrote / ${summary.behaviors.skipped} skipped${
        summary.behaviors.failed ? ` / ${summary.behaviors.failed} failed` : ""
      }`,
      `  fonts      ${summary.fonts.wrote} wrote / ${summary.fonts.skipped} skipped${
        summary.fonts.failed ? ` / ${summary.fonts.failed} failed` : ""
      }`,
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

function bump(
  counter: { wrote: number; skipped: number; failed: number },
  res: WriteResult,
): void {
  if (res.kind === "wrote" || res.kind === "would-write") counter.wrote += 1;
  else if (res.kind === "skipped") counter.skipped += 1;
  else if (res.kind === "failed") counter.failed += 1;
}

function describe(res: WriteResult): string {
  switch (res.kind) {
    case "wrote":
      return "wrote";
    case "would-write":
      return "would write (dry-run)";
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
