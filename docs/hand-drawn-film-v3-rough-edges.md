# hand-drawn film 3.0: rough edges from the showcase film

Found on 2026-09-21 while making `handdrawn/work/pink-octopus/pink-octopus.js`
(33 s, every look, three engines, the user's octopus SVG as a puppet) with the
3.0 skill. Each item is one fix for a future coding session. None blocked the
film; each cost a detour.

| # | where | what happened | fix |
|---|---|---|---|
| RE-1 | `cli/hdf.mjs` error path | Any command that throws (`hdf svg` on a lint refusal, `hdf sheet store` on a missing id, a film that fails to load) prints the whole USAGE block after the error, so the one line that matters (the lint finding, the missing-id message) scrolls off. Seen five times. | Print USAGE only for an unknown command or bad flags; a thrown `Error` prints its message and stack, nothing else. |
| RE-2 | `hdf svg` box | An imported puppet's box is the viewBox, so any pose or cycle that swings a part outside the artwork's own bounds fails `cel-box` on import. The author has to guess a wider viewBox and reimport (three rounds for the octopus: wave arm, then swim frame 0, then the run). | Compute the box from every pose, view and cycle frame at import (the lint already draws them all), pad it, and write that into the payload; keep the viewBox only as the drawing's own frame. Or at least print the union box so the second round is the last. |
| RE-3 | `~from:<id>` in a shot's look | `looks.md` says modifiers work in a shot's `look`. In a doodle recipe (`becomesVehicle({ look: 'doodlePastel~from:violin' })`) the recipe resolves the look at module load, before the loader has the film's assets, and `assetRecord` throws "a '~from:' look needs the film's assets". Workaround: `derive(L('doodlePastel'), { from: PHOTOS.violin })`. | Let `resolveLook` read `~from:` through the store registry the way `~hand:` does after `fromStore()` (the cutout record is already registered by then), or resolve recipe looks lazily at first draw. Document the `fromStore` first rule for both modifiers. |
| RE-4 | `~hand:<id>` at module load | `withLook('pencilMinimal~hand:test', { words: 3 })` at module top level throws "no hand 'test' in the store" unless `fromStore([... 'test'])` ran first. The skill says a pinned hand only needs to be in `assets:`; that is true for `film({ look })` but not for a shot look built with `withLook`. | Same as RE-3: one rule, "read every id with `fromStore` before any look is built", stated in the skill's Pitfalls; or make `resolveLook` fall back to reading the catalogue directly. |
| RE-5 | `test/cli.test.js` "living packs" | Asserted `12 of N in assets` for `hdf find --kind puppet`, so importing any puppet into the store (the whole point of 3.0) fails the suite. Fixed in this session: ≥ 12 and exactly eleven `pack:` mirrors. | Done. Watch for other tests that count store entries (`hdf find` totals). |
| RE-6 | `cut(kind, dur, a, b)` | Reads as if it wraps `a` and `b`, but it is a transition between `a`'s last frame and `b`'s first, and both shots must still be in the `seq` (`seq(a, cut('iris', .5, a, b), b)`). The first `hdf board` silently dropped 3.5 s of film. `api.md` and the skill's one-line description do not say this. | One sentence in the skill and in `recipes.md` "Timing and editing", with the `seq(a, cut(...), b)` shape; or make `cut` return the triple so `seq(cut(...))` is the whole thing. |
| RE-7 | `hdf svg --kind motif` | Imports fine but writes no sheet and says nothing about it (`assets/sheets/` unchanged), while puppets get one. | Write a motif sheet (the drawing at three scales in every look) or print "no sheet for a motif". |
| RE-8 | no `hdf remove` | A trial import (`octo-raw`) and a replaced puppet's old blob stay in the store forever; the catalogue had to be edited by hand and the orphan blobs deleted with `rm`. Re-serialising the catalogue with a normal JSON writer produced a 2300-line diff (the file is one entry per line). | `hdf remove <id>` (drops the entry, deletes a blob no other entry shares) and `hdf gc` for orphan blobs. Document the one-entry-per-line format in `assets.md`. |
| RE-9 | recipe A `establishing` with an actor | `scale` is the only size control and the actor rides on `actorFigure(..., 140)`, so a puppet reads small (2.4 to 3.2 stage units gave a subject a fifth of the frame); pushing `scale` past 4 trips `subject-crop` because the recipe's push camera zooms the anchor over the edge. Three lint rounds. | Let `actor:` take an `h` (the figure height) on A, U, W, X, Z, and clamp the push so the anchor stays inside; or have lint name the scale that would fit. |
| RE-10 | `hdf sheet store <id> --poses` model sheet | "3 poses" in the header counts the poses after `rest`, and the poses row omits `rest`, so the sheet never shows the puppet's neutral standing pose next to the others. | Draw `rest` first in the poses row, count it. |
| RE-11 | chase-style shots with two actors | Nothing in the package says which actor draws over which beyond list order, and a puppet placed with `place()` at a higher `y` gets no ground of its own; the octopus "hovered" until a far floor line was drawn by hand. | A note in the skill: a second ground line for an actor further back; or `place(x, y, s, { shadow: true })`. |
| RE-12 | goldens on this Mac | `npm test` fails `every film matches its golden` and `mini under --look 'paperInk~hand:test'` on a clean HEAD before any change (36/54 frames of mini differ under the test hand). Not a regression from this session. | Regenerate the darwin-arm64 goldens once, or key the hand goldens by platform like the text-v2 keys. |

## Status (2026-09-21, fix session)

All twelve are closed; `npm test` in `handdrawn/` is 221/221 (it was 219/221).

| # | outcome |
|---|---|
| RE-1 | `cli/hdf.mjs`: a usage error prints `hdf: <message>` and `(hdf help <cmd> for its usage)`; any other error its stack; USAGE only for an unknown command. `hdf help <cmd>` prints that command's lines. |
| RE-2 | `hdf svg` widens a puppet's box to every rest/view/pose/variant/cycle drawing (padded 3%, whole units), prints it with the poses that needed it, and keeps the viewBox as `frame` (`puppetCases` / `puppetReach` in `core/lint.js`, `widen` in `cli/svg.mjs`). |
| RE-3, RE-4 | `core/store.js` `peek(id)`: the registry, then a reader `core/assets.js` installs (the store next to the package). `~from:` and `~hand:` resolve through it, so a recipe look or a top-level `withLook` works before `fromStore`. Engines keep the strict `record()`. |
| RE-5 | Done earlier. |
| RE-6 | Lint rule `cut-orphan` (a cut whose outgoing or incoming shot never plays outside it); `cut`'s comment, api.md, SKILL.md and recipes.md say `seq(a, cut(...), b)`. |
| RE-7 | `hdf sheet store <motif>` draws the motif at 3 scales in every look; `hdf svg --kind motif` writes it. |
| RE-8 | `hdf remove <id...>` (entry, sheets, unshared blob; `pack:` needs `--force`) and `hdf gc [--dry]`; the one-entry-per-line format is in assets.md. |
| RE-9 | `h` on A, G, M, U, W, X, Z fits the actor by its rest pose's drawing (not the rig box) and boxes it by what it draws; recipe A's push stops short of cutting the subject unless `crop: true`. |
| RE-10 | The model sheet's poses row starts with `rest`, and the header counts it. |
| RE-11 | `actor.place(x, y, s, { shadow: true })` puts a contact shadow on the actor's floor; the skill's Pitfalls say paint the far actor first. |
| RE-12 | Not environment after all: `films/goldens/{cutout-fox,fox-and-teapot,mini-paperInk~hand:test}.json` were committed stale (they fail at the commits that wrote them, on Node 20/24/25/26 alike, with 1 or 4 workers). The copies in the skill's `examples/goldens/` already matched the regenerated files byte for byte. Regenerated with `--workers 1`. |

## What worked without a detour

- `hdf svg` rig conventions (parts, pivots, variants, `mouth-0..3`, `pose:`,
  `cycle:`, three `view:` groups with a `transform` on each part) imported the
  hand-rigged octopus first time once the box was wide enough; the model sheet
  showed the turnaround, expressions and both cycles correctly.
- `actorOf(puppet('octopus'))` went straight into A, B, X, U, W, AC, AA, AJ,
  AF, `book3` pieces and a custom shot with `FOX.cycle('gallop')`, with no
  change to any recipe.
- `say()`, the cut-out finish (fasteners on the arm joints), `lookOn`-free
  per-shot looks, the iris cut, `sim` gestures, `hdf-to-davidup.ts` (video +
  two model sheets registered into a fresh `davidup new` project).
