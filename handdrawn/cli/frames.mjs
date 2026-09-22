// Frame production for render and golden: every drawn frame of a film as raw RGBA, delivered in order,
// either in-process (--workers 1) or from a pool of workers each rendering contiguous ranges. Output is the
// same either way; the golden check proves it.
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { format } from '../core/fit.js';
import { skiaBake, skiaCanvas } from './skia.mjs';
import { createRenderer, outputSize } from '../core/raster.js';
import { diskStore } from './store.mjs';
import { imagesOf } from './load.mjs';

export const defaultWorkers = () => Math.max(1, Math.min(4, availableParallelism()));

// One canvas + one cached renderer for a film. render(i) => { dup, buf, shot }.
export function frameRenderer(film, { ar, width, cacheMb = 512, diskCache } = {}) {
  const size = outputSize(ar ? format(ar) : film.format, width);
  const canvas = skiaCanvas(size.outW, size.outH), ctx = canvas.getContext('2d');
  const store = diskCache ? diskStore(typeof diskCache === 'string' ? resolve(diskCache) : resolve('.cache')) : null;
  const r = createRenderer({ cacheMb, makeCanvas: skiaCanvas, store, images: imagesOf(film), bake: skiaBake });
  return {
    size, canvas, stats: r.stats, cache: r.cache,
    render(i) {
      const f = r.renderFrame(ctx, film, i, { ar, width });
      return { dup: f.dup, shot: f.shot, buf: f.dup ? null : canvas.toBufferSync('raw') };
    },
    forget() { r.forget(); },
  };
}

// produceFrames(path, film, opts, onFrame): calls await onFrame(i, buf, dup) for i = 0..n-1 in order.
// A dup frame gets the previous frame's buffer. opts: { ar, width, workers, cacheMb, diskCache, chunk, look, alpha }
// (look and alpha reach the workers, which load the film themselves; the film given here is already loaded with them).
// Returns { size, stats }.
export async function produceFrames(path, film, opts, onFrame) {
  const workers = Math.max(1, Math.min(opts.workers ?? defaultWorkers(), film.n));
  if (workers === 1) {
    const r = frameRenderer(film, opts);
    let last = null;
    for (let i = 0; i < film.n; i++) {
      const { dup, buf } = r.render(i);
      if (!dup) last = buf;
      await onFrame(i, last, dup);
    }
    return { size: r.size, stats: { ...r.stats, workers: 1 } };
  }
  return pool(path, film, { ...opts, workers }, onFrame);
}

async function pool(path, film, opts, onFrame) {
  const { workers, cacheMb = 512 } = opts;
  const size = outputSize(opts.ar ? format(opts.ar) : film.format, opts.width);
  // Ranges of about a second; at most workers + 1 ranges run ahead of the one being written, which
  // bounds the reorder window (and the memory it holds) to a few hundred frames at worst.
  const chunk = opts.chunk ?? Math.max(1, Math.min(12, Math.ceil(film.n / workers)));
  const ranges = [];
  for (let a = 0; a < film.n; a += chunk) ranges.push([a, Math.min(film.n, a + chunk)]);
  const workerOpts = { look: opts.look, alpha: opts.alpha, ar: opts.ar, width: opts.width, diskCache: opts.diskCache, cacheMb: Math.floor(cacheMb / workers) };
  const url = new URL('./worker.mjs', import.meta.url);
  const pending = new Map();
  const stats = { dups: 0, workers };
  let next = 0, nextRange = 0, last = null, failed = null, finished = false, writing = Promise.resolve();
  const idle = [];

  return await new Promise((done, fail) => {
    const ws = [];
    const stop = (e) => {
      if (failed || finished) return;
      failed = e;
      ws.forEach((w) => w.terminate());
      fail(e);
    };
    const dispatch = () => {
      while (idle.length && nextRange < ranges.length && nextRange <= Math.floor(next / chunk) + workers) {
        idle.pop().postMessage({ range: ranges[nextRange++] });
      }
    };
    // Writes buffered frames in order; serialised so onFrame (ffmpeg backpressure) is awaited one at a time.
    const drain = async () => {
      while (!failed && pending.has(next)) {
        const { buf, dup } = pending.get(next);
        pending.delete(next);
        if (!dup) last = buf; else stats.dups++;
        await onFrame(next, last, dup);
        next++;
      }
      dispatch();
      if (next === film.n && !finished) { finished = true; ws.forEach((w) => w.terminate()); done({ size, stats }); }
    };
    for (let k = 0; k < workers; k++) {
      const w = new Worker(url, { workerData: { path: resolve(path), opts: workerOpts } });
      ws.push(w);
      w.on('message', (m) => {
        if (m.error) return stop(new Error(`render worker: ${m.error}`));
        if (m.ready || m.done !== undefined) { idle.push(w); dispatch(); return; }
        pending.set(m.i, { buf: m.dup ? null : Buffer.from(m.buf), dup: !!m.dup });
        writing = writing.then(drain).catch(stop);
      });
      w.on('error', stop);
      w.on('exit', (code) => { if (code !== 0 && next < film.n) stop(new Error(`render worker exited with code ${code}`)); });
    }
  });
}
