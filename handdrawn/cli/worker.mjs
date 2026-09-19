// Render worker: imports the film, owns a skia canvas and a layer cache, renders the contiguous frame
// ranges the main thread hands it and posts each frame's raw RGBA with the buffer transferred.
import { parentPort, workerData } from 'node:worker_threads';
import { loadFilm } from './load.mjs';
import { frameRenderer } from './frames.mjs';

const { path, opts } = workerData;
const film = await loadFilm(path, { look: opts.look });
const r = frameRenderer(film, opts);

parentPort.on('message', ({ range: [a, b] }) => {
  try {
    r.forget();   // a range starts fresh: its first frame is never a dup of whatever this worker drew last
    for (let i = a; i < b; i++) {
      const { dup, buf } = r.render(i);
      if (dup) { parentPort.postMessage({ i, dup: true }); continue; }
      const ab = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength ? buf.buffer : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      parentPort.postMessage({ i, buf: ab }, [ab]);
    }
    parentPort.postMessage({ done: a });
  } catch (e) {
    parentPort.postMessage({ error: e.stack ?? String(e) });
  }
});
parentPort.postMessage({ ready: true });
