// Signals the new-video tools read off pictures and sound: motion energy, cuts, holds, brightness, a
// palette, onsets, tempo and a beat grid. Pure functions over typed arrays, shared by `nv refs` (a
// reference video) and `nv rhythm` / `nv check` (a composition's own frames), so the two can be compared.

// ---------- pictures ----------

// Luma 0..1 of an RGB24 (or RGBA with stride 4) buffer.
export function lumaOf(px, stride = 3) {
  const n = Math.floor(px.length / stride), out = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += stride) out[i] = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
  return out;
}

// Per-frame facts of small frames: mean luma, its spread, saturation, a 16-bin luma histogram, a 4x4 grid of
// mean lumas (layout), for cut and energy detection.
export function frameStats(px, w, h, stride = 3) {
  const L = lumaOf(px, stride), n = L.length, hist = new Float32Array(16), grid = new Float32Array(16), gridN = new Float32Array(16);
  let sum = 0, sum2 = 0, sat = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i];
    sum += l; sum2 += l * l;
    hist[Math.min(15, Math.floor(l * 16))]++;
    const x = i % w, y = Math.floor(i / w), g = Math.min(3, Math.floor((y / h) * 4)) * 4 + Math.min(3, Math.floor((x / w) * 4));
    grid[g] += l; gridN[g]++;
    const o = i * stride, r = px[o], gg = px[o + 1], b = px[o + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    sat += mx ? (mx - mn) / mx : 0;
  }
  for (let k = 0; k < 16; k++) { hist[k] /= n; grid[k] = gridN[k] ? grid[k] / gridN[k] : 0; }
  const mean = sum / n;
  return { L, mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), sat: sat / n, hist, grid };
}

// Mean absolute luma difference of two frames (0..1).
export function pixelDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

const histDist = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); return s; };

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Share of pixels whose luma moved more than `thr` between two frames (0..1).
export function movedShare(a, b, thr = 0.02) {
  let c = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > thr) c++;
  return c / a.length;
}

// Average-pool a luma frame w x h down to a G-wide grid: the layout, without the detail.
export function pool(L, w, h, G = 48) {
  const GH = Math.max(1, Math.round((G * h) / w)), o = new Float32Array(G * GH), c = new Float32Array(G * GH);
  for (let i = 0; i < L.length; i++) {
    const x = i % w, y = (i / w) | 0, k = Math.min(GH - 1, ((y * GH) / h) | 0) * G + Math.min(G - 1, ((x * G) / w) | 0);
    o[k] += L[i]; c[k]++;
  }
  for (let k = 0; k < o.length; k++) o[k] /= c[k] || 1;
  return o;
}

// Motion, cuts and scene changes over a run of frame stats sampled at `fps` (frames w x h).
//   energy[i]  the share of the frame that moved over the last 0.1 s (so it reads the same at any fps), 0..1
//   score[i]   change from the frame before, pixels plus histogram (what a hard cut spikes)
//   cuts       times (s) where the score spikes alone: over `floor`, over `k` times the local median, a local
//              maximum, and not part of a run of motion (the frames either side change far less)
//   changes    times (s) where the layout before (0.1..0.45 s earlier) and after differ most: scene changes
//              by any transition (a cut, a wipe, a blur, a dissolve, a flash), snapped to a hard cut nearby
export function motion(stats, fps, { floor = 0.1, k = 3, minShot = 0.3, w, h, change = 0.025 } = {}) {
  const n = stats.length, lag = Math.max(1, Math.round(fps / 10));
  const energy = new Float32Array(n), score = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    score[i] = pixelDiff(stats[i].L, stats[i - 1].L) + 0.25 * histDist(stats[i].hist, stats[i - 1].hist);
    energy[i] = movedShare(stats[i].L, stats[Math.max(0, i - lag)].L);
  }
  energy[0] = energy[1] ?? 0;
  const win = Math.max(3, Math.round(fps)), cand = [];
  for (let i = 1; i < n; i++) {
    const s = score[i];
    if (s < floor) continue;
    const loc = [];
    for (let j = Math.max(1, i - win); j <= Math.min(n - 1, i + win); j++) if (j !== i) loc.push(score[j]);
    if (s < k * Math.max(0.01, median(loc))) continue;
    if (s < (score[i - 1] ?? 0) || s < (score[i + 1] ?? 0)) continue;
    const side = Math.max(score[i - 1] ?? 0, score[i + 1] ?? 0);
    if (side > 0.7 * s && s < 2.5 * floor) continue;   // a smear of motion, not a cut
    cand.push({ i, s });
  }
  // Keep the stronger of two cuts closer than minShot.
  const minGap = Math.max(1, Math.round(minShot * fps)), kept = [];
  for (const c of cand) {
    const last = kept[kept.length - 1];
    if (last && c.i - last.i < minGap) { if (c.s > last.s) kept[kept.length - 1] = c; continue; }
    kept.push(c);
  }
  const cuts = kept.map((c) => c.i / fps);
  // Scene changes: before/after layout difference on a pooled grid.
  const changes = [];
  if (w && h && n > 4) {
    const P = stats.map((s) => pool(s.L, w, h)), m = P[0].length;
    const avg = (a, b) => {
      const o = new Float32Array(m);
      let c = 0;
      for (let i = Math.max(0, a); i <= Math.min(n - 1, b); i++) { c++; const p = P[i]; for (let j = 0; j < m; j++) o[j] += p[j]; }
      for (let j = 0; j < m; j++) o[j] /= c || 1;
      return o;
    };
    const w1 = Math.max(1, Math.round(0.1 * fps)), w2 = Math.max(w1 + 1, Math.round(0.45 * fps));
    const D = new Float32Array(n);
    for (let i = 0; i < n; i++) D[i] = pixelDiff(avg(i - w2, i - w1), avg(i + w1, i + w2));
    const rad = Math.max(1, Math.round(0.4 * fps)), edge = Math.round(0.3 * fps), found = [];
    for (let i = edge; i < n - edge; i++) {
      if (D[i] < change) continue;
      let top = true;
      for (let j = Math.max(0, i - rad); j <= Math.min(n - 1, i + rad) && top; j++) if (D[j] > D[i]) top = false;
      if (top) found.push({ i, s: D[i] });
    }
    const gap = Math.round(0.6 * fps), merged = [];
    for (const c of found) {
      const last = merged[merged.length - 1];
      if (last && c.i - last.i < gap) { if (c.s > last.s) merged[merged.length - 1] = c; continue; }
      merged.push(c);
    }
    for (const c of merged) {
      const t = c.i / fps, near = cuts.find((x) => Math.abs(x - t) <= 0.35);
      changes.push(+(near ?? t).toFixed(3));
    }
    for (const t of cuts) if (!changes.some((x) => Math.abs(x - t) < 0.3)) changes.push(t);
    changes.sort((a, b) => a - b);
  }
  return { energy, score, cuts, cutScores: kept.map((c) => c.s), changes };
}

