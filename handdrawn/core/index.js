// Author-facing surface of handdrawn. Films import from here and nowhere else.
export {
  circle, ellipse, rect, roundRect, poly, line, cubic, spline, arc, xf, box, len, at, inside, resample, union,
  paper, night, fill, stroke, dots, text, image, group, clip, fx, lookNode, meta,
  hashList, bounds, walk, mapPaths, serialise, parse, translate, rotate, scale, mmul,
} from './list.js';
export {
  FPS, curve, ease, ramp, add, mul, delay, repeat, pingpong, clampC, onTwos, onThrees, follow, pulse, flicker, boil,
} from './curves.js';
export { cel, place, shot, seq, par, hold, cut, lookOn, film, frame, describe, cues, chapterSeq, chapters, chapterAt, chapterFilm, excerpt } from './tree.js';
export { DIR, JOINT, VIEW_DIRS, puppet } from './puppet.js';
export { FOLLOW, expandChains } from './follow.js';
export { RIGS, rigClip, skelOf } from './rig.js';
export { retarget } from './retarget.js';
export { BUILDS, FINGERS, compileStick, stickMap, stickSource } from './stick.js';
export { poseClip, advanceOf } from './pose.js';
export { FACE_KEYS, HAND_POSES, faceClip, handsClip, curlsOf, nearestHand, faceState, handsState } from './face.js';
export { actorOf, EMOTES, VOCABULARY } from './actor.js';
export { dialogue } from './dialogue.js';
export { perform, layer } from './perform.js';
export { reach, lookAt, headAt, partAt, feetOf, strideOf, walkTo, stand } from './ik.js';
export { attach, held, propAt, socketAt } from './props.js';
export { AUDIENCES, audienceOf } from './audience.js';
export { FORMATS, format } from './fit.js';
export { rng } from './rand.js';
export { LOOKS, PASTELS, derive, duotone, pastel, withLook, resolveLook, handOf, mix, tint, shade, alpha } from './looks.js';
export { houseHand, asHand, fallbacks, unknowns, withHand } from './glyphs.js';
export { handText, textOnPath, textRound, signOff, squiggleText, measure, layout, measureBox, textBox, bullets, wordBox, syllablesOf, speech, VISEMES, glyphUnits } from './text.js';
export { reveal, penAt } from './tools.js';
export { writeOn, revealed, writing, strokeStarts } from './write.js';
export { writingHand, writer, toolFor, heldTool } from '../packs/hands.js';
export { covAt, radial, linear, plate, knockout, plateOrder, wash, gouache, grain, hatch, hatchIn, streaks } from './finish.js';
export { FX, chalkLook } from './fx.js';
export {
  cross, hex, hexCells, hexLattice, aster, dotBurst, speedLines, loops, construction,
  seedDot, ripples, dashedRing, dottedArc, plant, tornEdge, section, stickyNote, bubble, BUBBLE_KINDS, thread, cam, whip,
  EMPHASIS, underline, circleAround, arrowTo, highlight, strike, bracket, starburst, callout, tickMark, crossMark, question,
} from './marks.js';
export { fraction, equation, tally, numberAxis, clock, dice, coins, pictograph, countOn, countTimes } from './maths.js';
export { pin, on, onAll, silhouette, shadow, photo, photoFront, mask, rim, backdrop, nightfall, glow } from './photo.js';
export { doodle, pen } from './doodle.js';
export { pentHz, renderScore, toWav16, setPcm, voiceSpans, DUCK_DB } from './synth.js';
export { readWav, decodeWav, voicedSpan } from './wav.js';
export { alignOf, estimateAlign, fitWords, wordsOf, spokenOf } from './align.js';
export { mouthFrom, energyMouth, cuesMouth, mouthAt, mouthIndex, MOUTH_SHAPES } from './mouth.js';
export { captions } from './captions.js';
export { note, burst, voice, plucks, swell, cueNotes, travel, sparse, impact, dyad, pluckPerSyllable } from '../recipes/score.js';
export {
  pop, boing, whoosh, ding, tada, tick, squeak, flip, erase, pencilScratch, chalkTap, chalkTaps, hits, writerSounds, eraserSounds,
  bed, barOf, MOODS, SFX_TOOLS,
} from '../recipes/sfx.js';
export { registerClip, registerClips, clipFromStore, clipOf, pose, traced, gap, airborne } from '../engines/traced.js';
export { sim, G, cover, scanFill, circlePts, spiralPts, pathOf, pointAt } from '../engines/sim.js';
export { registerSource } from './sources.js';
export { V3, LIGHT, camera3, proj3, card3, sheet3, stage3d, project, shadows, shadeOf, shadeRole, quadNormal, facing, worldPath } from '../engines/stage3d.js';
export { book3 } from '../recipes/book.js';
