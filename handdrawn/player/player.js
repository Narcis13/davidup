// The player. Loads a film module and draws its frames with the same core/raster.js the Node renderer
// uses. Three ways in:
//   player.html?film=../films/mini.js[&frame=N&w=720&ar=16:9&look=risoPop]   any static server
//   `hdf dev <film>`      window.HDF = { dev, film, hdf }: module URLs under /v<gen>/, a change event
//                          re-imports the film and core at a new generation and jumps to the first frame
//                          whose list hash moved
//   `hdf bundle <film>`   window.HDF = { film, hdf, assets, catalogue }: bare specifiers resolved by the
//                          import map; a film that names its assets by id reads them off the catalogue
//                          (core/assets.web.js stands in for core/assets.js in both dev and bundle)
// Transport: space play/pause, left/right frame step (shift: shot), home/end, L loop, O onion skin; the
// strip scrubs. Sound is the samples synth.js renders for the Node driver, through Web Audio, started at
// the scrub position. window.__frame(i) and window.__NDRAW stay for drivers.
const q = new URLSearchParams(location.search);
const cfg = window.HDF ?? {};
const $ = (id) => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d'), onion = $('onion'), strip = $('strip');

function sources(gen) {
  if (cfg.dev) return { deps: `/v${gen}/${cfg.hdf}player/deps.js`, film: `/v${gen}/${cfg.film}` };
  if (cfg.film) return { deps: `${cfg.hdf}player/deps.js`, film: cfg.film };
  const film = q.get('film');
  if (!film) throw new Error('add ?film=../films/<name>.js');
  return { deps: new URL('./deps.js', import.meta.url).href, film: new URL(film, location.href).href };
}

// ---------- loading ----------

const decoded = new Map();   // src -> Image, across reloads
async function decode(src) {
  if (!decoded.has(src)) {
    const img = new Image();
    img.src = src;
    decoded.set(src, img.decode().then(() => img));
  }
  return decoded.get(src);
}

async function load(gen) {
  const src = sources(gen);
  // Marks (4.0 D4, --cues-from) are set before the film is imported: it reads them as it builds its timeline.
  const [D, mod] = cfg.marks
    ? await import(src.deps).then(async (d) => { d.setMarks(cfg.marks); return [d, await import(src.film)]; })
    : await Promise.all([import(src.deps), import(src.film)]);
  let film = mod.default;
  if (!film || typeof film !== 'object' || !film.timeline || !Number.isInteger(film.n)) throw new Error(`${src.film}: default export must be film({...})`);
  const look = q.get('look') || cfg.look;   // ?look=<preset>, or --look from hdf dev / hdf bundle
  if (look) film = D.withRootLook(film, look);
  // film.assets is either the 2.0 object ({ id: record }) or the list of store ids the page's catalogue holds.
  const named = Array.isArray(film.assets)
    ? film.assets.map((r) => { const id = typeof r === 'string' ? r : r?.id; return [id, cfg.catalogue?.[id]]; })
    : Object.entries(film.assets ?? {});
  // An asset's URL: a data URL as is, anything else against the film's URL (in dev that is a path, /v<gen>/...).
  const at = (s) => (s.startsWith('data:') ? s : new URL(s, new URL(src.film, location.href)).href);
  const images = new Map();
  for (const [id, a] of named) {
    const s = cfg.assets?.[id] ?? a?.src;
    if (typeof s !== 'string' || !/^data:image\/|\.(png|jpe?g|webp|gif)$/i.test(s)) continue;
    images.set(id, await decode(at(s)));
  }
  // Every record on the page that the film did not read itself goes in the registry, so a voice's word timing
  // (4.0 V2: captions, a voiced say) is found by id, as the store finds it in Node; one the film read with
  // fromStore stays as it was.
  const have = new Set(D.stored());
  D.register(Object.fromEntries([...Object.entries(cfg.catalogue ?? {}), ...named].filter(([id, a]) => id && a && !have.has(id))));
  // Voices (4.0 V1): each sample's wav fetched and decoded before the score is mixed, which is synchronous.
  for (const id of D.voiceIds(D.scoreEvents(film)?.events ?? [])) {
    const s = cfg.assets?.[id] ?? named.find(([k]) => k === id)?.[1]?.src;
    if (typeof s !== 'string') throw new Error(`voice '${id}': no wav on the page (name it in the film's assets; re-run hdf bundle)`);
    const res = await fetch(at(s));
    if (!res.ok) throw new Error(`voice '${id}': ${res.status} fetching its wav`);
    D.setPcm(id, new Uint8Array(await res.arrayBuffer()));
  }
  const ar = q.get('ar') || undefined, fmt = ar ? D.format(ar) : film.format;
  const width = +q.get('w') || Math.round(720 * fmt.W / Math.min(fmt.W, fmt.H));
  const cels = Object.values(mod).filter((v) => typeof v === 'function' && v.cel?.name);
  const lookHash = D.hashLook(film.look);
  return {
    D, film, cels, images, ar, width, size: D.outputSize(fmt, width),
    R: D.createRenderer({ images }), hashes: [],
    hash(i, list) { return (this.hashes[i] ??= D.hashList(list ?? D.frame(film, i, { ar }).list) + lookHash); },
    shots: D.cues(film).shots.map((s) => ({ ...s, f0: Math.round(s.t0 * D.FPS), n: Math.round(s.dur * D.FPS) })),
    lines: D.describe(film).split('\n'),
  };
}