// Shots between cuts over [0, duration).
export function shotsOf(cuts, duration) {
  const edges = [0, ...cuts.filter((t) => t > 0 && t < duration), duration], shots = [];
  for (let j = 0; j + 1 < edges.length; j++) shots.push({ n: j + 1, t0: edges[j], dur: edges[j + 1] - edges[j] });
  return shots;
}

// Spans where the moving share stays under `eps` (0.2% of the frame) for at least `min` seconds: nothing
// moves on screen.
export function holds(energy, fps, { eps = 0.002, min = 1.5 } = {}) {
  const out = [];
  let s = -1;
  for (let i = 0; i <= energy.length; i++) {
    const still = i < energy.length && energy[i] < eps;
    if (still && s < 0) s = i;
    if (!still && s >= 0) {
      const dur = (i - s) / fps;
      if (dur >= min) out.push({ t0: s / fps, dur });
      s = -1;
    }
  }
  return out;
}

// Mean of `series` over `parts` equal stretches, and a sentence for the shape.
export function arc(series, parts = 5) {
  const n = series.length, out = [];
  for (let p = 0; p < parts; p++) {
    const a = Math.floor((p * n) / parts), b = Math.max(a + 1, Math.floor(((p + 1) * n) / parts));
    let s = 0;
    for (let i = a; i < b && i < n; i++) s += series[i];
    out.push(s / Math.max(1, Math.min(b, n) - a));
  }
  const max = Math.max(...out, 1e-9), norm = out.map((v) => v / max), peak = norm.indexOf(1);
  const names = ['the opening', 'the second fifth', 'the middle', 'the fourth fifth', 'the ending'];
  const words = parts === 5
    ? `peaks in ${names[peak]}; opens at ${Math.round(norm[0] * 100)}%, ends at ${Math.round(norm[4] * 100)}% of the peak`
    : '';
  return { values: out, norm, peak, words };
}

// ---------- colour ----------

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

