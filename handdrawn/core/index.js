// Author-facing surface of handdrawn. Films import from here and nowhere else.
export {
  circle, ellipse, rect, roundRect, poly, line, cubic, spline, arc, xf, box, len, at, inside, resample, union,
  paper, night, fill, stroke, dots, text, image, group, clip, fx, lookNode, meta,
  hashList, bounds, walk, mapPaths, serialise, parse, translate, rotate, scale, mmul,
} from './list.js';
export {
  FPS, curve, ease, ramp, add, mul, delay, repeat, pingpong, clampC, onTwos, onThrees, follow, pulse, flicker, boil,
} from './curves.js';
export { cel, place, shot, seq, par, hold, cut, lookOn, film, frame, describe, cues } from './tree.js';
export { DIR, JOINT, VIEW_DIRS, puppet } from './puppet.js';
export { RIGS, rigClip, skelOf } from './rig.js';
export { retarget } from './retarget.js';
export { BUILDS, compileStick, stickMap, stickSource } from './stick.js';
export { poseClip } from './pose.js';
export { actorOf, EMOTES, VOCABULARY } from './actor.js';
export { FORMATS, format } from './fit.js';
export { rng } from './rand.js';
export { LOOKS, PASTELS, derive, duotone, pastel, withLook, resolveLook, handOf, mix, tint, shade, alpha } from './looks.js';
export { houseHand, asHand, fallbacks, withHand } from './glyphs.js';
export { handText, signOff, squiggleText, measure, layout, measureBox, textBox, bullets, syllablesOf, speech, VISEMES } from './text.js';
export { reveal } from './tools.js';
export { covAt, radial, linear, plate, knockout, plateOrder, wash, gouache, grain, hatch, hatchIn } from './finish.js';
export { FX, chalkLook } from './fx.js';
export {
  cross, hex, hexCells, hexLattice, aster, dotBurst, speedLines, loops, construction,
  seedDot, ripples, dashedRing, dottedArc, plant, tornEdge, section, stickyNote, bubble, thread, cam, whip,
} from './marks.js';
export { pin, on, onAll, silhouette, shadow, photo, photoFront, mask, rim, backdrop, nightfall, glow } from './photo.js';
export { doodle, pen } from './doodle.js';
export { pentHz, renderScore, toWav16, setPcm, voiceSpans, DUCK_DB } from './synth.js';
export { readWav, decodeWav, voicedSpan } from './wav.js';
export { alignOf, estimateAlign, fitWords, wordsOf, spokenOf } from './align.js';
export { captions } from './captions.js';
export { note, burst, voice, plucks, swell, cueNotes, travel, sparse, impact, dyad, pluckPerSyllable } from '../recipes/score.js';
export { registerClip, registerClips, clipFromStore, clipOf, pose, traced, gap, airborne } from '../engines/traced.js';
export { sim, G, cover, scanFill, circlePts, spiralPts, pathOf, pointAt } from '../engines/sim.js';
export { registerSource } from './sources.js';
export { V3, LIGHT, camera3, proj3, card3, sheet3, stage3d, project, shadows, shadeOf, shadeRole, quadNormal, facing, worldPath } from '../engines/stage3d.js';
export { book3 } from '../recipes/book.js';
