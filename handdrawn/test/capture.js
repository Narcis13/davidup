// Synthetic captures for the K7 tests (4.0): a face talking and blinking, and hands making the four shapes,
// as MediaPipe's landmarkers give them (cli/track.py), so the phone path can be tested without MediaPipe.

// Blendshapes of a face at t seconds: talking (the jaw opening three times a second for 2 s), a blink at
// 1 s (a tenth of a second), brows up from 2.5 to 3 s, a frown (brows down) from 3 to 3.5 s, a smile from
// 3.5 s, eyes to their left from 4 to 4.5 s; at rest a little brow and jaw, as a real face has.
export function blendshapes(t) {
  const on = (a, b) => t >= a && t < b;
  const b = { jawOpen: 0.03, browDownLeft: 0.08, browDownRight: 0.08, browInnerUp: 0.05, mouthSmileLeft: 0.02, mouthSmileRight: 0.02, eyeBlinkLeft: 0.04, eyeBlinkRight: 0.04 };
  if (t < 2) b.jawOpen = 0.03 + 0.6 * Math.max(0, Math.sin(2 * Math.PI * 3 * t));
  if (on(1, 1.1)) b.eyeBlinkLeft = b.eyeBlinkRight = 0.9;
  if (on(2.5, 3)) { b.browInnerUp = 0.85; b.browOuterUpLeft = b.browOuterUpRight = 0.7; }
  if (on(3, 3.5)) b.browDownLeft = b.browDownRight = 0.8;
  if (on(3.5, 4)) b.mouthSmileLeft = b.mouthSmileRight = 0.8;
  if (on(4, 4.5)) { b.eyeLookOutLeft = 0.7; b.eyeLookInRight = 0.7; }
  if (on(4.5, 5)) b.eyeBlinkLeft = 0.9;   // a wink of their left eye: the picture's right
  return b;
}
export const faceJSON = (sec = 5, fps = 30, lost = 40) => ({
  fps, w: 720, h: 1280, frames: Array.from({ length: sec * fps }, (_, i) => (i === lost ? null : blendshapes(i / fps))),
});

// 21 hand landmarks for a shape, the wrist at (x, y) in picture fractions, fingers up.
const SHAPES = { open: [1, 1, 1, 1, 1], fist: [0, 0, 0, 0, 0], point: [0, 1, 0, 0, 0], thumb: [1, 0, 0, 0, 0] };
export function handLandmarks(shape, x, y) {
  const s = 0.04, out = [[x, y, 0]], ext = SHAPES[shape];
  // Thumb: out to the side, folded across the palm when curled.
  const th = ext[0] ? [[1.2, -0.6], [1.9, -1.1], [2.5, -1.5], [3.0, -1.9]] : [[0.9, -0.7], [1.2, -1.3], [0.9, -1.7], [0.3, -1.8]];
  for (const [dx, dy] of th) out.push([x + dx * s, y + dy * s, 0]);
  [-0.9, -0.3, 0.3, 0.9].forEach((fx, i) => {
    const mcp = [fx, -2.2];
    const pts = ext[i + 1] ? [mcp, [fx, -3.2], [fx, -3.9], [fx, -4.5]] : [mcp, [fx, -2.9], [fx, -2.3], [fx, -1.8]];
    for (const [dx, dy] of pts) out.push([x + dx * s, y + dy * s, 0]);
  });
  return out;
}
// Hands through a take: the picture's left hand points then gives a thumb, the right opens then makes a fist,
// a second each; the right is lost for a few frames.
export const handsJSON = (fps = 30) => ({
  fps, w: 720, h: 1280, frames: Array.from({ length: 2 * fps }, (_, i) => {
    const t = i / fps, hands = [{ x: 0.3, label: 'Right', score: 0.98, lm: handLandmarks(t < 1 ? 'point' : 'thumb', 0.3, 0.6) }];
    if (!(i >= 10 && i < 14)) hands.push({ x: 0.7, label: 'Left', score: 0.97, lm: handLandmarks(t < 1 ? 'open' : 'fist', 0.7, 0.6) });
    return hands;
  }),
});
