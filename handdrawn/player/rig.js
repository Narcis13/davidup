// The Rig tab (4.0 W2): a pose editor for one puppet, beside the film. Everything it draws and every edit it
// makes goes through core (player/deps.js: the puppet, the actor's vocabulary, core/workbench.js), taken
// from the player's current generation, so a hot reload of core reaches it too.
//
//   pose      drag a grip: a circle turns its part about its pivot (FK), a square slides it (a pupil, a
//             brow), a diamond at a wrist or ankle puts it there and the limb follows (IK, K5's reach; untick
//             IK to turn the forearm or shin instead). Variants, the view and any squash are the controls
//             under the drawing. Load a pose (its own, the vocabulary's, an expression) or the state the
//             film draws it in at this frame, then `record pose <name>`, or `record frame` into a cycle (after
//             the frame picked, or at the end), `replace` / `drop` the frame picked; the onion skin is the
//             frame before in red, `play` loops the cycle at its fps.
//   pivots    the puppet at its zero drawing (every joint 0): drag a pivot and the part turns about the new
//             point while the drawing stays where it is (an imported sketch's elbow a little off).
//   sockets   drag a socket's dot to move it, the end of its arrow to turn it (K8's props follow); add one on
//             any part, drop one.
//
// In `hdf dev` every edit to a stored puppet is written straight back (POST /__hdf/puppet/<id>: its source
// under <store>/src/<id>.puppet.json and the store), the store changes, and the film reloads with it; undo
// writes the one before. Without the dev server (a bundle, a static server) the tab poses and copies a state
// for the film's source, and saves nothing. A puppet built in code (a film's `cast`) is posed read-only too.
const $ = (id) => document.getElementById(id);
const RED = '#d0443c', GRIP = { turn: '#f0a23a', slide: '#2f7fd0', reach: '#37a26b' };
const PROV = ['credit', 'source', 'licence'];

