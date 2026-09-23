// sam, drawn into the two rig sheets (4.0 W1) the way a child would fill them in: coloured in flat, then gone
// round with a pen. The face is left off the head on purpose: hdf sketch --face stick grafts the stick's eyes,
// brows and mouths on (4.0 RE-3), so the mouth can follow a recording. The pompom and the soles are left the
// paper's colour, as a child leaves them; the sketch keeps them as `light` fills (RE-5). Skin reads as `skin`
// and the trousers as `shade` (RE-4); --roles gives the rest the colours sam was drawn in.
//
//   node films/moon/sam-sheet.mjs            -> films/moon/sam-side.jpg, films/moon/sam-front.jpg
//   node cli/hdf.mjs sketch films/moon/sam-side.jpg films/moon/sam-front.jpg --name sam --face stick \
//     --roles '#3b6fd4=fills.0,#f2b705=fills.3,#d8342f=accents.0,#f08a8a=blush' \
//     --credit 'sam, drawn on the rig sheets for the moon film; face from the stick puppet' --tags puppet,sketch,cast
import { writeFileSync } from 'node:fs';
import { drawnRigSheet } from '../../cli/sketch.mjs';

const SKIN = '#f3c9a2', HAT = '#f2b705', JUMPER = '#3b6fd4', MOON = '#ffe14d', TROUSERS = '#4b4f58', SHOE = '#d8342f', HAIR = '#2a1d17', CHEEK = '#f08a8a', POM = '#fff6d8';

const ring = (cx, cy, rx, ry, n = 36, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (i / n) * (a1 - a0); return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
const capsule = (len, r) => {
  const pts = [];
  for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; pts.push([r * Math.cos(a), len + r * Math.sin(a)]); }
  return pts;
};
const closed = (pts) => [...pts, pts[0]];
// A crescent // lit on the right: the limb from top to bottom round the right, back up the terminator (an ellipse k r wide).
const crescent = (cx, cy, r, k = 0.35) => {
  const n = 14, out = [];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  for (let i = n - 1; i > 0; i--) { const a = -Math.PI / 2 + (i / n) * Math.PI; out.push([cx + k * r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
};

// The beanie: a dome over the top of the head, a turned-up band, a pompom. c: the head's centre, r its radius.
function beanie([cx, cy], r, lean = 0) {
  const dome = [...ring(cx + lean, cy - 2, r + 1.5, r + 2, 20, Math.PI + 0.55, 2 * Math.PI - 0.55)];
  const [a, b] = [dome[0], dome.at(-1)];
  const band = [[a[0] - 1.5, a[1] - 1], [b[0] + 1.5, b[1] - 1], [b[0] + 1, b[1] + 6], [a[0] - 1, a[1] + 6]];
  const pom = ring(cx + lean * 1.4, cy - r - 4, 5.5, 5, 18);
  return { dome: [...dome, [b[0], b[1] + 1], [a[0], a[1] + 1]], band, pom };
}

function head(view) {
  const front = view === 'front', c = front ? [0, -28] : [2, -28], r = 23;
  const face = ring(c[0], c[1], r, r);
  const hat = beanie(c, r, front ? 0 : -2);
  // Tufts of hair under the beanie's band: at both sides face on, at the back in profile (clear of the eyes).
  const hair = front
    ? [[[-24, -37], [-15, -37], [-16, -33], [-19, -34], [-21, -29], [-24, -31]], [[24, -37], [15, -37], [16, -33], [19, -34], [21, -29], [24, -31]]]
    : [[[-22, -37], [-11, -37], [-12, -33], [-15, -34], [-17, -29], [-20, -31], [-22, -26], [-23, -32]]];
  const ear = front ? null : ring(-4, -25, 4.2, 5.5, 16);
  const cheeks = front ? [ring(-12, -18, 4, 3, 12), ring(12, -18, 4, 3, 12)] : [ring(5, -20, 3.6, 2.8, 12)];
  const fills = [[SKIN, face], ...hair.map((h) => [HAIR, h]), ...cheeks.map((k) => [CHEEK, k]), ...(ear ? [[SKIN, ear]] : []), [HAT, hat.dome], [HAT, hat.band], [POM, hat.pom]];
  const lines = [face, closed(hat.dome), closed(hat.band), hat.pom, ...(ear ? [ear] : [])];
  if (!front) lines.push([[24, -31], [28.5, -25], [24.5, -23.5]]);   // a nose, in profile only
  return { fills, lines };
}

function body(view) {
  const front = view === 'front';
  const shape = front
    ? [[-20, -50], [-7, -52], [7, -52], [20, -50], [23, -38], [18, 3], [-18, 3], [-23, -38]]
    : [[-13, -50], [-3, -52], [9, -51], [14, -48], [17, -38], [15, 3], [-15, 3], [-17, -38]];
  const moon = front ? crescent(-1, -27, 8.5) : crescent(6, -27, 6.5);
  const rib = front ? [[-18, -3], [18, -3]] : [[-15, -3], [15, -3]];
  const collar = front ? [[-7, -52], [0, -46], [7, -52]] : [[-3, -52], [4, -47], [9, -51]];
  return { fills: [[JUMPER, shape], [MOON, moon]], lines: [closed(shape), closed(moon), rib, collar] };
}

const SIDE = {
  head: head('side'),
  body: body('side'),
  arm: { fills: [[JUMPER, capsule(27, 6)]], lines: [capsule(27, 6)] },
  // The sleeve comes down the forearm to a yellow cuff; the wrist shows under it.
  fore: { fills: [[SKIN, capsule(26, 4.2)], [JUMPER, [[-5.5, -3], [5.5, -3], [5.5, 17], [-5.5, 17]]], [MOON, [[-5.8, 16], [5.8, 16], [5.8, 20.5], [-5.8, 20.5]]]],
    lines: [capsule(26, 4.2), [[-5.8, 16], [5.8, 16]], [[-5.8, 20.5], [5.8, 20.5]]] },
  hand: { fills: [[SKIN, ring(0, 8, 6, 8.5)]], lines: [ring(0, 8, 6, 8.5), [[4, 5], [8.5, 2]]] },
  foot: { fills: [[SHOE, [[-6, -3], [6, -3], [7, 1], [19, 2], [24, 5], [24, 7], [-6, 7]]], [POM, [[-6, 5], [24, 5], [24, 7.5], [-6, 7.5]]]],
    lines: [[[-6, -3], [6, -3], [7, 1], [19, 2], [24, 5], [24, 7.5], [-6, 7.5], [-6, -3]], [[-6, 5], [24, 5]]] },
  leg: { fills: [[TROUSERS, capsule(34, 7.5)]], lines: [capsule(34, 7.5)] },
  shin: { fills: [[TROUSERS, capsule(33, 6.5)]], lines: [capsule(33, 6.5)] },
};
const FRONT = {
  head: head('front'),
  body: body('front'),
  foot: { fills: [[SHOE, ring(0, 3.5, 7.5, 4.2)]], lines: [ring(0, 3.5, 7.5, 4.2)] },
};

writeFileSync(new URL('./sam-side.jpg', import.meta.url), await drawnRigSheet({ sheet: 'biped', figure: SIDE }).toBuffer('jpg', { quality: 0.92 }));
writeFileSync(new URL('./sam-front.jpg', import.meta.url), await drawnRigSheet({ sheet: 'biped-front', figure: FRONT }).toBuffer('jpg', { quality: 0.92 }));
console.log('films/moon/sam-side.jpg, films/moon/sam-front.jpg');
