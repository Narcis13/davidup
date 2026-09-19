// A pop-up book (v1 paper3d book3) on engines/stage3d.js: a cover and leaves hinged on the spine, spreads of two
// pages, cut-out pieces that lie flat while their spread is shut and stand up as it opens, a block of leaves
// with a cream edge, shadows on the pages and the table.
//
//   const book = book3({ PW: 460, PD: 620, cover, spreads: [{ left, right, pieces: [
//     { base: [[-440, -285], [440, -285]], h: 470, card: sky },     // across the gutter
//     { base: [[-330, -30], [-150, -30]], h: 400, card: pine },     // on the left page
//   ] }] });
//   book.draw({ turn, cam, look })   // => ops
//
// Cards are card3(w, h, kids). turn counts the leaves lying on the left: 0 = shut, 1 = the cover open on
// spread 0, 2 = spread 1; a fraction is a leaf in the air. A piece's base is its foot on the open spread: x is the
// distance from the spine (negative on the left page), z runs along the spine (negative away from the reader),
// the first point its left end. lean (degrees, 90 upright), rise (scales when it stands), back (card seen from
// behind), shadow: false, mesh (image density), after(Q, e) => ops drawn over it once placed.
// board, edge: roles of the boards and of the leaves' cut edge.
// Axes: x right, y up, z towards the reader; the spine lies along z through the origin, the table is y = 0.
import { ease } from '../core/curves.js';
import { fill, group, rect, stroke, mkPath } from '../core/list.js';
import { V3, card3, project, shadeOf, shadows } from '../engines/stage3d.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function book3({ PW = 460, PD = 620, spreads, cover, board = { base: 'accents.1', shade: 0.5 }, edge = { base: 'paper', tint: 0.3 }, leaf = 5 }) {
  const nS = spreads.length, LEAF = leaf;
  const frameOf = (side, ang) => { const s = side === 'L' ? -1 : 1, ca = Math.cos(ang), sa = Math.sin(ang); return { U: [s * ca, sa, 0], N: [-s * sa, ca, 0] }; };
  // ang = how far the page is lifted off the table
  const pageQuad = (side, ang, y0 = 0, grow = 0) => {
    const { U } = frameOf(side, ang), a = [0, y0, -PD / 2 - grow], b = [0, y0, PD / 2 + grow], A = V3.add(a, V3.mul(U, PW + grow)), B = V3.add(b, V3.mul(U, PW + grow));
    return side === 'L' ? [A, a, b, B] : [a, A, B, b];
  };
  const boardCard = card3(8, 8, [fill(rect(0, 0, 8, 8), board)]);
  const lines = [];
  for (let y = 2; y < 24; y += 3) lines.push({ pts: [0, y, PW, y + (y % 2 ? 0.6 : -0.4)], closed: false });
  const edgeCard = card3(PW, 24, [fill(rect(0, 0, PW, 24), edge), stroke(mkPath(lines), { base: 'shade', alpha: 0.35 }, { w: 0.6, wobble: 0 })]);

  return {
    PW, PD, pageQuad,
    draw({ turn, cam, look }) {
      const out = [];
      const quad = (card, Q, o = {}) => { const g = project(cam, card, Q, { look, ...o }); if (g) out.push(g); };
      const shade = (casters, clip, alpha) => { const g = shadows(cam, casters, { clip, alpha, look }); if (g) out.push(g); };

      function block(side, y1) {
        if (y1 <= 1) return;
        const s = side === 'L' ? -1 : 1, z = PD / 2, x0 = 0, x1 = s * PW;
        const front = side === 'L' ? [[x1, y1, z], [x0, y1, z], [x0, 0, z], [x1, 0, z]] : [[x0, y1, z], [x1, y1, z], [x1, 0, z], [x0, 0, z]];
        quad(edgeCard, front, { dark: 0.22, name: `edge${side}` });
        const sideQ = side === 'R' ? [[x1, y1, z], [x1, y1, -z], [x1, 0, -z], [x1, 0, z]] : [[x1, y1, -z], [x1, y1, z], [x1, 0, z], [x1, 0, -z]];
        quad(edgeCard, sideQ, { dark: side === 'R' ? 0.3 : 0.1, name: `side${side}` });
      }
      const upOf = (p, e, fr, dir) => { const th = (p.lean ?? 90) * Math.PI / 180 * clamp(e * (p.rise ?? 1), 0, 1), flat = V3.norm(V3.cross(fr, dir)); return V3.add(V3.mul(flat, Math.cos(th)), V3.mul(fr, Math.sin(th))); };
      function collect(pieces, side, ang, open, y0) {
        const fr = frameOf(side, ang), e = ease.out(clamp((open - 0.1) / 0.85, 0, 1)), res = [], at = (x, z) => V3.add([0, y0, z], V3.mul(fr.U, Math.abs(x)));
        for (const p of pieces) {
          if (p.base[0][0] * p.base[1][0] < 0) continue;
          const onLeft = (p.base[0][0] + p.base[1][0]) / 2 < 0;
          if (onLeft !== (side === 'L')) continue;
          const b0 = at(...p.base[0]), b1 = at(...p.base[1]), up = upOf(p, e, fr.N, V3.norm(V3.sub(b1, b0)));
          res.push({ p, e, Q: [V3.add(b0, V3.mul(up, p.h)), V3.add(b1, V3.mul(up, p.h)), b1, b0], zc: (p.base[0][1] + p.base[1][1]) / 2, r0: at(0, 0), N: fr.N });
        }
        return res;
      }
      // a piece across the gutter: its left foot on the left page, its right foot on the right page
      function collectAcross(pieces, angL, angR, open, yL, yR) {
        const fL = frameOf('L', angL), fR = frameOf('R', angR), e = ease.out(clamp((open - 0.1) / 0.85, 0, 1)), res = [];
        for (const p of pieces) {
          if (p.base[0][0] * p.base[1][0] >= 0) continue;
          const b0 = V3.add([0, yL, p.base[0][1]], V3.mul(fL.U, Math.abs(p.base[0][0]))), b1 = V3.add([0, yR, p.base[1][1]], V3.mul(fR.U, Math.abs(p.base[1][0])));
          const N = V3.norm(V3.add(fL.N, fR.N)), up = upOf(p, e, N, V3.norm(V3.sub(b1, b0)));
          res.push({ p, e, Q: [V3.add(b0, V3.mul(up, p.h)), V3.add(b1, V3.mul(up, p.h)), b1, b0], zc: (p.base[0][1] + p.base[1][1]) / 2, r0: [0, Math.max(yL, yR), 0], N: [0, 1, 0] });
        }
        return res;
      }
      function drawQuads(quads, clip) {
        quads.sort((a, b) => a.zc - b.zc);
        const casters = quads.filter((q) => q.e > 0.03 && q.p.shadow !== false).map((q) => ({ card: q.p.card, P: q.Q, r0: q.r0, n: q.N, alpha: Math.min(1, q.e * 1.5) }));
        if (casters.length) shade(casters, clip, 0.34);
        for (const q of quads) {
          if (q.e <= 0.015) continue;
          quad(q.p.card, q.Q, { n: q.p.mesh ?? 8, dark: shadeOf(q.Q) * 0.85 + (1 - q.e) * 0.22, back: q.p.back || q.p.card, alpha: Math.min(1, q.e * 5), name: q.p.name });
          if (q.p.after) { const a = q.p.after(q.Q, q.e); if (a) out.push(a); }
        }
      }

      const t = clamp(turn, 0, nS), k = Math.min(Math.floor(t + 1e-9), nS), fr = k >= nS ? 0 : t - k, yL = k * LEAF + 3, yR = (nS - k) * LEAF + 3, top = Math.max(yL, yR);
      // boards, then the two blocks of leaves
      { const QL = pageQuad('L', 0, 0, 10), QR = pageQuad('R', 0, 0, 10); if (k > 0 || fr > 0) quad(boardCard, QL, { dark: shadeOf(QL) + 0.1, name: 'boardL' }); quad(boardCard, QR, { dark: shadeOf(QR) + 0.1, name: 'boardR' }); }
      if (k > 0) block('L', yL);
      block('R', yR - (fr > 0 ? LEAF : 0));
      if (fr === 0) {
        if (k === 0) { const Q = pageQuad('R', 0, yR + 2, 8); quad(cover, Q, { n: 12, dark: shadeOf(Q), name: 'cover' }); return group('book', out); }
        const sp = spreads[k - 1], QL = pageQuad('L', 0, yL), QR = pageQuad('R', 0, yR);
        quad(sp.left, QL, { dark: shadeOf(QL), name: 'pageL' });
        quad(sp.right, QR, { dark: shadeOf(QR), name: 'pageR' });
        drawQuads([...collect(sp.pieces, 'L', 0, 1, yL), ...collect(sp.pieces, 'R', 0, 1, yR), ...collectAcross(sp.pieces, 0, 0, 1, yL, yR)], [QL[0], QR[1], QR[2], QL[3]]);
        return group('book', out);
      }
      // leaf k is in the air: spread k-1 shuts (if there is one), spread k opens
      const phi = ease.io(fr) * Math.PI, openA = phi / Math.PI, shut = k > 0 ? spreads[k - 1] : null, opening = spreads[k], yRu = yR - LEAF;
      if (shut) {
        const QL = pageQuad('L', 0, yL);
        quad(shut.left, QL, { dark: shadeOf(QL) + 0.12 * Math.sin(phi) * (phi > Math.PI / 2 ? 1 : 0), name: 'pageL' });
        drawQuads(collect(shut.pieces, 'L', 0, 1 - openA, yL), QL);
      }
      {
        const QR = pageQuad('R', 0, yRu);
        quad(opening.right, QR, { dark: shadeOf(QR) + 0.12 * Math.sin(phi) * (phi < Math.PI / 2 ? 1 : 0), name: 'pageR' });
        drawQuads(collect(opening.pieces, 'R', 0, openA, yRu), QR);
      }
      const side = phi <= Math.PI / 2 ? 'R' : 'L', lift = side === 'R' ? phi : Math.PI - phi, Q = pageQuad(side, lift, top, k === 0 ? 8 : 0);
      const showing = side === 'R' ? (k === 0 ? cover : shut.right) : opening.left, under = pageQuad(side, 0, side === 'R' ? yRu : yL);
      shade([{ card: showing, P: Q, r0: [0, side === 'R' ? yRu : yL, 0], n: [0, 1, 0] }], under, 0.24);
      quad(showing, Q, { n: 14, dark: shadeOf(Q) * 1.15, name: 'leaf' });
      if (side === 'R' && shut) drawQuads([...collect(shut.pieces, 'R', lift, 1 - openA, top), ...collectAcross(shut.pieces, 0, lift, 1 - openA, yL, top)], null);
      if (side === 'L') drawQuads([...collect(opening.pieces, 'L', lift, openA, top), ...collectAcross(opening.pieces, lift, 0, openA, top, yRu)], null);
      return group('book', out);
    },
  };
}