// ---------- state ----------

let S = null, cur = 0, playing = null, changed = new Set(), scanning = null;
const n = () => S.film.n;
const status = (msg, err = false) => { $('status').textContent = msg; $('status').classList.toggle('err', err); };

function show(i, { quiet = false } = {}) {
  i = Math.max(0, Math.min(n() - 1, i | 0));
  const { D, film, size } = S;
  if (cv.width !== size.outW || cv.height !== size.outH) { cv.width = onion.width = size.outW; cv.height = onion.height = size.outH; S.R.forget(); }
  const f = S.R.renderFrame(ctx, film, i, { ar: S.ar, width: S.width });
  S.hash(i, f.list);
  S.shown = f;
  cur = i;
  if (!quiet && !playing) drawOnion();
  else onion.getContext('2d').clearRect(0, 0, onion.width, onion.height);
  const moved = changed.has(i) ? '  Δ changed' : '';
  $('info').textContent = `${film.name}  ${String(i).padStart(3, '0')}/${film.n - 1}  ${(i / D.FPS).toFixed(2)}s  ${f.shot}  ${size.outW}x${size.outH}${moved}`;
  drawStrip();
  markShots();
  if (!playing) celPanel(f.list);
  return f.shot;
}
window.__frame = (i) => show(i);

// ---------- onion skin ----------

// The strokes (and text) of frames i-1 and i+1, redrawn with the chalk tool and tinted, at low alpha. Only
// when paused. Fills, dots and images are left out so the neighbours read as line drawings.
const ONION = [['#d0443c', -1], ['#2f7fd0', 1]];
let scratch = null;
function drawOnion() {
  const g = onion.getContext('2d');
  g.clearRect(0, 0, onion.width, onion.height);
  fitOnion();
  drawBoxes(g);
  if (!$('onionOn').checked) return;
  const { D, film, size } = S;
  scratch ??= document.createElement('canvas');
  scratch.width = size.outW; scratch.height = size.outH;
  const sg = scratch.getContext('2d');
  S.onionR ??= D.createRenderer({ cacheMb: 0, dedup: false, images: S.images });
  for (const [colour, d] of ONION) {
    const j = cur + d;
    if (j < 0 || j >= film.n) continue;
    const ops = [];
    D.walk(D.frame(film, j, { ar: S.ar }).list, (op, m) => {
      if (op.op !== 'stroke' && op.op !== 'text') return;
      ops.push(D.group({ xf: m, cache: 'never' }, [D.withProps(op, { tool: 'chalk' })]));
      return false;
    });
    sg.globalCompositeOperation = 'source-over';
    sg.clearRect(0, 0, scratch.width, scratch.height);
    S.onionR.draw(sg, ops, { look: film.look, S: size.S, W: size.W, H: size.H });
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = colour;
    sg.fillRect(0, 0, scratch.width, scratch.height);
    g.globalAlpha = 0.35;
    g.drawImage(scratch, 0, 0);
    g.globalAlpha = 1;
  }
}
// The box of every text op and lettered group (a handText, textBox or bullets group) in the frame shown, in
// the hand of its shot: what bounds() and lint's cel-box rule see.
function drawBoxes(g) {
  if (!$('boxesOn').checked || !S.shown) return;
  const { D, size } = S, { list, look } = S.shown, boxes = [];
  D.withHand(D.handOf(look), () => D.walk(list, (op, m) => {
    const lettered = op.op === 'text' || (op.op === 'group' && typeof op.name === 'string' && /^(text|bullets):/.test(op.name));
    if (!lettered) return;
    const b = D.bounds([op], m);
    if (b) boxes.push(b);
    return false;
  }));
  g.save();
  g.setTransform(size.S, 0, 0, size.S, 0, 0);
  g.strokeStyle = '#2f7fd0';
  g.lineWidth = 1.5 / size.S;
  g.setLineDash([6 / size.S, 4 / size.S]);
  for (const [x, y, w, h] of boxes) g.strokeRect(x, y, w, h);
  g.restore();
}
function fitOnion() {
  Object.assign(onion.style, { left: `${cv.offsetLeft}px`, top: `${cv.offsetTop}px`, width: `${cv.offsetWidth}px`, height: `${cv.offsetHeight}px` });
}