export function initRig(P) {
  const cv = $('rig'), g = cv.getContext('2d');
  const R = {
    key: null, id: null, payload: null, make: null, actor: null, state: {}, mode: 'pose', dir: 1,
    frame: null, undo: [], hover: null, drag: null, view: null, playing: null, saving: Promise.resolve(), preview: null,
  };
  const D = () => P.S.D;
  const W = () => P.S.D.WB;
  const dev = !!P.cfg.dev;

  // ---------- which puppets ----------

  // The stored puppets, those the frame draws first (*), then the film's cast built in code (read-only).
  function choices() {
    const used = new Set();
    D().walk(P.frameList() ?? [], (op) => { if (op.op === 'group' && op.cel) used.add(op.cel); });
    const cat = P.cfg.catalogue ?? {};
    const stored = Object.keys(cat).filter((id) => !id.startsWith('pack:') && cat[id]?.parts && !cat[id]?.mirror);
    const cast = Object.entries(P.S.cast ?? {}).filter(([, a]) => a?.puppet?.worldOf && !stored.includes(a.name)).map(([k]) => `cast:${k}`);
    const name = (k) => (k.startsWith('cast:') ? P.S.cast[k.slice(5)].name : cat[k]?.name ?? k);
    const all = [...stored, ...cast].sort((a, b) => used.has(name(b)) - used.has(name(a)) || a.localeCompare(b));
    return all.map((k) => ({ key: k, drawn: used.has(name(k)), label: `${used.has(name(k)) ? '* ' : '  '}${k}${k.startsWith('cast:') ? '  (code, read-only)' : dev ? '' : '  (read-only)'}` }));
  }

  function fillPick() {
    const sel = $('rigPick'), list = choices();
    if (!list.length) { sel.replaceChildren(new Option('no puppet in the store or the film', '')); return list; }
    const key = list.map((c) => c.label).join();
    if (sel.dataset.key !== key) { sel.replaceChildren(...list.map((c) => new Option(c.label, c.key))); sel.dataset.key = key; }
    if (R.key) sel.value = R.key;
    return list;
  }

  async function pick(key) {
    stop();
    R.key = key; R.frame = null; R.undo = []; R.drag = null; R.hover = null; R.preview = null;
    R.id = key && !key.startsWith('cast:') && dev ? key : null;
    if (!key) { R.payload = R.make = null; return draw(); }
    if (key.startsWith('cast:')) {
      const a = P.S.cast[key.slice(5)];
      R.payload = a.puppet.puppet;
      R.make = a.puppet;
    } else if (R.id) {
      const res = await fetch(`/__hdf/puppet/${encodeURIComponent(key)}`);
      if (!res.ok) { P.status(`rig: ${(await res.json().catch(() => ({}))).error ?? res.status}`, true); return; }
      R.payload = (await res.json()).payload;
      build();
    } else {
      const rec = { ...P.cfg.catalogue[key] };
      for (const k of PROV) delete rec[k];
      R.payload = rec;
      build();
    }
    R.dir = R.make.rest.dir ?? 1;
    R.state = { ...R.make.rest };
    fromFrame(true);
    controls();
    draw();
  }

  function build() {
    R.make = D().puppet({ ...R.payload, name: R.payload.name ?? R.key });
    R.actor = null;
  }
  const actor = () => (R.actor ??= D().actorOf(R.make));
  const nameOf = () => R.make?.cel.name;

  // The state the film draws this puppet in at the frame shown (its first drawing there), if it does.
  function fromFrame(quiet) {
    if (!R.make) return;
    let got = null;
    D().walk(P.frameList() ?? [], (op) => { if (!got && op.op === 'group' && op.cel === nameOf() && op.inputs) got = op.inputs; });
    if (!got) { if (!quiet) P.status(`rig: frame ${P.cur()} does not draw ${nameOf()}`); return; }
    R.state = { ...R.make.rest, ...got };
    R.dir = R.state.dir ?? R.dir;
    if (!quiet) P.status(`rig: ${nameOf()} as frame ${P.cur()} draws it`);
    controls();
    draw();
  }

  // ---------- controls under the drawing ----------

  function controls() {
    const m = R.make, ro = !R.id;
    for (const id of ['rigRecPose', 'rigDropPose', 'rigRecFrame', 'rigReplace', 'rigDropFrame', 'rigUndo', 'rigAddSocket', 'rigDropSocket', 'rigGrow']) $(id).disabled = ro;
    if (!m) { for (const id of ['rigView', 'rigLoad']) $(id).replaceChildren(); $('rigVariants').replaceChildren(); frames(); return; }
    // The view: every declared view, both ways round.
    const dirs = m.views ? [1, -1, 0.5, -0.5, 0].filter((d) => m.viewOf(d) === ({ 1: 'side', 0.5: 'three-quarter', 0: 'front' })[Math.abs(d)]) : [1];
    $('rigView').replaceChildren(...dirs.map((d) => new Option(m.views ? `${m.viewOf(d)} ${d > 0 ? '→' : d < 0 ? '←' : ''}` : 'one view', d)));
    $('rigView').disabled = !m.views;
    $('rigView').value = String(R.dir);
    // Variants and squashes.
    const rows = [];
    for (const n of m.parts) {
      const keys = m.puppet.parts[n].variants ? Object.keys(m.puppet.parts[n].variants) : null;
      if (!keys) continue;
      const s = document.createElement('select');
      s.replaceChildren(...keys.map((k) => new Option(k, k)));
      s.value = String(R.state[n] ?? m.rest[n]);
      s.onchange = () => { const v = keys.find((k) => k === s.value); R.state = { ...R.state, [n]: isNaN(+v) ? v : +v }; draw(); };
      const l = document.createElement('label');
      l.append(n, s);
      rows.push(l);
    }
    for (const [k, spec] of Object.entries(m.moves)) {
      if (!/\.s[xy]$/.test(k)) continue;
      const i = document.createElement('input');
      Object.assign(i, { type: 'range', min: spec[0], max: spec[1], step: spec[2], value: R.state[k] ?? 1 });
      i.oninput = () => { R.state = { ...R.state, [k]: +i.value }; draw(); };
      const l = document.createElement('label');
      l.append(k, i);
      rows.push(l);
    }
    $('rigVariants').replaceChildren(...rows);
    // What can be loaded: rest, its own poses, the vocabulary's poses and expressions, its cycles' frames.
    const opts = [new Option('load: rest', 'rest')];
    for (const p of m.poses) if (p !== 'rest') opts.push(new Option(`pose ${p}`, `pose:${p}`));
    try {
      const v = actor().vocabulary;
      for (const p of v.poses) if (!m.poses.includes(p)) opts.push(new Option(`vocabulary ${p}`, `vocab:${p}`));
      for (const e of v.expressions) opts.push(new Option(`expression ${e}`, `emote:${e}`));
    } catch { /* a puppet with no vocabulary */ }
    $('rigLoad').replaceChildren(...opts);
    $('rigPoses').replaceChildren(...m.poses.map((p) => new Option(p)));
    $('rigCycles').replaceChildren(...m.cycles.map((c) => new Option(c)));
    const parts = $('rigSocketPart');
    parts.replaceChildren(...m.parts.map((n) => new Option(n, n)));
    frames();
  }

  // The frames of the cycle named in the box, as chips; the one picked is where the next frame goes after.
  const cycleName = () => $('rigCycleName').value.trim();
  const cycle = () => R.payload?.cycles?.[cycleName()] ?? null;
  function frames() {
    const c = cycle(), box = $('rigFrames');
    if (R.frame !== null && (!c || R.frame >= c.frames.length)) R.frame = null;
    if (c) $('rigFps').value = c.fps ?? 12;
    box.replaceChildren(...(c?.frames ?? []).map((_, i) => {
      const b = document.createElement('button');
      b.textContent = i;
      b.className = i === R.frame ? 'on' : '';
      b.title = `frame ${i}: click to edit it (record frame goes after it)`;
      b.onclick = () => {
        stop();
        R.frame = R.frame === i ? null : i;
        if (R.frame !== null) R.state = { ...R.make.rest, ...c.frames[i], ...(R.make.views ? { dir: R.dir } : {}) };
        controls();
        draw();
      };
      return b;
    }));
    $('rigFrameInfo').textContent = c ? `${c.frames.length} frames at ${c.fps ?? 12} fps${R.frame !== null ? `, frame ${R.frame} picked` : ''}` : cycleName() ? 'a new cycle' : '';
  }
  // The onion: the frame before the one picked, or the cycle's last when none is.
  function onionState() {
    const c = cycle();
    if (!$('rigOnion').checked || !c?.frames.length || R.mode !== 'pose') return null;
    const i = R.frame === null ? c.frames.length - 1 : R.frame - 1;
    if (i < 0 && c.frames.length < 2) return null;
    return { ...R.make.rest, ...c.frames[(i + c.frames.length) % c.frames.length], ...(R.make.views ? { dir: R.dir } : {}) };
  }

  // ---------- drawing ----------

  let T = null, queued = false;
  const draw = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; paint(); }); } };
  const shown = () => (R.mode === 'pivots' ? W().zeroOf(R.make, R.dir) : { ...R.state, ...(R.make.views ? { dir: R.dir } : {}) });
  const toPx = ([x, y]) => [(x + T.ox) * T.k, (y + T.oy) * T.k];
  const toDrawing = (e) => { const r = cv.getBoundingClientRect(), s = cv.width / r.width; return [(e.clientX - r.left) * s / T.k - T.ox, (e.clientY - r.top) * s / T.k - T.oy]; };

  function paint() {
    const dpr = devicePixelRatio || 1, css = cv.clientWidth || 360;
    if (cv.width !== Math.round(css * dpr)) { cv.width = cv.height = Math.round(css * dpr); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    if (!R.make || !P.S) return;
    const Dd = D(), m = R.make, [bx, by, bw, bh] = m.cel.box, C = Math.max(bw, bh) * 1.12;
    T = { k: cv.width / C, ox: C / 2 - bx - bw / 2, oy: C / 2 - by - bh / 2 };
    const q = shown(), drawing = m(q);
    const list = Dd.seedList([Dd.paper(), Dd.place(T.ox, T.oy, Dd.group('frame', [Dd.stroke(Dd.rect(bx, by, bw, bh), 'guide', { w: 1, wobble: 0 }), drawing]))], 1);
    P.S.rigR ??= Dd.createRenderer({ cacheMb: 0, dedup: false, images: P.S.images });
    P.S.rigR.draw(g, list, { look: P.S.film.look, S: T.k, W: C, H: C });
    const prev = onionState();
    if (prev) P.ghost(g, [Dd.place(T.ox, T.oy, m(prev))], RED, { R: P.S.rigR, S: T.k, W: C, H: C, w: cv.width, h: cv.height });
    // Out of its box: the box in red, and what it would take.
    const ink = Dd.bounds(drawing.kids), over = ink && (ink[0] < bx - 0.5 || ink[1] < by - 0.5 || ink[0] + ink[2] > bx + bw + 0.5 || ink[1] + ink[3] > by + bh + 0.5);
    R.over = over ? ink : null;
    $('rigGrow').hidden = !over;
    if (over) { g.strokeStyle = RED; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(...toPx([bx, by]), bw * T.k, bh * T.k); g.setLineDash([]); }
    overlay(q);
    info(q);
  }

  function grips(q) {
    const m = R.make;
    if (R.mode === 'pose') return W().handles(m, q, { ik: $('rigIk').checked }).map((h) => ({ ...h, id: `${h.kind}:${h.part}` }));
    if (R.mode === 'pivots') {
      return m.parts.filter((n) => m.puppet.parts[n].pivot !== undefined).map((n) => {
        const w = m.worldOf(n, q);
        return { id: `pivot:${n}`, kind: 'pivot', part: n, at: [w[4], w[5]], parent: m.parentOf(n) };
      });
    }
    return m.sockets.flatMap((sn) => {
      const x = m.socketXf(sn, q), len = 0.09 * (m.cel.box[3] || 100);
      return [{ id: `socket:${sn}`, kind: 'socket', socket: sn, at: [x[4], x[5]] },
        { id: `angle:${sn}`, kind: 'angle', socket: sn, at: [x[4] + x[0] * len, x[5] + x[1] * len], from: [x[4], x[5]] }];
    });
  }

  function overlay(q) {
    const dpr = devicePixelRatio || 1, r = 5 * dpr, list = grips(q);
    g.lineWidth = 1.5 * dpr;
    for (const h of list) {
      const [x, y] = toPx(h.at), hot = R.hover === h.id || R.drag?.h.id === h.id;
      if (h.pivot) {
        const [px, py] = toPx(h.pivot);
        g.strokeStyle = 'rgba(40,40,40,.55)'; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(px, py, 2.5 * dpr, 0, 7); g.fill(); g.stroke();
      }
      if (h.kind === 'pivot' && h.parent !== undefined) {
        const w = R.make.worldOf(h.parent, q), [px, py] = toPx([w[4], w[5]]);
        g.strokeStyle = 'rgba(40,40,40,.35)'; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
      }
      if (h.from) {
        const [fx, fy] = toPx(h.from);
        g.strokeStyle = '#8a3fc0'; g.beginPath(); g.moveTo(fx, fy); g.lineTo(x, y); g.stroke();
      }
      g.fillStyle = hot ? '#fff' : GRIP[h.kind] ?? (h.kind === 'pivot' ? '#f0a23a' : '#8a3fc0');
      g.strokeStyle = '#222';
      g.beginPath();
      if (h.kind === 'slide') g.rect(x - r, y - r, 2 * r, 2 * r);
      else if (h.kind === 'reach') { g.moveTo(x, y - r * 1.3); g.lineTo(x + r * 1.3, y); g.lineTo(x, y + r * 1.3); g.lineTo(x - r * 1.3, y); g.closePath(); }
      else g.arc(x, y, h.kind === 'angle' ? r * 0.7 : r, 0, 7);
      g.fill(); g.stroke();
    }
    R.grips = list;
  }

  function info(q) {
    const h = R.grips?.find((x) => x.id === (R.drag?.h.id ?? R.hover)), m = R.make;
    let s = '';
    if (h?.part && R.mode === 'pose') {
      const keys = h.kind === 'slide' ? Object.keys(m.moves).filter((k) => k.startsWith(`${h.part}.`) && !/\.s[xy]$/.test(k))
        : h.kind === 'reach' ? [m.parentOf(m.parentOf(h.part)), m.parentOf(h.part)] : [h.part];
      s = keys.map((k) => `${k} ${q[k] ?? 0}${h.kind === 'slide' ? '' : '°'}`).join('  ');
    } else if (h?.part) s = `${h.part} pivot ${h.at.map((v) => v.toFixed(1)).join(', ')}${m.views ? ` (${m.viewOf(R.dir)})` : ''}`;
    else if (h?.socket) { const k = m.socketOf(h.socket, R.dir); s = `socket ${h.socket} on ${k.part} at ${k.at.join(', ')} ${k.angle}°`; }
    else s = { pose: 'drag a grip: circle turns, square slides, diamond reaches', pivots: 'drag a pivot: the part turns about it, the drawing stays', sockets: 'drag a socket to move it, its arrow to turn it' }[R.mode];
    if (R.over) s += `   draws outside its box (${R.over.map(Math.round).join(', ')})`;
    $('rigInfo').textContent = s;
    $('rigInfo').classList.toggle('err', !!R.over);
  }

  // ---------- dragging ----------

  const nearest = (e) => {
    if (!R.grips || !T) return null;
    const r = cv.getBoundingClientRect(), s = cv.width / r.width, x = (e.clientX - r.left) * s, y = (e.clientY - r.top) * s;
    let best = null, bd = 14 * (devicePixelRatio || 1);
    for (const h of R.grips) { const [hx, hy] = toPx(h.at), d = Math.hypot(hx - x, hy - y); if (d <= bd) { bd = d; best = h; } }
    return best;
  };
  cv.addEventListener('pointerdown', (e) => {
    const h = nearest(e);
    if (!h || !R.make) return;
    if ((h.kind === 'pivot' || h.kind === 'socket' || h.kind === 'angle') && !R.id) { P.status('rig: read-only here (hdf dev, a stored puppet, to move pivots and sockets)', true); return; }
    stop();
    cv.setPointerCapture(e.pointerId);
    R.drag = { h, from: toDrawing(e), start: { ...shown() }, payload: R.payload };
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!R.drag) { const h = nearest(e), id = h?.id ?? null; if (id !== R.hover) { R.hover = id; draw(); } return; }
    const { h, from, start } = R.drag, to = toDrawing(e), m = R.make, w = W();
    if (h.kind === 'turn') R.state = { ...R.state, ...w.turnTo(m, h.part, from, start, to) };
    else if (h.kind === 'slide') R.state = { ...R.state, ...w.slideTo(m, h.part, from, start, to) };
    else if (h.kind === 'reach') R.state = { ...R.state, ...w.reachTo(m, h.part, start, to) };
    else {
      const d0 = R.drag.payload, view = m.views ? m.viewOf(R.dir) : undefined;
      if (h.kind === 'pivot') R.drag.next = w.movePivot(d0, h.part, to, { view });
      else {
        const k = m.socketOf(h.socket, R.dir), inv = invert(m.worldOf(k.part, start));
        if (h.kind === 'socket') R.drag.next = w.setSocket(d0, h.socket, { part: k.part, at: apply(inv, to), angle: k.angle }, { view });
        else {
          const o = m.socketXf(h.socket, start), [lx, ly] = apply([inv[0], inv[1], inv[2], inv[3], 0, 0], to[0] - o[4], to[1] - o[5]);
          R.drag.next = w.setSocket(d0, h.socket, { part: k.part, at: k.at, angle: Math.atan2(ly, lx) * 180 / Math.PI }, { view });
        }
      }
      R.make = D().puppet({ ...R.drag.next, name: nameOf() });
    }
    draw();
  });
  const end = () => {
    if (!R.drag) return;
    const { h, next } = R.drag;
    R.drag = null;
    if (next) commit(next, h.kind === 'pivot' ? `moved ${h.part}'s pivot` : `moved socket ${h.socket}`);
    else draw();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!R.drag && R.hover) { R.hover = null; draw(); } });
  const apply = (m, x, y) => (Array.isArray(x) ? apply(m, x[0], x[1]) : [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const invert = (m) => { const [a, b, c, d, e, f] = m, det = a * d - b * c; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; };

  // ---------- edits: applied, drawn, written back ----------

  function commit(next, what) {
    const before = R.payload;
    R.undo.push(before);
    R.payload = next;
    build();
    controls();
    draw();
    save(what, () => { R.payload = before; R.undo.pop(); build(); controls(); draw(); });
  }
  // Writes are one at a time, in order; a refused one puts the payload back as it was.
  function save(what, revert) {
    if (!R.id) { P.status(`rig: ${what} (not saved: read-only here)`); return; }
    const id = R.id, payload = R.payload;
    R.saving = R.saving.then(async () => {
      P.status(`rig: ${what}; saving ${id}...`);
      const res = await fetch(`/__hdf/puppet/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload }) });
      const r = await res.json().catch(() => ({ error: `${res.status}` }));
      if (!res.ok) { P.status(`rig: ${what} refused: ${r.error}`, true); revert?.(); return; }
      P.status(`rig: ${what}; ${r.changed ? `saved ${id} (${r.sha.slice(0, 8)}) to ${r.file.split('/').slice(-3).join('/')}` : `${id} unchanged`}`);
      window.__hdf.rigSaves = (window.__hdf.rigSaves ?? 0) + 1;
    }).catch((e) => { P.status(`rig: saving failed: ${e.message ?? e}`, true); revert?.(); });
  }
  const tryEdit = (what, fn) => {
    if (!R.make) return;
    try { commit(fn(W()), what); } catch (e) { P.status(`rig: ${e.message ?? e}`, true); }
  };
  const pose = () => W().poseOf(R.make, R.state);

  $('rigRecPose').onclick = () => {
    const name = $('rigPoseName').value.trim(), had = R.payload.poses?.[name];
    tryEdit(`${had ? 'recorded over' : 'recorded'} pose ${name}`, (w) => w.recordPose(R.payload, name, pose(), { rest: R.make.rest }));
  };
  $('rigDropPose').onclick = () => { const name = $('rigPoseName').value.trim(); tryEdit(`dropped pose ${name}`, (w) => w.dropPose(R.payload, name)); };
  $('rigRecFrame').onclick = () => {
    const c = cycle(), at = R.frame === null ? c?.frames.length ?? 0 : R.frame + 1;
    tryEdit(`frame ${at} of ${cycleName()}`, (w) => w.recordFrame(R.payload, cycleName(), pose(), { at, fps: +$('rigFps').value || 12 }));
    if (cycle()?.frames[at]) { R.frame = at; frames(); draw(); }
  };
  $('rigReplace').onclick = () => {
    if (R.frame === null) { P.status('rig: pick a frame to replace', true); return; }
    tryEdit(`replaced frame ${R.frame} of ${cycleName()}`, (w) => w.recordFrame(R.payload, cycleName(), pose(), { at: R.frame, replace: true }));
  };
  $('rigDropFrame').onclick = () => {
    if (R.frame === null) { P.status('rig: pick a frame to drop', true); return; }
    const i = R.frame;
    tryEdit(`dropped frame ${i} of ${cycleName()}`, (w) => w.dropFrame(R.payload, cycleName(), i));
    R.frame = null;
    frames();
  };
  $('rigFps').onchange = () => { if (cycle() && R.id) tryEdit(`${cycleName()} at ${$('rigFps').value} fps`, (w) => w.cycleFps(R.payload, cycleName(), +$('rigFps').value)); };
  $('rigCycleName').oninput = () => { R.frame = null; frames(); draw(); };
  $('rigAddSocket').onclick = () => {
    const name = $('rigSocketName').value.trim(), part = $('rigSocketPart').value;
    tryEdit(`socket ${name} on ${part}`, (w) => {
      const b = R.make.inkOf(part, R.make.rest), c = b ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : [0, 0];
      const at = apply(invert(R.make.worldOf(part, R.make.rest, { mirror: false })), c);
      return w.setSocket(R.payload, name, { part, at, angle: 0 }, { view: R.make.views ? R.make.viewOf(R.dir) : undefined });
    });
  };
  $('rigDropSocket').onclick = () => { const name = $('rigSocketName').value.trim(); tryEdit(`dropped socket ${name}`, (w) => w.dropSocket(R.payload, name)); };
  $('rigGrow').onclick = () => { if (R.over) tryEdit('grew the box (the stage fits it by its height: it now draws a little smaller)', (w) => w.growBox(R.payload, R.over)); };
  $('rigUndo').onclick = () => {
    if (!R.undo.length) { P.status('rig: nothing to undo'); return; }
    R.payload = R.undo.pop();
    build(); controls(); draw();
    save('undone');
  };

  // ---------- the rest of the panel ----------

  $('rigPick').onchange = (e) => pick(e.target.value);
  $('rigView').onchange = (e) => { R.dir = +e.target.value; R.state = { ...R.state, dir: R.dir }; draw(); };
  $('rigFrom').onclick = () => fromFrame(false);
  $('rigLoad').onchange = (e) => {
    const [kind, name] = e.target.value.split(':'), m = R.make, keep = m.views ? { dir: R.dir } : {};
    stop();
    if (kind === 'rest') R.state = { ...m.rest, ...keep };
    else if (kind === 'pose') R.state = { ...m.poseOf(name, 1), ...keep };
    else if (kind === 'vocab') R.state = { ...m.rest, ...actor().pose(name, 1), ...keep };
    else if (kind === 'emote') R.state = { ...R.state, ...actor().emote(name) };
    if (kind !== 'emote' && kind !== 'rest') $('rigPoseName').value = name;
    R.frame = null;
    controls(); draw();
  };
  for (const r of document.querySelectorAll('input[name=rigMode]')) r.onchange = () => { R.mode = r.value; R.hover = null; stop(); $('rigSocketRow').hidden = R.mode !== 'sockets'; draw(); };
  $('rigIk').onchange = draw;
  $('rigOnion').onchange = draw;
  $('rigCopy').onclick = async () => {
    const text = JSON.stringify(pose());
    try { await navigator.clipboard.writeText(text); P.status(`copied ${nameOf()}'s state ${text}`); } catch { P.status(`clipboard blocked; state: ${text}`, true); }
  };
  // Plays the cycle in the box, as the film would (its follow parts settled on the loop).
  function stop() { if (R.playing) { clearInterval(R.playing); R.playing = null; $('rigPlay').textContent = 'play'; } }
  $('rigPlay').onclick = () => {
    if (R.playing) { stop(); draw(); return; }
    const name = cycleName();
    if (!R.make?.cycles.includes(name)) { P.status(`rig: no cycle '${name}' to play`, true); return; }
    const c = R.payload.cycles[name], t0 = performance.now();
    R.frame = null;
    $('rigPlay').textContent = 'stop';
    R.playing = setInterval(() => {
      R.state = { ...R.make.frameOf(name, (performance.now() - t0) / 1000), ...(R.make.views ? { dir: R.dir } : {}) };
      draw();
    }, 1000 / (c.fps ?? 12) / 2);
  };

  // ---------- the player's hooks (show: the tab opened; frame: the frame moved while it is open) ----------

  return {
    // The tab is shown, or the frame moved while it is: the list of puppets keeps its '*'.
    show() {
      const list = fillPick();
      if (!R.key && list.length) pick(list[0].key);
      else draw();
    },
    frame() { if (P.S) fillPick(); },
    // After a hot reload: core may be new, the store may have moved (a save, or an edit made elsewhere).
    async reloaded(storeMoved) {
      if (!R.key) return;
      if (R.key.startsWith('cast:')) {
        const a = P.S.cast?.[R.key.slice(5)];
        if (!a) { R.key = null; R.make = null; fillPick(); return draw(); }
        R.make = a.puppet; R.payload = a.puppet.puppet;
      } else {
        if (storeMoved && R.id) {
          await R.saving;
          const res = await fetch(`/__hdf/puppet/${encodeURIComponent(R.id)}`);
          if (res.ok) { const d = (await res.json()).payload; if (JSON.stringify(d) !== JSON.stringify(R.payload)) { R.payload = d; P.status(`rig: ${R.id} changed in the store; reloaded it`); } }
        }
        build();
      }
      fillPick();
      controls();
      draw();
    },
    get state() { return { key: R.key, id: R.id, mode: R.mode, dir: R.dir, state: { ...R.state }, frame: R.frame, grips: (R.grips ?? []).map((h) => ({ id: h.id, at: h.at, px: T ? toPx(h.at).map((v) => v / (devicePixelRatio || 1)) : null })), payload: R.payload }; },
    saved: () => R.saving,
  };
}
