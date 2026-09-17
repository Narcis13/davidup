// Text v2 layout (v1.1 S13) — pure, measured with a linear fake metric.

import { describe, expect, it } from "vitest";

import {
  isBoxText,
  layoutText,
  textFontString,
  wrapText,
} from "../../src/engine/index.js";
import type { TextItem } from "../../src/schema/types.js";

const measure = (s: string): number => Array.from(s).length * 10;

function text(overrides: Partial<TextItem> = {}, anchor: [number, number] = [0, 0]): TextItem {
  return {
    type: "text",
    text: "hello",
    font: "f",
    fontSize: 20,
    color: "#fff",
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: anchor[0],
      anchorY: anchor[1],
      opacity: 1,
    },
    ...overrides,
  };
}

describe("wrapText", () => {
  it("splits on \\n and leaves lines alone without maxWidth", () => {
    expect(wrapText("a b c\nd", undefined, measure)).toEqual(["a b c", "d"]);
  });

  it("fills lines greedily against maxWidth", () => {
    expect(wrapText("aa bb cc dd", 50, measure)).toEqual(["aa bb", "cc dd"]);
    expect(wrapText("aa bb cc dd", 49, measure)).toEqual(["aa", "bb", "cc", "dd"]);
  });

  it("gives an overlong word its own line instead of breaking it", () => {
    expect(wrapText("a verylongword b", 40, measure)).toEqual(["a", "verylongword", "b"]);
  });

  it("wraps each hard-broken paragraph separately", () => {
    expect(wrapText("aa bb\ncc dd ee", 50, measure)).toEqual(["aa bb", "cc dd", "ee"]);
  });
});

describe("layoutText", () => {
  it("point mode: baselines from the origin, advance lineHeight × fontSize", () => {
    const l = layoutText(text({ text: "one\nthree" }), measure);
    expect(l.mode).toBe("point");
    expect(l.lines.map((x) => [x.text, x.x, x.y, x.width])).toEqual([
      ["one", 0, 0, 30],
      ["three", 0, 24, 50],
    ]);
    expect(l.blockWidth).toBe(50);
    expect(l.blockHeight).toBe(48);
  });

  it("box mode: top-left origin, first baseline at 0.8 × fontSize, align inside the block", () => {
    const l = layoutText(
      text({ text: "aa bb cc", maxWidth: 60, align: "right", lineHeight: 1.5 }),
      measure,
    );
    expect(l.mode).toBe("box");
    expect(l.blockWidth).toBe(60);
    expect(l.blockHeight).toBe(60);
    expect(l.lines.map((x) => [x.text, x.x, x.y])).toEqual([
      ["aa bb", 10, 16],
      ["cc", 40, 46],
    ]);
  });

  it("box mode without maxWidth uses the widest line and centres narrower ones", () => {
    const l = layoutText(text({ text: "abcd\nab", align: "center" }, [0.5, 0.5]), measure);
    expect(l.blockWidth).toBe(40);
    expect(l.lines[1]!.x).toBe(10);
  });

  it("a non-zero anchor or maxWidth selects box mode; paint fields do not", () => {
    expect(isBoxText(text())).toBe(false);
    expect(
      isBoxText(
        text({
          strokeColor: "#000",
          strokeWidth: 2,
          shadow: { color: "#000", blur: 4 },
          letterSpacing: 3,
          fontWeight: "bold",
          lineHeight: 2,
        }),
      ),
    ).toBe(false);
    expect(isBoxText(text({}, [0, 0.5]))).toBe(true);
    expect(isBoxText(text({ maxWidth: 100 }))).toBe(true);
  });
});

describe("textFontString", () => {
  it("is the v1.0 string when weight and style are unset or normal", () => {
    expect(textFontString(text(), "Inter")).toBe('20px "Inter"');
    expect(textFontString(text({ fontWeight: "normal", fontStyle: "normal" }), "Inter")).toBe(
      '20px "Inter"',
    );
  });

  it("prefixes style then weight", () => {
    expect(textFontString(text({ fontWeight: 700, fontStyle: "italic" }), "Inter")).toBe(
      'italic 700 20px "Inter"',
    );
  });
});