// k-means over RGB pixels (a flat RGB24 buffer, every `step`th pixel): the k swatches by area, near
// duplicates merged. Deterministic: seeded on luma quantiles.
export function palette(px, { k = 6, step = 1, stride = 3, iters = 12 } = {}) {
  const pts = [];
  for (let o = 0; o + 2 < px.length; o += stride * step) pts.push([px[o], px[o + 1], px[o + 2]]);
  if (!pts.length) return [];
  const byL = [...pts].sort((a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
  let C = Array.from({ length: k }, (_, j) => [...byL[Math.min(byL.length - 1, Math.floor(((j + 0.5) / k) * byL.length))]]);
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < iters; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let best = 0, bd = Infinity;
      for (let j = 0; j < C.length; j++) {
        const c = C[j], d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      assign[i] = best;
      const s = sum[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    C = C.map((c, j) => (sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c));
  }
  const area = new Array(C.length).fill(0);
  for (let i = 0; i < pts.length; i++) area[assign[i]]++;
  let sw = C.map((c, j) => ({ rgb: c, area: area[j] / pts.length })).filter((s) => s.area > 0);
  sw.sort((a, b) => b.area - a.area);
  const merged = [];
  for (const s of sw) {
    const near = merged.find((m) => Math.hypot(m.rgb[0] - s.rgb[0], m.rgb[1] - s.rgb[1], m.rgb[2] - s.rgb[2]) < 28);
    if (near) near.area += s.area; else merged.push({ ...s });
  }
  return merged.map((s) => ({ hex: toHex(s.rgb), area: +s.area.toFixed(3) }));
}

// WCAG relative luminance and contrast ratio.
export function relLum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ---------- sound ----------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], k = i + j + len / 2;
        const vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[k] = ur - vr; im[k] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Onset strength (spectral flux of log magnitudes) at `hop` samples, plus RMS loudness in dBFS per hop.
export function onsets(samples, rate, { size = 1024, hop = 256 } = {}) {
  const frames = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  const env = new Float32Array(frames), rms = new Float32Array(frames);
  const win = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  let prev = new Float64Array(size / 2);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    let e = 0;
    for (let i = 0; i < size; i++) { const s = samples[o + i]; re[i] = s * win[i]; im[i] = 0; e += s * s; }
    rms[f] = 10 * Math.log10(e / size + 1e-10);
    fft(re, im);
    const mag = new Float64Array(size / 2);
    let flux = 0;
    for (let b = 1; b < size / 2; b++) {
      mag[b] = Math.log1p(10 * Math.hypot(re[b], im[b]));
      const d = mag[b] - prev[b];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    prev = mag;
  }
  // Take away the local mean (0.5 s) and keep what rises above it.
  const hopRate = rate / hop, w = Math.max(1, Math.round(hopRate * 0.25)), out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, f - w); j <= Math.min(frames - 1, f + w); j++) { s += env[j]; c++; }
    out[f] = Math.max(0, env[f] - s / c);
  }
  return { env: out, rms, hopRate };
}

// Tempo from the onset envelope's autocorrelation between 60 and 200 BPM, weighted towards 120 (one
// octave either side), then the beat phase that lines the most onsets up. Returns null on silence.
export function tempo(env, hopRate, { min = 60, max = 200, centre = 120 } = {}) {
  const n = env.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += env[i] * env[i];
  if (!(energy > 0) || n < hopRate * 4) return null;
  const lo = Math.floor((60 / max) * hopRate), hi = Math.ceil((60 / min) * hopRate);
  const ac = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (n - lag);
  }
  let best = lo, bw = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const bpm = (60 * hopRate) / lag, prior = Math.exp(-0.5 * (Math.log2(bpm / centre) / 0.9) ** 2);
    const w = ac[lag] * prior;
    if (w > bw) { bw = w; best = lag; }
  }
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1], den = y0 - 2 * y1 + y2;
  const coarse = den ? best + (0.5 * (y0 - y2)) / den : best;
  // Refine period and phase together with a comb over the whole envelope (a lag is only good to one hop,
  // ~2% at 120 BPM, which drifts a beat grid off the music within a minute).
  const at = (x) => { const i = Math.floor(x), f = x - i; return i + 1 < n ? env[i] * (1 - f) + env[i + 1] * f : 0; };
  let lag = coarse, bestPhase = 0, bs = -Infinity;
  for (let s = -60; s <= 60; s++) {
    const L = coarse * (1 + s * 0.0005);
    for (let ph = 0; ph < L; ph += 0.25) {
      let sum = 0;
      for (let x = ph; x < n - 1; x += L) sum += at(x);
      if (sum > bs) { bs = sum; lag = L; bestPhase = ph; }
    }
  }
  const period = lag / hopRate, bpm = 60 / period;
  let zero = 0;
  for (let i = 0; i < n; i++) zero += env[i] * env[i];
  return { bpm: +bpm.toFixed(2), period, first: bestPhase / hopRate, confidence: +(ac[best] / (zero / n)).toFixed(2) };
}

export function beatTimes(t, duration) {
  if (!t) return [];
  const out = [];
  for (let x = t.first; x < duration; x += t.period) out.push(+x.toFixed(3));
  return out;
}

// Share of `cuts` within `tol` seconds of a beat.
export function onBeat(cuts, beats, tol = 0.07) {
  if (!cuts.length || !beats.length) return null;
  let hit = 0;
  for (const c of cuts) if (beats.some((b) => Math.abs(b - c) <= tol)) hit++;
  return +(hit / cuts.length).toFixed(2);
}

// The loudest rises of a loudness curve (dB per hop): candidate drops, as times.
export function drops(rms, hopRate, { n = 3, span = 1 } = {}) {
  const w = Math.max(1, Math.round(hopRate * span)), rise = [];
  for (let i = w; i < rms.length - w; i++) {
    let a = 0, b = 0;
    for (let j = 1; j <= w; j++) { a += rms[i - j]; b += rms[i + j - 1]; }
    rise.push({ t: i / hopRate, d: (b - a) / w });
  }
  rise.sort((x, y) => y.d - x.d);
  const out = [];
  for (const r of rise) {
    if (out.length >= n || r.d < 3) break;
    if (out.every((o) => Math.abs(o.t - r.t) > 2)) out.push({ t: +r.t.toFixed(2), rise: +r.d.toFixed(1) });
  }
  return out.sort((a, b) => a.t - b.t);
}
