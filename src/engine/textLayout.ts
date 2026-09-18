// Text layout (v1.1 S13, TEXT_V2_DESIGN.md §4). One pure function shared by
// the renderer, the browser driver's pick buffer, and its selection ring, so
// all three agree on where every line sits.
//
// Two placement modes:
//
//   point — no `maxWidth` and anchor (0, 0). The first line's alphabetic
//           baseline sits on the item origin and each line is aligned around
//           x per `align` (via `ctx.textAlign`). Further lines (explicit `\n`)
//           advance by `lineHeight × fontSize`. A single line here is the
//           v1.0 draw path, pixel for pixel.
//   box   — `maxWidth` set, or a non-zero anchor. The origin is the top-left
//           of the text block; the first baseline sits `0.8 × fontSize` below
//           it (a fixed ratio, not measured ascent, so vertical layout never
//           depends on font metrics). Lines are aligned inside the block by
//           explicit x offsets. The anchor box is (blockWidth, blockHeight),
//           so `anchorX/Y: 0.5` centres the block on (x, y).
//
// Why a non-zero anchor switches modes: before v1.1 text had a 0×0 anchor
// box, so anchors did nothing. Keeping anchor (0, 0) on the point path keeps
// every composition that never touched anchors rendering as before; anything
// that set an anchor now gets the pivot it asked for. Tweening an anchor away
// from exactly (0, 0) jumps between the two modes on that frame.
//
// Paint-only fields (stroke, shadow, weight, style, letterSpacing) never
// change the mode, so styling a title does not move it.

import type { TextItem } from "../schema/types.js";

/**
 * Text layout semantics version. Bumped when layout changes where existing
 * text lands on screen. See CHANGELOG.md.
 *
 *   v1 → v2: anchors act on text (box mode, measured extents); `\n`,
 *   `maxWidth` word-wrap, `lineHeight`, stroke, shadow, weight/style,
 *   letterSpacing.
 */
export const TEXT_LAYOUT_VERSION = 2;

/** Default line advance, as a multiple of fontSize. */
export const DEFAULT_LINE_HEIGHT = 1.2;

/** First-baseline offset from the block top in box mode, × fontSize. */
export const TEXT_ASCENT_RATIO = 0.8;

export interface TextLine {
  text: string;
  /** x of the line's left edge (box mode) or of `textAlign`'s anchor point (point mode). */
  x: number;
  /** Alphabetic baseline y. */
  y: number;
  /** Measured width of the line. */
  width: number;
}

export interface TextLayout {
  mode: "point" | "box";
  lines: TextLine[];
  /** `maxWidth` when set, else the widest line. */
  blockWidth: number;
  /** lineCount × lineHeight × fontSize. */
  blockHeight: number;
}

/** Measures a string's advance width with the item's font already applied. */
export type MeasureText = (text: string) => number;

export function isBoxText(item: TextItem): boolean {
  return (
    item.maxWidth !== undefined ||
    item.transform.anchorX !== 0 ||
    item.transform.anchorY !== 0
  );
}

/**
 * CSS font shorthand for the item. Without weight/style this is the exact
 * v1.0 string, so hosts resolve the same face.
 */
export function textFontString(item: TextItem, family: string): string {
  const parts: string[] = [];
  if (item.fontStyle !== undefined && item.fontStyle !== "normal") {
    parts.push(item.fontStyle);
  }
  if (item.fontWeight !== undefined && item.fontWeight !== "normal" && item.fontWeight !== 400) {
    parts.push(String(item.fontWeight));
  }
  parts.push(`${item.fontSize}px "${family}"`);
  return parts.join(" ");
}

/**
 * Split `text` into lines: hard breaks on `\n`, then greedy word-wrap against
 * `maxWidth` when given. A candidate line is measured whole so kerning across
 * spaces counts. A word wider than `maxWidth` gets a line to itself and
 * overflows; it is never broken or clipped.
 */
export function wrapText(
  text: string,
  maxWidth: number | undefined,
  measure: MeasureText,
): string[] {
  const paragraphs = text.split("\n");
  if (maxWidth === undefined) return paragraphs;
  const out: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(" ");
    let line = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const candidate = `${line} ${words[i]}`;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
      } else {
        out.push(line);
        line = words[i]!;
      }
    }
    out.push(line);
  }
  return out;
}

export function layoutText(item: TextItem, measure: MeasureText): TextLayout {
  const fontSize = item.fontSize;
  const advance = (item.lineHeight ?? DEFAULT_LINE_HEIGHT) * fontSize;
  const texts = wrapText(item.text, item.maxWidth, measure);
  const widths = texts.map((t) => measure(t));
  let widest = 0;
  for (const w of widths) if (w > widest) widest = w;
  const blockHeight = texts.length * advance;
  const align = item.align ?? "left";

  if (!isBoxText(item)) {
    return {
      mode: "point",
      lines: texts.map((t, i) => ({ text: t, x: 0, y: i * advance, width: widths[i]! })),
      blockWidth: widest,
      blockHeight,
    };
  }

  const blockWidth = item.maxWidth ?? widest;
  const top = TEXT_ASCENT_RATIO * fontSize;
  return {
    mode: "box",
    lines: texts.map((t, i) => {
      const w = widths[i]!;
      const x =
        align === "center" ? (blockWidth - w) / 2 : align === "right" ? blockWidth - w : 0;
      return { text: t, x, y: top + i * advance, width: w };
    }),
    blockWidth,
    blockHeight,
  };
}
