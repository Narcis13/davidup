// Color parsing, formatting, and linear-RGB lerp.
// Per design-doc Q2 (open question): RGB-simple lerp for v0.1, not OKLab.
// Internal representation: r/g/b on [0, 255], a on [0, 1] — matches CSS rgba().

export type RGBA = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export function parseColor(input: string): RGBA {
  const s = input.trim();
  if (s.startsWith("#")) return parseHex(s);
  if (s.startsWith("rgba(") || s.startsWith("rgb(")) return parseRgbFunction(s);
  throw new Error(`Unrecognized color: "${input}"`);
}

function parseHex(s: string): RGBA {
  const hex = s.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid hex color: "${s}"`);
  }
  if (hex.length === 3) {
    return {
      r: dup(hex[0]!),
      g: dup(hex[1]!),
      b: dup(hex[2]!),
      a: 1,
    };
  }
  if (hex.length === 4) {
    return {
      r: dup(hex[0]!),
      g: dup(hex[1]!),
      b: dup(hex[2]!),
      a: dup(hex[3]!) / 255,
    };
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }
  throw new Error(`Invalid hex color: "${s}"`);
}

function dup(ch: string): number {
  return parseInt(ch + ch, 16);
}

function parseRgbFunction(s: string): RGBA {
  const open = s.indexOf("(");
  const close = s.lastIndexOf(")");
  if (open < 0 || close < 0 || close <= open) {
    throw new Error(`Invalid rgb()/rgba() color: "${s}"`);
  }
  const inner = s.slice(open + 1, close);
  const parts = inner.split(",").map((p) => p.trim());
  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error(`Invalid rgb()/rgba() color: "${s}"`);
  }
  const r = parseChannel(parts[0]!, s);
  const g = parseChannel(parts[1]!, s);
  const b = parseChannel(parts[2]!, s);
  const a = parts.length === 4 ? parseAlpha(parts[3]!, s) : 1;
  return { r, g, b, a };
}

function parseChannel(raw: string, original: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid color channel "${raw}" in "${original}".`);
  }
  return n;
}

function parseAlpha(raw: string, original: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid alpha "${raw}" in "${original}".`);
  }
  return n;
}

export function formatColor(c: RGBA): string {
  const r = clampChannel(Math.round(c.r));
  const g = clampChannel(Math.round(c.g));
  const b = clampChannel(Math.round(c.b));
  const a = clampAlpha(c.a);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function clampChannel(n: number): number {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

function clampAlpha(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

export function lerpColorString(a: string, b: string, t: number): string {
  return formatColor(lerpColor(parseColor(a), parseColor(b), t));
}

export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
