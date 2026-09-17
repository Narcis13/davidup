// Fake Canvas2DContext that records draw calls and implements save/restore
// faithfully enough that tests can read effective state at any draw call.
// Full pixel correctness is Phase 6 territory (skia golden tests).

import type { Canvas2DContext, CanvasMatrix } from "../../src/engine/types.js";

export type Call =
  | { op: "save" }
  | { op: "restore" }
  | { op: "translate"; x: number; y: number }
  | { op: "rotate"; angle: number }
  | { op: "scale"; x: number; y: number }
  | {
      op: "setTransform";
      a: number;
      b: number;
      c: number;
      d: number;
      e: number;
      f: number;
    }
  | {
      op: "fillRect" | "strokeRect" | "clearRect";
      x: number;
      y: number;
      w: number;
      h: number;
      alpha: number;
      composite: string;
      fillStyle: string;
      strokeStyle: string;
    }
  | { op: "beginPath" }
  | { op: "closePath" }
  | { op: "moveTo"; x: number; y: number }
  | { op: "lineTo"; x: number; y: number }
  | {
      op: "arc";
      x: number;
      y: number;
      r: number;
      sa: number;
      ea: number;
      anti: boolean;
    }
  | { op: "rect"; x: number; y: number; w: number; h: number }
  | { op: "fill"; fillStyle: string; alpha: number; composite: string }
  | {
      op: "stroke";
      strokeStyle: string;
      lineWidth: number;
      alpha: number;
      composite: string;
    }
  | {
      op: "fillText";
      text: string;
      x: number;
      y: number;
      font: string;
      fillStyle: string;
      textAlign: string;
      textBaseline: string;
      letterSpacing: string;
      shadowColor: string;
      shadowBlur: number;
      shadowOffsetX: number;
      shadowOffsetY: number;
      alpha: number;
    }
  | {
      op: "strokeText";
      text: string;
      x: number;
      y: number;
      font: string;
      strokeStyle: string;
      lineWidth: number;
      lineJoin: string;
      shadowColor: string;
      alpha: number;
    }
  | {
      op: "drawImage";
      image: unknown;
      // Source-rect crop, present only for the 9-arg form (video `fit`).
      sx?: number;
      sy?: number;
      sw?: number;
      sh?: number;
      dx: number;
      dy: number;
      dw: number;
      dh: number;
      alpha: number;
      composite: string;
    };

// The affine CTM, tracked for real (v1.1 S18) so `getTransform` hands back
// the matrix the renderer actually built. Isolated groups copy it onto their
// scratch surface verbatim; a fake that only records translate/rotate/scale
// calls could not answer that.
const IDENTITY: CanvasMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// `m` applied after `outer` — i.e. outer · m, the order Canvas2D composes a
// new transform onto the existing CTM.
function multiply(outer: CanvasMatrix, m: CanvasMatrix): CanvasMatrix {
  return {
    a: outer.a * m.a + outer.c * m.b,
    b: outer.b * m.a + outer.d * m.b,
    c: outer.a * m.c + outer.c * m.d,
    d: outer.b * m.c + outer.d * m.d,
    e: outer.a * m.e + outer.c * m.f + outer.e,
    f: outer.b * m.e + outer.d * m.f + outer.f,
  };
}