// ---------- strip: shots, changed frames, playhead; drag to scrub ----------

function drawStrip() {
  const dpr = devicePixelRatio || 1, w = strip.clientWidth, h = strip.clientHeight;
  if (strip.width !== Math.round(w * dpr)) { strip.width = Math.round(w * dpr); strip.height = Math.round(h * dpr); }
  const g = strip.getContext('2d'), N = n(), x = (i) => (i / N) * w;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = '10px Menlo, monospace';
  g.textBaseline = 'middle';
  S.shots.forEach((s, j) => {
    g.fillStyle = j % 2 ? '#262626' : '#303030';
    g.fillRect(x(s.f0), 0, x(s.f0 + s.n) - x(s.f0), h - 8);
    g.fillStyle = '#8a8a8a';
    g.save(); g.beginPath(); g.rect(x(s.f0), 0, x(s.f0 + s.n) - x(s.f0) - 2, h); g.clip();
    g.fillText(s.name, x(s.f0) + 4, (h - 8) / 2);
    g.restore();
  });
  g.fillStyle = '#3a3a3a';
  g.fillRect(0, h - 6, x(S.hashes.filter(Boolean).length), 2);   // how far the hash scan has got
  g.fillStyle = '#e2574c';
  for (const i of changed) g.fillRect(x(i), h - 6, Math.max(1, x(1)), 6);
  g.fillStyle = '#f0a23a';
  g.fillRect(x(cur), 0, Math.max(2, x(1)), h);
}

let dragging = false;
const seekAt = (e) => {
  const r = strip.getBoundingClientRect(), i = Math.floor(((e.clientX - r.left) / r.width) * n());
  if (i !== cur || !dragging) { if (playing) stop(); show(i, { quiet: true }); grain(); }
};
strip.addEventListener('pointerdown', (e) => { dragging = true; strip.setPointerCapture(e.pointerId); seekAt(e); });
strip.addEventListener('pointermove', (e) => { if (dragging) seekAt(e); });
strip.addEventListener('pointerup', () => { dragging = false; show(cur); });

// ---------- shot list (describe) ----------

// Lines with a [t0-t1] span jump to t0; lines spanning the current time light up.
function shotList() {
  const box = $('shots');
  box.replaceChildren(...S.lines.map((line) => {
    const el = document.createElement('div'), m = line.match(/\[(\d+\.\d+)-(\d+\.\d+)\]/);
    el.textContent = line;
    el.title = line;
    if (m) {
      el.className = 'jump';
      el.dataset.f0 = Math.round(+m[1] * S.D.FPS);
      el.dataset.f1 = Math.round(+m[2] * S.D.FPS);
      el.onclick = () => { if (playing) stop(); show(+el.dataset.f0); };
    }
    return el;
  }));
}
function markShots() {
  for (const el of $('shots').children) {
    if (!el.dataset.f0) continue;
    const a = +el.dataset.f0, b = +el.dataset.f1;
    el.classList.toggle('here', cur >= a && cur < b);
    el.classList.toggle('moved', [...changed].some((i) => i >= a && i < b));
  }
}

// ---------- cel panel ----------

// The film module's exported cels; the ones drawn in the current frame come first (marked *). One slider per
// declared input, starting at the values the frame used; the preview draws the cel alone on paper.
let celPick = null, celVals = {}, celFrom = null;
function celPanel(list) {
  const sel = $('cel');
  if (!S.cels.length) { sel.replaceChildren(new Option('no cels exported by the film module', '')); $('inputs').replaceChildren(); preview(); return; }
  const used = new Map();
  S.D.walk(list, (op) => { if (op.op === 'group' && op.cel && !used.has(op.cel)) used.set(op.cel, op.inputs ?? {}); });
  const names = S.cels.map((c) => c.cel.name).sort((a, b) => used.has(b) - used.has(a));
  const key = names.map((x) => (used.has(x) ? '*' : '') + x).join();
  if (sel.dataset.key !== key) {
    sel.replaceChildren(...names.map((x) => new Option(`${used.has(x) ? '* ' : '  '}${x}`, x)));
    sel.dataset.key = key;
  }
  if (!celPick || !names.includes(celPick)) celPick = names[0];
  sel.value = celPick;
  // Follow the frame's values until a slider is moved on this frame.
  if (celFrom !== `${cur}:${celPick}` && used.has(celPick)) celVals = { ...used.get(celPick) };
  celFrom = `${cur}:${celPick}`;
  sliders();
}
$('cel').onchange = (e) => { celPick = e.target.value; celVals = {}; celFrom = null; celPanel(S.D.frame(S.film, cur, { ar: S.ar }).list); };

