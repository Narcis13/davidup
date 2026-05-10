// Built-in templates shipped with the engine — primitive P3 from
// COMPOSITION_PRIMITIVES.md §7. Importing this module registers them
// with the global template registry. The set is intentionally small (the
// roadmap calls for "3-5 built-in templates"): each one covers a
// recurring authoring pattern that an LLM agent or human would otherwise
// spell out as half a dozen items + tweens.
//
// Param substitution is whole-string only in v0.3 (§7.4) — no arithmetic
// in placeholders. That constraint shapes the API: where the spec example
// in §7.3 used `${params.y + 80}`, we expose explicit absolute params
// (`barY`, `roleY`) so the author can compute offsets themselves.
//
// Each template emits items pre-positioned at their resting state with
// `opacity: 0` where an entry tween will fade them in. The §6/§5 resolver
// rules mean the tween's `from` overrides the item's transform during
// playback, so the initial values document authorial intent rather than
// dictating runtime behavior.
//
// Tween starts are template-local (§7.6); behaviors emitted from
// templates are expanded in the next pipeline pass (§10).
//
// Built-in id collisions: a per-composition `templates` block can shadow
// any of these by id (`expandTemplate` checks user templates first, §7.8).

import { registerTemplate, type TemplateDefinition } from "./templates.js";

// ──────────────── titleCard ────────────────