interface State {
  transform: CanvasMatrix;
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  letterSpacing: string;
  lineJoin: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

const INITIAL_STATE: State = {
  transform: IDENTITY,
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  letterSpacing: "0px",
  lineJoin: "miter",
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
};

/** Width per code point used by FakeContext.measureText. */
export const FAKE_GLYPH_WIDTH = 10;

export class FakeContext implements Canvas2DContext {
  calls: Call[] = [];
  private state: State = { ...INITIAL_STATE };
  private stack: State[] = [];

  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(v: number) {
    this.state.globalAlpha = v;
  }
  get globalCompositeOperation(): string {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(v: string) {
    this.state.globalCompositeOperation = v;
  }
  get fillStyle(): string {
    return this.state.fillStyle;
  }
  set fillStyle(v: string) {
    this.state.fillStyle = v;
  }
  get strokeStyle(): string {
    return this.state.strokeStyle;
  }
  set strokeStyle(v: string) {
    this.state.strokeStyle = v;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(v: number) {
    this.state.lineWidth = v;
  }
  get font(): string {
    return this.state.font;
  }
  set font(v: string) {
    this.state.font = v;
  }
  get textAlign(): string {
    return this.state.textAlign;
  }
  set textAlign(v: string) {
    this.state.textAlign = v;
  }
  get textBaseline(): string {
    return this.state.textBaseline;
  }
  set textBaseline(v: string) {
    this.state.textBaseline = v;
  }

  get letterSpacing(): string {
    return this.state.letterSpacing;
  }
  set letterSpacing(v: string) {
    this.state.letterSpacing = v;
  }
  get lineJoin(): string {
    return this.state.lineJoin;
  }
  set lineJoin(v: string) {
    this.state.lineJoin = v;
  }
  get shadowColor(): string {
    return this.state.shadowColor;
  }
  set shadowColor(v: string) {
    this.state.shadowColor = v;
  }
  get shadowBlur(): number {
    return this.state.shadowBlur;
  }
  set shadowBlur(v: number) {
    this.state.shadowBlur = v;
  }
  get shadowOffsetX(): number {
    return this.state.shadowOffsetX;
  }
  set shadowOffsetX(v: number) {
    this.state.shadowOffsetX = v;
  }
  get shadowOffsetY(): number {
    return this.state.shadowOffsetY;
  }
  set shadowOffsetY(v: number) {
    this.state.shadowOffsetY = v;
  }

  // Deterministic linear metrics: every code point is FAKE_GLYPH_WIDTH wide.
  measureText(text: string): { width: number } {
    return { width: Array.from(text).length * FAKE_GLYPH_WIDTH };
  }

  save(): void {
    this.stack.push({ ...this.state });
    this.calls.push({ op: "save" });
  }
  restore(): void {
    const popped = this.stack.pop();
    if (popped) this.state = popped;
    this.calls.push({ op: "restore" });
  }
  translate(x: number, y: number): void {
    this.state.transform = multiply(this.state.transform, {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: x,
      f: y,
    });
    this.calls.push({ op: "translate", x, y });
  }
  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.state.transform = multiply(this.state.transform, {
      a: cos,
      b: sin,
      c: -sin,
      d: cos,
      e: 0,
      f: 0,
    });
    this.calls.push({ op: "rotate", angle });
  }
  scale(x: number, y: number): void {
    this.state.transform = multiply(this.state.transform, {
      a: x,
      b: 0,
      c: 0,
      d: y,
      e: 0,
      f: 0,
    });
    this.calls.push({ op: "scale", x, y });
  }
  getTransform(): CanvasMatrix {
    return { ...this.state.transform };
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.transform = { a, b, c, d, e, f };
    this.calls.push({ op: "setTransform", a, b, c, d, e, f });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({
      op: "fillRect",
      x,
      y,
      w,
      h,
      alpha: this.state.globalAlpha,
      composite: this.state.globalCompositeOperation,
      fillStyle: this.state.fillStyle,
      strokeStyle: this.state.strokeStyle,
    });
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({
      op: "strokeRect",
      x,
      y,
      w,
      h,
      alpha: this.state.globalAlpha,
      composite: this.state.globalCompositeOperation,
      fillStyle: this.state.fillStyle,
      strokeStyle: this.state.strokeStyle,
    });
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({
      op: "clearRect",
      x,
      y,
      w,
      h,
      alpha: this.state.globalAlpha,
      composite: this.state.globalCompositeOperation,
      fillStyle: this.state.fillStyle,
      strokeStyle: this.state.strokeStyle,
    });
  }
  beginPath(): void {
    this.calls.push({ op: "beginPath" });
  }
  closePath(): void {
    this.calls.push({ op: "closePath" });
  }
  moveTo(x: number, y: number): void {
    this.calls.push({ op: "moveTo", x, y });
  }
  lineTo(x: number, y: number): void {
    this.calls.push({ op: "lineTo", x, y });
  }
  arc(
    x: number,
    y: number,
    r: number,
    sa: number,
    ea: number,
    anti?: boolean,
  ): void {
    this.calls.push({ op: "arc", x, y, r, sa, ea, anti: !!anti });
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ op: "rect", x, y, w, h });
  }
  fill(): void {
    this.calls.push({
      op: "fill",
      fillStyle: this.state.fillStyle,
      alpha: this.state.globalAlpha,
      composite: this.state.globalCompositeOperation,
    });
  }
  stroke(): void {
    this.calls.push({
      op: "stroke",
      strokeStyle: this.state.strokeStyle,
      lineWidth: this.state.lineWidth,
      alpha: this.state.globalAlpha,
      composite: this.state.globalCompositeOperation,
    });
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push({
      op: "fillText",
      text,
      x,
      y,
      font: this.state.font,
      fillStyle: this.state.fillStyle,
      textAlign: this.state.textAlign,
      textBaseline: this.state.textBaseline,
      letterSpacing: this.state.letterSpacing,
      shadowColor: this.state.shadowColor,
      shadowBlur: this.state.shadowBlur,
      shadowOffsetX: this.state.shadowOffsetX,
      shadowOffsetY: this.state.shadowOffsetY,
      alpha: this.state.globalAlpha,
    });
  }
  strokeText(text: string, x: number, y: number): void {
    this.calls.push({
      op: "strokeText",
      text,
      x,
      y,
      font: this.state.font,
      strokeStyle: this.state.strokeStyle,
      lineWidth: this.state.lineWidth,
      lineJoin: this.state.lineJoin,
      shadowColor: this.state.shadowColor,
      alpha: this.state.globalAlpha,
    });
  }
  drawImage(
    image: unknown,
    a: number,
    b: number,
    c: number,
    d: number,
    e?: number,
    f?: number,
    g?: number,
    h?: number,
  ): void {
    if (e === undefined || f === undefined || g === undefined || h === undefined) {
      // 5-arg: a..d = dx, dy, dw, dh.
      this.calls.push({
        op: "drawImage",
        image,
        dx: a,
        dy: b,
        dw: c,
        dh: d,
        alpha: this.state.globalAlpha,
        composite: this.state.globalCompositeOperation,
      });
    } else {
      // 9-arg: a..d = source crop, e..h = destination rect.
      this.calls.push({
        op: "drawImage",
        image,
        sx: a,
        sy: b,
        sw: c,
        sh: d,
        dx: e,
        dy: f,
        dw: g,
        dh: h,
        alpha: this.state.globalAlpha,
        composite: this.state.globalCompositeOperation,
      });
    }
  }
}

export function ops(ctx: FakeContext): string[] {
  return ctx.calls.map((c) => c.op);
}
