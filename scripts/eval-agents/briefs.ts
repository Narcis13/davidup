// ~10 authoring briefs for the agent eval harness (v1 plan Session 27 /
// §6 item 21 / DAVIDUP_V1_REVIEW.md §2.4 is the hand-driven prototype this
// automates). Each brief is a plain-language creative ask, phrased the way a
// client would actually write it — the harness measures whether an LLM can
// turn that into a validate-clean, render-success composition through the
// MCP surface alone, with no filesystem access of its own.
//
// Resolutions/durations are kept small and explicit (not left to the agent)
// so every render is cheap and the frame-inspection assertions have
// predictable sample points — this runs nightly against a real paid API and
// real ffmpeg, so cost and wall-clock matter as much as coverage.

import { EVAL_ASSETS } from "./assets.js";
import type { BriefFixture } from "./types.js";

export const BRIEFS: BriefFixture[] = [
  {
    id: "product-promo",
    title: "15s product promo: logo + 3 bullets + CTA",
    maxIterations: 40,
    prompt:
      "Author a 15-second, 960x540, 24fps product promo composition (background #0b1220). " +
      `Register the display font at "${EVAL_ASSETS.fonts.display}" (family "Bebas Neue") first — you'll need it for every text item. ` +
      "Open on a bold title card with the product name, animate it popping in. " +
      "Then show exactly three bullet points, one at a time, each sliding or fading in a moment after the last finishes, each staying " +
      "on screen until a closing call-to-action card fades in for the final 3 seconds reading something like \"Get started today\". " +
      "Nothing should be invisible for its whole lifespan, and no two bullets should overlap in time. " +
      "When you're done, call `validate` yourself and fix anything it flags before finishing.",
  },
  {
    id: "lower-third-loop",
    title: "Lower-third name/title loop",
    maxIterations: 35,
    prompt:
      "Author an 8-second, 854x480, 30fps broadcast lower-third. " +
      `Register the display font at "${EVAL_ASSETS.fonts.display}" (family "Bebas Neue"). ` +
      "Near the bottom-left of the frame, build a name plate: a solid or semi-transparent bar shape behind a name in large text and a role/title " +
      "underneath in smaller text. The whole lower-third should slide or pop in from off-screen, hold clearly readable for a few seconds, " +
      "then slide or fade back out well before the composition ends — don't leave it on screen for the entire duration. " +
      "Use a subtly different background color so the lower-third is easy to see against it. " +
      "Validate before you finish and fix any errors or warnings.",
  },
  {
    id: "kenburns-slideshow",
    title: "Ken Burns slideshow with music",
    maxIterations: 40,
    prompt:
      "Author a 9-second, 640x360, 24fps slideshow set to music. " +
      `Register the image at "${EVAL_ASSETS.images.ball}" as id "photo" and an audio track from "${EVAL_ASSETS.audio.tone}". ` +
      "Show that image full-frame across the whole composition with a slow Ken Burns pan/zoom (look for a ken-burns style behavior via " +
      "`list_behaviors` before building your own tweens). Add the audio as a background track for the whole clip, and layer a short title " +
      "caption over the image partway through that fades in and back out. Validate before finishing.",
  },
  {
    id: "countdown",
    title: "5-second countdown",
    maxIterations: 40,
    prompt:
      "Author a 5-second, 480x480, 24fps countdown clip on a dark background. " +
      `Register the display font at "${EVAL_ASSETS.fonts.display}" (family "Bebas Neue"). ` +
      "Show \"5\", \"4\", \"3\", \"2\", \"1\" as large centered text, one digit fully replacing the previous one every second (each digit visible " +
      "for its own one-second window and no others), each digit popping in with a little scale punch. Every digit must actually appear on " +
      "screen at some point — none should be invisible for its entire lifespan. Validate before finishing.",
  },
  {
    id: "logo-reveal",
    title: "Logo reveal sting",
    maxIterations: 35,
    prompt:
      "Author a 4-second, 720x720, 30fps logo reveal sting on a solid brand-color background of your choosing. " +
      `Register the display font at "${EVAL_ASSETS.fonts.display}" (family "Bebas Neue") and the image at "${EVAL_ASSETS.images.ball}" as id "mark". ` +
      "The mark should scale and fade in with a bit of rotation, settle into place, and a tagline in text should fade in below it a beat later " +
      "and remain until the end. Validate before finishing.",
  },
  {
    id: "two-scene-story",
    title: "Reusable scene instanced twice",
    maxIterations: 45,
    prompt:
      "Author a 10-second, 800x450, 30fps composition built from ONE reusable scene definition (use `define_scene`) that is instanced twice " +
      "(use `add_scene_instance`) with different parameters — for example a labeled stat panel showing a number and a caption. " +
      `Register the display font at "${EVAL_ASSETS.fonts.display}" (family "Bebas Neue") first. ` +
      "Place one instance in the first half of the timeline and the other in the second half, each with different text/param values and a " +
      "different position or color so they're clearly distinguishable, plus a plain background. Validate before finishing.",
  },
  {
    id: "template-title-card",
    title: "Built-in template title card",
    maxIterations: 35,
    prompt:
      "Author a 6-second, 960x540, 24fps composition that opens with the built-in `titleCard` template (check `list_templates` for its exact " +
      `params first, then \`apply_template\`) showing a headline of your choosing. Register the display font at "${EVAL_ASSETS.fonts.display}" ` +
      "(family \"Bebas Neue\") if the template needs one. After the title card's own animation finishes, add one more text item with a short " +
      "subtitle that fades in for the remainder of the clip. Validate before finishing.",
  },
  {
    id: "multi-layer-dashboard",
    title: "Multi-layer stats dashboard",
    maxIterations: 45,
    prompt:
      "Author a 7-second, 960x540, 30fps mock analytics-dashboard still-frame-style clip with at least three layers: a background layer, a " +
      "layer with two or three shape 'cards' (rounded rectangles) arranged side by side, and a foreground layer with a text label and a number " +
      "on each card. " +
      `Register the display font at "${EVAL_ASSETS.fonts.display}" (family "Bebas Neue"). ` +
      "Group each card's shape+label+number together with `add_group` and stagger the groups popping in one after another left to right. " +
      "Validate before finishing.",
  },
  {
    id: "music-intro",
    title: "Music-led intro with waveform-timed captions",
    maxIterations: 40,
    prompt:
      "Author an 8-second, 640x360, 24fps intro built around a music track. " +
      `Register an audio track from "${EVAL_ASSETS.audio.tone}" spanning the whole composition, and the display font at ` +
      `"${EVAL_ASSETS.fonts.display}" (family "Bebas Neue"). ` +
      "Show two short caption lines in sequence timed roughly to the music (e.g. one caption for the first half, a different one for the " +
      "second half), each with its own fade or pop animation, on a moody solid-color background. Validate before finishing.",
  },
  {
    id: "montage-stress",
    title: "Busy staggered montage (stress test)",
    maxIterations: 60,
    prompt:
      "Author a 10-second, 800x450, 30fps busy promotional montage with at least six shape or text items animating across at least two " +
      "layers, with staggered, overlapping-but-not-colliding tweens (position, opacity, and scale) so something is always moving — no dead air. " +
      `Register the display font at "${EVAL_ASSETS.fonts.display}" (family "Bebas Neue") for any text. ` +
      "Every item must be visible for at least part of its lifespan, and no two tweens on the same item/property may overlap in time — space " +
      "starts out by at least a few hundred milliseconds if you're unsure. Validate before finishing and fix any `E_TWEEN_OVERLAP` errors " +
      "by nudging start times.",
  },
];

if (BRIEFS.length < 10) {
  throw new Error(`Expected at least 10 briefs, found ${BRIEFS.length}.`);
}