const titleCard: TemplateDefinition = {
  id: "titleCard",
  description:
    "Centered title with optional subtitle. Title pops in; subtitle fades in shortly after.",
  params: [
    { name: "title", type: "string", required: true, description: "Headline text." },
    {
      name: "subtitle",
      type: "string",
      default: "",
      description: "Supporting line under the title. Pass an empty string to hide.",
    },
    { name: "x", type: "number", default: 640, description: "Title anchor x." },
    { name: "y", type: "number", default: 320, description: "Title baseline y." },
    {
      name: "subtitleY",
      type: "number",
      default: 400,
      description:
        "Subtitle baseline y. Compute manually — placeholders don't do arithmetic in v0.3.",
    },
    {
      name: "fontDisplay",
      type: "string",
      required: true,
      description: "Asset id for the headline font.",
    },
    {
      name: "fontMono",
      type: "string",
      required: true,
      description: "Asset id for the subtitle font.",
    },
    { name: "titleSize", type: "number", default: 96, description: "Title fontSize." },
    {
      name: "subtitleSize",
      type: "number",
      default: 32,
      description: "Subtitle fontSize.",
    },
    { name: "color", type: "color", default: "#ffffff", description: "Title color." },
    {
      name: "accentColor",
      type: "color",
      default: "#ffd166",
      description: "Subtitle color.",
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
    { $behavior: "popIn", target: "title", start: 0, duration: 0.6, easing: "easeOutBack" },
    {
      $behavior: "fadeIn",
      target: "subtitle",
      start: 0.4,
      duration: 0.4,
      easing: "easeOutQuad",
    },
  ],
};

// ──────────────── lowerThird ────────────────

const lowerThird: TemplateDefinition = {
  id: "lowerThird",
  description:
    "Broadcast-style lower-third: name + role with a sweeping accent bar. Entry only — author controls exit.",
  params: [
    { name: "name", type: "string", required: true, description: "Display name." },
    { name: "role", type: "string", required: true, description: "Role / title line." },
    { name: "x", type: "number", default: 120, description: "Left edge x for all three items." },
    { name: "y", type: "number", default: 900, description: "Name baseline y." },
    {
      name: "roleY",
      type: "number",
      default: 938,
      description: "Role baseline y. Typically y + 38.",
    },
    {
      name: "barY",
      type: "number",
      default: 980,
      description: "Bar y. Typically y + 80.",
    },
    {
      name: "barWidth",
      type: "number",
      default: 360,
      description: "Final width of the sweep bar.",
    },
    {
      name: "nameSize",
      type: "number",
      default: 64,
      description: "Name fontSize.",
    },
    {
      name: "roleSize",
      type: "number",
      default: 24,
      description: "Role fontSize.",
    },
    {
      name: "color",
      type: "color",
      default: "#ffd166",
      description: "Bar fill + role color.",
    },
    {
      name: "fontDisplay",
      type: "string",
      required: true,
      description: "Asset id for the name font.",
    },
    {
      name: "fontMono",
      type: "string",
      required: true,
      description: "Asset id for the role font.",
    },
  ],
  items: {
    bar: {
      type: "shape",
      kind: "rect",
      width: 0,
      height: 6,
      fillColor: "${params.color}",
      transform: {
        x: "${params.x}",
        y: "${params.barY}",
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 1,
      },
    },
    name: {
      type: "text",
      text: "${params.name}",
      font: "${params.fontDisplay}",
      fontSize: "${params.nameSize}",
      color: "#ffffff",
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
    role: {
      type: "text",
      text: "${params.role}",
      font: "${params.fontMono}",
      fontSize: "${params.roleSize}",
      color: "${params.color}",
      transform: {
        x: "${params.x}",
        y: "${params.roleY}",
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
    { $behavior: "fadeIn", target: "name", start: 0.0, duration: 0.4, easing: "easeOutQuad" },
    { $behavior: "fadeIn", target: "role", start: 0.2, duration: 0.4, easing: "easeOutQuad" },
    {
      target: "bar",
      property: "width",
      from: 0,
      to: "${params.barWidth}",
      start: 0.0,
      duration: 0.6,
      easing: "easeOutBack",
    },
  ],
};

// ──────────────── captionBurst ────────────────

const captionBurst: TemplateDefinition = {
  id: "captionBurst",
  description:
    "Single caption that pops in scaled from a small size — good for short emphatic phrases.",
  params: [
    { name: "text", type: "string", required: true, description: "Caption text." },
    { name: "x", type: "number", default: 640, description: "Caption anchor x." },
    { name: "y", type: "number", default: 600, description: "Caption baseline y." },
    {
      name: "font",
      type: "string",
      required: true,
      description: "Asset id for the caption font.",
    },
    { name: "fontSize", type: "number", default: 64, description: "Caption fontSize." },
    {
      name: "color",
      type: "color",
      default: "#ffffff",
      description: "Caption color.",
    },
    {
      name: "fromScale",
      type: "number",
      default: 0.2,
      description: "Initial scale for the burst.",
    },
    {
      name: "duration",
      type: "number",
      default: 0.5,
      description: "Burst-in duration in seconds.",
    },
  ],
  items: {
    caption: {
      type: "text",
      text: "${params.text}",
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
      target: "caption",
      start: 0,
      duration: "${params.duration}",
      easing: "easeOutBack",
      params: {
        fromScale: "${params.fromScale}",
        toScale: 1,
        fromOpacity: 0,
        toOpacity: 1,
      },
    },
  ],
};

// ──────────────── bulletList ────────────────

const bulletList: TemplateDefinition = {
  id: "bulletList",
  description:
    "Three bullets revealed with a staggered fade-in. Fixed at three to keep param substitution literal in v0.3.",
  params: [
    { name: "bullet1", type: "string", required: true },
    { name: "bullet2", type: "string", required: true },
    { name: "bullet3", type: "string", required: true },
    { name: "x", type: "number", default: 200, description: "Left edge x for all bullets." },
    { name: "y1", type: "number", default: 400 },
    { name: "y2", type: "number", default: 460 },
    { name: "y3", type: "number", default: 520 },
    {
      name: "font",
      type: "string",
      required: true,
      description: "Asset id for the bullet font.",
    },
    { name: "fontSize", type: "number", default: 36, description: "Bullet fontSize." },
    {
      name: "color",
      type: "color",
      default: "#ffffff",
      description: "Bullet text color.",
    },
    {
      name: "stagger",
      type: "number",
      default: 0.15,
      description:
        "Seconds between successive bullet reveals. Bullet N starts at (N-1)*stagger.",
    },
    {
      name: "stagger2",
      type: "number",
      default: 0.3,
      description:
        "Start time for the third bullet. Compute as 2*stagger — placeholders don't do arithmetic in v0.3.",
    },
  ],
  items: {
    b1: {
      type: "text",
      text: "${params.bullet1}",
      font: "${params.font}",
      fontSize: "${params.fontSize}",
      color: "${params.color}",
      align: "left",
      transform: {
        x: "${params.x}",
        y: "${params.y1}",
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 0,
      },
    },
    b2: {
      type: "text",
      text: "${params.bullet2}",
      font: "${params.font}",
      fontSize: "${params.fontSize}",
      color: "${params.color}",
      align: "left",
      transform: {
        x: "${params.x}",
        y: "${params.y2}",
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 0,
      },
    },
    b3: {
      type: "text",
      text: "${params.bullet3}",
      font: "${params.font}",
      fontSize: "${params.fontSize}",
      color: "${params.color}",
      align: "left",
      transform: {
        x: "${params.x}",
        y: "${params.y3}",
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
    { $behavior: "fadeIn", target: "b1", start: 0, duration: 0.4, easing: "easeOutQuad" },
    {
      $behavior: "fadeIn",
      target: "b2",
      start: "${params.stagger}",
      duration: 0.4,
      easing: "easeOutQuad",
    },
    {
      $behavior: "fadeIn",
      target: "b3",
      start: "${params.stagger2}",
      duration: 0.4,
      easing: "easeOutQuad",
    },
  ],
};

// ──────────────── kenburnsImage ────────────────

const kenburnsImage: TemplateDefinition = {
  id: "kenburnsImage",
  description:
    "Image sprite with a Ken-Burns slow zoom-and-pan plus an entry fade-in.",
  params: [
    {
      name: "asset",
      type: "string",
      required: true,
      description: "Image asset id (must be registered on the composition).",
    },
    {
      name: "width",
      type: "number",
      required: true,
      description: "Sprite width in pixels (pre-scale).",
    },
    {
      name: "height",
      type: "number",
      required: true,
      description: "Sprite height in pixels (pre-scale).",
    },
    {
      name: "x",
      type: "number",
      default: 0,
      description:
        "Sprite anchor x. Also used as the kenburns pan's starting position.",
    },
    { name: "y", type: "number", default: 0, description: "Sprite anchor y." },
    {
      name: "fromScale",
      type: "number",
      default: 1.0,
      description: "Scale at the start of the kenburns move.",
    },
    {
      name: "toScale",
      type: "number",
      default: 1.2,
      description: "Scale at the end of the kenburns move.",
    },
    {
      name: "pan",
      type: "number",
      default: 100,
      description: "Pixels to drift along the pan axis over the duration.",
    },
    {
      name: "axis",
      type: "string",
      default: "x",
      description: '"x" or "y" — which transform axis to pan.',
    },
    {
      name: "fadeDuration",
      type: "number",
      default: 0.6,
      description: "Entry fade-in duration in seconds.",
    },
    {
      name: "duration",
      type: "number",
      default: 6,
      description: "Total kenburns duration in seconds.",
    },
  ],
  items: {
    img: {
      type: "sprite",
      asset: "${params.asset}",
      width: "${params.width}",
      height: "${params.height}",
      transform: {
        x: "${params.x}",
        y: "${params.y}",
        scaleX: "${params.fromScale}",
        scaleY: "${params.fromScale}",
        rotation: 0,
        anchorX: 0,
        anchorY: 0,
        opacity: 0,
      },
    },
  },
  tweens: [
    {
      $behavior: "fadeIn",
      target: "img",
      start: 0,
      duration: "${params.fadeDuration}",
      easing: "easeOutQuad",
    },
    {
      $behavior: "kenburns",
      target: "img",
      start: 0,
      duration: "${params.duration}",
      easing: "easeInOutSine",
      params: {
        fromScale: "${params.fromScale}",
        toScale: "${params.toScale}",
        pan: "${params.pan}",
        axis: "${params.axis}",
        fromPosition: "${params.x}",
      },
    },
  ],
};

// ──────────────── Registration ────────────────

/**
 * Names of templates this module registers. Exposed for tests and for the
 * future `list_templates` MCP tool, which can surface the built-ins as a
 * distinct group.
 */
export const BUILT_IN_TEMPLATE_IDS = [
  "titleCard",
  "lowerThird",
  "captionBurst",
  "bulletList",
  "kenburnsImage",
] as const;

for (const def of [titleCard, lowerThird, captionBurst, bulletList, kenburnsImage]) {
  registerTemplate(def);
}