function sliders() {
  const make = S.cels.find((c) => c.cel.name === celPick), rows = [];
  for (const [k, spec] of Object.entries(make?.cel.inputs ?? {})) {
    if (!Array.isArray(spec)) continue;
    const [lo, hi, step] = spec, set = celVals[k] !== undefined;
    const row = document.createElement('label'), input = document.createElement('input'), out = document.createElement('output');
    Object.assign(input, { type: 'range', min: lo, max: hi, step: step > 0 ? step : (hi - lo) / 200, value: set ? celVals[k] : lo });
    out.textContent = set ? celVals[k] : 'default';
    row.className = set ? '' : 'unset';
    input.oninput = () => { celVals[k] = +input.value; out.textContent = input.value; row.className = ''; preview(); };
    row.append(k, input, out);
    rows.push(row);
  }
  $('inputs').replaceChildren(...rows);
  preview();
}

function preview() {
  const p = $('preview'), g = p.getContext('2d'), make = S.cels.find((c) => c.cel.name === celPick);
  g.clearRect(0, 0, p.width, p.height);
  if (!make) return;
  const { D } = S, cel = make(celVals), [bx, by, bw, bh] = make.cel.box ?? cel.box ?? [-100, -100, 200, 200];
  const C = Math.max(bw, bh) * 1.15;
  const list = D.seedList([D.paper(), D.place(C / 2 - bx - bw / 2, C / 2 - by - bh / 2, D.group('frame', [D.stroke(D.rect(bx, by, bw, bh), 'guide', { w: 1, wobble: 0 }), cel]))], 1);
  S.celR ??= D.createRenderer({ cacheMb: 0, dedup: false, images: S.images });
  S.celR.draw(g, list, { look: S.film.look, S: p.width / C, W: C, H: C });
}

$('copy').onclick = async () => {
  const text = JSON.stringify(celVals);
  try { await navigator.clipboard.writeText(text); status(`copied ${celPick}(${text})`); } catch { status(`clipboard blocked; values: ${text}`, true); }
};

// ---------- sound ----------

let ac = null, buffer = null;
function audio() {
  ac ??= new AudioContext();
  if (buffer === undefined || buffer) return buffer;
  const a = S.D.filmAudio(S.film);
  buffer = a ? ac.createBuffer(1, a.samples.length, S.D.SR) : undefined;
  buffer?.copyToChannel(a.samples, 0);
  return buffer;
}

// A 1/12 s slice at the scrub position, faded in and out so dragging does not click.
function grain() {
  const b = audio();
  if (!b) return;
  const src = ac.createBufferSource(), g = ac.createGain(), t = ac.currentTime + 0.01, d = 1 / S.D.FPS;
  src.buffer = b;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.8, t + 0.008); g.gain.setValueAtTime(0.8, t + d - 0.012); g.gain.linearRampToValueAtTime(0, t + d);
  src.connect(g).connect(ac.destination);
  src.start(t, cur / S.D.FPS, d);
}

function stop() { playing?.src?.stop(); playing = null; $('play').textContent = 'play'; show(cur); }

function play(from = cur >= n() - 1 ? 0 : cur) {
  const b = audio(), t0 = ac.currentTime + 0.05, p = { src: null };
  if (b) {
    p.src = ac.createBufferSource();
    p.src.buffer = b;
    p.src.connect(ac.destination);
    p.src.start(t0, from / S.D.FPS);
  }
  playing = p;
  $('play').textContent = 'pause';
  const tick = () => {
    if (playing !== p) return;
    const i = from + Math.floor(Math.max(0, ac.currentTime - t0) * S.D.FPS);
    if (i >= n()) {
      p.src?.stop();
      playing = null;
      if ($('loop').checked) return play(0);
      $('play').textContent = 'play';
      return show(n() - 1);
    }
    if (i !== cur) show(i);
    requestAnimationFrame(tick);
  };
  tick();
}

