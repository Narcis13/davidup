// Everything the player needs from core, in one module. The player imports it dynamically from the same
// base as the film (`hdf dev` bumps that base on every change so core edits reload too); `hdf bundle`
// walks it statically.
export { createRenderer, outputSize } from '../core/raster.js';
export { frame, describe, cues, place, seedList, withRootLook } from '../core/tree.js';
export { format } from '../core/fit.js';
export { FPS } from '../core/curves.js';
export { SR, filmAudio, scoreEvents, setPcm, voiceIds } from '../core/synth.js';
export { bounds, group, paper, stroke, rect, walk, hashList, withProps } from '../core/list.js';
export { withHand } from '../core/glyphs.js';
export { handOf, hashLook, resolveLook } from '../core/looks.js';
export { register, stored } from '../core/store.js';
export { setMarks } from '../core/cuemarks.js';
// The Rig tab (4.0 W2, player/rig.js): puppets built from a payload, the actor's vocabulary, the workbench.
export { puppet } from '../core/puppet.js';
export { actorOf } from '../core/actor.js';
export * as WB from '../core/workbench.js';