// ---------- input ----------

const toggle = () => (playing ? stop() : play());
const step = (d) => { if (playing) stop(); show(cur + d); grain(); };
const shotStep = (d) => {
  if (playing) stop();
  const starts = [...new Set(S.shots.map((s) => s.f0))].sort((a, b) => a - b);
  const to = d > 0 ? starts.find((f) => f > cur) ?? n() - 1 : [...starts].reverse().find((f) => f < cur) ?? 0;
  show(to);
};
$('play').onclick = toggle;
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('onionOn').onchange = () => drawOnion();
$('boxesOn').onchange = () => drawOnion();
addEventListener('resize', () => { fitOnion(); drawStrip(); });
addEventListener('keydown', (e) => {
  if (!S || e.target.tagName === 'INPUT' && e.target.type === 'range' || e.metaKey || e.ctrlKey) return;
  const k = e.key;
  if (k === ' ') toggle();
  else if (k === 'ArrowLeft') (e.shiftKey ? shotStep(-1) : step(-1));
  else if (k === 'ArrowRight') (e.shiftKey ? shotStep(1) : step(1));
  else if (k === 'Home') { if (playing) stop(); show(0); }
  else if (k === 'End') { if (playing) stop(); show(n() - 1); }
  else if (k === 'l' || k === 'L') $('loop').checked = !$('loop').checked;
  else if (k === 'o' || k === 'O') { $('onionOn').checked = !$('onionOn').checked; drawOnion(); }
  else if (k === 'b' || k === 'B') { $('boxesOn').checked = !$('boxesOn').checked; drawOnion(); }
  else return;
  e.preventDefault();
});

// ---------- hashes and hot reload ----------

// Hashes every frame a slice at a time so the page stays live. With `prev`, compares against it: frames whose
// hash moved go in `changed`, and the first one is shown as soon as it is found.
async function scan(prev) {
  const me = (scanning = {}), s = S, found = [];
  let jumped = !prev, t = performance.now();
  for (let i = 0; i < s.film.n; i++) {
    if (scanning !== me) return;
    s.hash(i);
    if (prev && (i >= prev.film.n || prev.hash(i) !== s.hash(i))) {
      changed.add(i);
      found.push(i);
      if (!jumped) { jumped = true; if (!playing) show(i); }
    }
    if (performance.now() - t > 30) {
      if (prev) status(`reloaded; comparing frames ${i + 1}/${s.film.n}  (${found.length} changed so far)`);
      drawStrip();
      await new Promise((r) => setTimeout(r, 0));
      t = performance.now();
    }
  }
  scanning = null;
  if (prev) {
    const gone = Math.max(0, prev.film.n - s.film.n);
    status(found.length || gone
      ? `reloaded: ${found.length} of ${s.film.n} frames changed${found.length ? `, first ${found[0]}` : ''}${gone ? `; ${gone} frames fewer` : ''}`
      : 'reloaded: no frame changed');
    markShots();
  }
  drawStrip();
  window.__hdf.scans++;
}

let reloading = null, again = false;
async function reload() {
  if (reloading) { again = true; return; }
  reloading = (async () => {
    do {
      again = false;
      let next;
      try { next = await load(Date.now()); } catch (e) { status(`reload failed: ${e.message ?? e}`, true); console.error(e); continue; }
      const prev = S;
      if (playing) { playing.src?.stop(); playing = null; $('play').textContent = 'play'; }
      S = next;
      buffer = null;
      changed = new Set();
      celFrom = null;
      shotList();
      show(Math.min(cur, n() - 1), { quiet: true });
      await scan(prev);
      window.__hdf.reloads++;
    } while (again);
  })();
  await reloading;
  reloading = null;
}

window.__hdf = { reloads: 0, scans: 0, get cur() { return cur; }, get changed() { return [...changed].sort((a, b) => a - b); }, reload };

async function main() {
  S = await load(0);
  window.__NDRAW = S.film.n;
  document.title = `${S.film.name} - handdrawn`;
  shotList();
  show(Math.min(n() - 1, Math.max(0, +q.get('frame') || 0)));
  if (cfg.dev) {
    const es = new EventSource('/__hdf/events');
    es.addEventListener('change', (e) => { status(`changed: ${JSON.parse(e.data).files.join(', ')}`); reload(); });
    es.onerror = () => status('dev server gone; reload the page when it is back', true);
  }
  scan(null);
}

main().catch((e) => { status(String(e.message ?? e), true); $('info').textContent = 'failed'; console.error(e); });
