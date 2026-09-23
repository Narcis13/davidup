# hand-drawn film 4.0: plan for the rough edges

A plan to close the sixteen items in `hand-drawn-film-v4-rough-edges.md`, found while making the 4.0
acceptance film (`handdrawn/work/moon/`). Written 2026-09-23 against `c8e2eed`.

It takes the same shape as the v4 plan. There is one session per block and one commit per session
(`hdf: RE4-<n> <title>`). Each session keeps `npm test` in `handdrawn/` green apart from the known golden tests,
and every film's golden must hold unless the session names that film. Run `node cli/apidoc.mjs` whenever the
API changes.

Two of the sixteen need no code. RE-15 is a paragraph in the skill (session 6), and RE-16 is the user
photographing their hand pages.

**Known baseline on this Intel Mac.** Six golden tests fail on a clean HEAD (`films.test.js` "every film",
and `mini` under four looks and plain). Compare against a HEAD worktree, not against zero. For editor tests,
run `npm run build` and then `bun install` first, since the editor runs from a snapshot.

---

## Order

| # | session | closes | size | why this order |
|---|---|---|---|---|
| 1 | Lessons at any aspect | RE-1, RE-2 | half a day | The largest surprise. It decides whether the moon film goes back to 16:9. |
| 2 | Puppets from paper that talk | RE-3, RE-4, RE-5 | most of a day | Deletes `graft-face.mjs` and the role remap, the two hand-written scripts the film needed. |
| 3 | Voice tools that fail loudly | RE-6, RE-7 | a few hours | Silent success on bad data is the worst kind of bug. Small and contained. |
| 4 | Recipes you can build on | RE-8, RE-9, RE-10 | half a day | Makes the moon film a committed fixture and removes its copied recipe arithmetic. Needs session 1 so the fixture is 16:9. |
| 5 | Looks that know the board | RE-11, RE-12 | half a day | Removes the second moon cel set and the chapter-wide ghost compromise. |
| 6 | davidup and the skill | RE-13, RE-14, RE-15 | half a day | The bridge's two small leaks, then the skill text for everything above. |

About three days in all. Sessions 1, 2, 3 and 5 are independent of one another. Session 4 wants session 1,
and session 6's skill text comes last.

---

## 1. Lessons at any aspect (RE-1, RE-2)

**RE-1: the teaching recipes draw on the left of a 16:9 frame.** `recipes/recipe.js` `recipe()` gains a
`square` flag. With it set, when `ctx.W !== 1080 || ctx.H !== 1080`, the layer is drawn with
`{ ...ctx, W: 1080, H: 1080, CX: 540, CY: 540 }` and wrapped in
`group({ name: 'square', xf: translate((W - 1080) / 2, (H - 1080) / 2) })`. The ground op (paper, night) and the
anchor and intent metas stay outside the group. This is the moon film's `wide()`, moved into the package.
- Every teaching recipe AN to AY sets `square: true`. So does the card `chapter()` makes, since it is a
  `titleCard`.
- Recipes A to Z keep their behaviour. Their 16:9 renders are in goldens, and they already lay out on `W`
  where it matters.
- `R.layer` stays unwrapped for films that compose layers themselves. A new `R.squareLayer(ctx, o)` returns
  the wrapped ops.
- 9:16 gets the same wrap, vertically. It's worth a test, because the presenter's feet at `y = 1010` sit on
  the square, not on the tall frame.

**RE-2: `text-size` and `subject-size` score by frame width.** `core/lint.js` lines 239 and 266 compute
`* 240 / env.W`. Change both to `* 240 / Math.min(env.W, env.H)`, which is the package's own rule: logical
units put the short side at 1080. At 1:1 and 9:16 (short side W) every number is unchanged; at 16:9 the frame
is measured as if its 1080 px short side were 240 px wide, the square's scale. Update the rule texts in `RULES`
(lines 29 and 40) from "at 240 px wide" to "at 240 px on the short side", and the `minX` comment in
`core/audience.js`.

**Files:** `recipes/recipe.js`, `recipes/teach.js` (the flag on 12 recipes), `core/lint.js`,
`core/audience.js`, `references/api.md` (via apidoc), and a new test in `test/teach4.test.js` or
`test/legible.test.js`.

**Done when:**
- `lesson.js` rendered with `--ar 16:9` has every teaching anchor's box centred in the frame to within 1 px.
- `hdf lint films/lesson.js --ar 16:9` gives exactly the findings the 1:1 lint gives.
- The moon film with `format: '16:9'` and `wide()` deleted lints clean for kids-7.
- Every 1:1 golden holds, since the lint change moves no pixel and the wrap is the identity at 1080.

---

## 2. Puppets from paper that talk (RE-3, RE-4, RE-5)

**RE-3: a face for a sketched puppet.** Move `work/moon/graft-face.mjs` into the package as
`core/stick.js` `graftFace(payload, { r, views })`:
- Compile a stick with the payload's `skeleton` joints (hip, chest, neck, head) and head radius `r`.
- Copy `eye`, `pupil`, `brow-l`, `brow-r` and `mouth` into the payload's views, inserted after `head` in
  painter order.
- Merge `inputs` (eye, mouth) and `poses.rest`.

`r` defaults to `RIG.headR * K * 23 / 26`, the size a head fills its guide circle at. A `--face-r` flag
overrides it.
- `hdf sketch ... --face stick` runs it before `putPayload`. Keep `--face none` as the default, because a
  child's own drawn face is the point of W1.
- The auto-rig path (W3, `--auto`) takes the same flag.
- The rig sheet's printed instructions gain one line: "for a face that talks, leave the face off and use
  `--face stick`".

**RE-4: roles for a sketch.** Three changes in `core/rigsheet.js` `rolesOf`:
1. A `--roles` map as `hdf svg` takes it (`#hex=role,...` or a JSON file). Given colours are matched by
   nearest hex within `distance < 0.15` (the `distance` in `core/svg.js`). `ask` prints the table and stops,
   as svg does.
2. Skin: a colour with hue 15 to 45°, saturation 0.25 to 0.7 and lightness 0.55 to 0.85 goes to `fills.5`,
   the peach on the boards and a tan on paperInk. Check that `fills.5` exists in all eleven looks; paperInk has
   four fills, and `+idx % v.length` wraps, so skin there would come out as `fills.1`. Either give paperInk,
   pencilMinimal, blueprintNight and cutout a sixth fill, or pick the index per look with the RE-11 mechanism.
   **Decide first: skin as a named role `skin` in every palette is the cleaner answer, and it touches the
   eleven presets.**
3. A dark *fill* is not ink when the lines are darker. If the pen's colour is darker than a fill by at least
   0.12 in lightness, that fill goes to `shade`.

**RE-5: near-paper fills.** In `readBox` (`core/rigsheet.js`), a closed line enclosing an area the sketch
reads as paper, inside the silhouette, is kept as a fill in `light` when it is more than 3% of the piece's
area. This catches the pompom and an eye's white. The model-sheet check in the skill gains "and once in a dark
look (`--look chalkboard`)", because a `light` or `paper` fill on skin is invisible on the whiteboard.

**Files:** `core/stick.js`, `core/rigsheet.js`, `cli/sketch.mjs`, possibly `core/looks.js` (the `skin`
role), `test/rigsheet.test.js`, `test/autorig.test.js`, and `references/assets.md`.

**Done when:**
- `hdf sketch work/moon/sam-side.jpg work/moon/sam-front.jpg --name sam --face stick` (the sheets
  `sam-sheet.mjs` draws) makes a puppet that renders the moon film's `sam` with no script.
- On the whiteboard: skin is peach, the jumper blue and the trousers `shade`.
- The pompom is filled, and every expression shows on the model sheet in chalkboard.
- `graft-face.mjs` is deleted.
- The test figure's roles are unchanged without `--roles`, except skin, so check its model sheet.
- The stored `sam` is re-imported and the moon film re-rendered. Its frames change only where the pompom and
  the roles did.

---

## 3. Voice tools that fail loudly (RE-6, RE-7)

**RE-6: whisper's ghost words.** Three changes, in `cli/align.mjs` `transcribe` and `core/align.js`:
1. Before fitting, drop the trailing run of words that are zero-length or start within 0.05 s of the file's
   end, and drop any word starting after the voiced span `voicedSpan` already finds, plus 0.3 s.
2. After fitting, if the fitted span (last `t1` minus first `t0`) is under 50% of the voiced span, throw
   `align: the transcriber's timing covers only X s of Y s voiced`. Name `--json` and the prompt as the
   likely cause.
3. Stop passing the copy as `initial_prompt` by default. `fitWords` exists to lay heard words onto the copy.
   Keep `--prompt` to opt back in for names whisper misspells.

Save this session's bad transcript (the 64-word `moon-sun` output) as `test/fixtures/whisper-ghosts.json` and
test both the trim and the throw with it. No whisper install is needed for the test.

**RE-7: Rhubarb that dies.** In `cli/align.mjs` `rhubarb()`: when `r.status === null` or `r.signal` is
set, write `align: rhubarb was killed by <signal>; storing the energy track` to stderr. Then return null so
`mouth()` takes the energy path it already has. A non-zero exit with stderr stays an error. A mocked
`RHUBARB` script that does `kill -SEGV $$` tests it.

**Files:** `cli/align.mjs`, `cli/align.py` (a `--prompt` flag; `--text` no longer prompts),
`core/align.js`, `test/align.test.js`, `test/mouth.test.js`, and a fixture.

**Done when:**
- `hdf align moon-sun` on the stored wav, with whisper installed, stores 32 words over 8.9 s with no `--json`
  step.
- The fixture test passes with no python.
- A killed Rhubarb stores the energy track and says why.
- Every stored alignment and mouth in the catalogue is untouched: the session re-runs nothing.

---

## 4. Recipes you can build on (RE-8, RE-9, RE-10)

**RE-8: a recipe's parts, public.** Two routes. Take the first; it is smaller and matches `quizTimes`:
- **Plans as exports.**
  - `labelledPlan(o)` returns `{ labels: [{ t0, lead, w1, from, box }], end }`. The box is each word's ink
    box, built from `labelFroms` and the same `letters()` call.
  - `titlePlan(o)` returns `{ t0, t1, u1, t2, end, title, swash, sub }`, where the nodes are the ones the
    recipe draws, for `writerSounds`.
  - `countTimes`-style `countingPlan(o)`.
  - `cyclePlan(o)` returns node times and positions.

  Each is the private `*Plan` the recipe already uses, with its nodes added and defaults merged, exactly as
  `quizTimes` does.
- An `extras(ctx, parts)` hook on every teaching recipe. It is more general, but it touches every layer
  function, so leave it for when a film needs it.

**RE-9: a voiced quiz in `hdf script`.** In `cli/script.mjs` `beatCode`, the `S.voice` branch writes the
quiz's `quizTimes` line and the tick and ding score lines the plain branch writes. Both branches also gain a
pop for each option (`quizTimes(...).options`), as `quiz-time.js` has. Test it in `test/script.test.js` with a
brief whose quiz has `voice:`.

**RE-10: the acceptance film as a fixture.** Move the film out of gitignored `work/`, as the v3 showcase
films are not:
- `work/moon/moon.js` and `moon.md` move to `films/moon.js` and `films/moon.md`. Imports become `../core/...`,
  and the sheet's `hdf script films/moon.md` header is regenerated.
- `work/moon/sam-moon.js` moves to `films/sam-moon.js`.
- The rig sheets `sam-sheet.mjs` draws move to `films/moon/` with that script, so `sam` can be rebuilt from
  paper in one command (after session 2).
- The davidup half becomes `examples/hdf-moon/build.mjs`, after `examples/hdf-cues/build.mjs`: it makes the
  pad, builds the composition through the MCP server, and checks that the clip's cuts sit on the markers
  within 1/24 s.
- `test/script.test.js` drops its `MOON` skip and reads `films/moon.*`. Its recipe list then describes a
  committed brief.
- Goldens for `moon` are written on arm64 (`--workers 1`), as the other 4.0 films were. Give the golden 24
  sampled frames, not all 1291, and say so in the film's header.

Delete `labelTimes`, `BRIGHT` and `TITLE_TEXT` in the film in favour of the RE-8 exports.

**Files:** `recipes/teach.js`, `recipes/shots.js` (re-exports), `cli/script.mjs`, `films/moon.js`,
`films/moon.md`, `films/sam-moon.js`, `films/moon/`, `examples/hdf-moon/`, `test/script.test.js`,
`test/films.test.js` (the film list), `.gitignore` (the example's outputs), and `references/recipes.md`.

**Done when:**
- `hdf script --check films/moon.js` exits 0 on any machine.
- The moon film has no copied recipe arithmetic.
- A voiced quiz's stub has ticks, a ding and pops.
- `node examples/hdf-moon/build.mjs` rebuilds `moon-real.mp4` and exits 0.
- With session 1 in, `films/moon.js` goes back to `format: '16:9'` if the user prefers it. **The user
  decides this.**

---

## 5. Looks that know the board (RE-11, RE-12)

**RE-11: a role per look.** `core/looks.js` `resolveRole` accepts `{ base, by: { <preset>: role } }`: the
role for the look's preset when `by` names it, else `base`. The preset is the look name before any `~`
modifier. The object form already exists (`base`, `tint`, `mix`), so lint's `roles` rule, the hash and the
cut-out finish see nothing new. Validate `by`'s keys against `LOOKS` and its values as roles.

The moon film's `moonOps` then takes `lit: { base: 'fills.3', by: { chalkboard: 'light' } }` and
`dark: { base: 'shade', by: { chalkboard: 'night' } }`, and `CHALK_PHASES` goes.

If session 2 chose a `skin` role, this is the fallback for looks without one.

**RE-12: a ghost for each shot.** `shot(name, dur, draw, { ghost })` overrides the look's ghost for that
shot: `0` for none, or an alpha. `ghostOf` in `core/looks.js` reads the shot's option first. The renderer and
the player read the ghost where they read `ghostOf(look)` today; grep `ghostOf(` in `cli/` and `player/`. A
recipe passes `ghost` through like `look` (`recipes/recipe.js`, the `shot(...)` options).

**Files:** `core/looks.js`, `core/tree.js`, the ghost call sites, `recipes/recipe.js`, `films/moon.js`,
`test/looks.test.js`, and `test/chalkboard.test.js`.

**Done when:**
- One moon cel draws yellow on the whiteboard and white chalk on the chalkboard.
- The moon film's chalk chapter runs at `~ghost:0.15` with `ghost: 0` on the count only.
- Every golden holds, because no existing film uses `by` or a shot ghost.

---

## 6. davidup and the skill (RE-13, RE-14, RE-15)

**RE-13: the clip item's name.** `src/mcp/tools.ts:3106` names the item `hdf:${args.film}`. Use the film's
basename without `.js` when `film` is a path. Keep the path in the tool's result, not in the composition.
`src/mcp/hdf.ts` (and `davidup-hdf-clip.ts`, which reads `hdf:<film>`) must resolve a basename back to the
file. Record the path in the asset's metadata, or look the name up in `handdrawn/films` and then relative to
the composition. **Check that the scripts still find the film from the name alone.**

**RE-14: credit on davidup assets.** Add optional `credit` and `licence` fields (the store's closed licence
list: CC0 CC-BY CC-BY-SA OFL PD own unknown) to every asset schema in `src/schema/types.ts`, `register_asset`,
`list_assets` and `validate`. Validation warns `W_ASSET_CREDIT` when a CC-BY or CC-BY-SA asset has no credit.

Per the memory note, **update `apps/editor/app/types/commands.ts` too**, or the editor silently strips the
fields. Rebuild and `bun install` before the editor tests.

`render_hdf_clip` and `hdf-to-davidup.ts` copy the store's `credit` and `licence` onto the assets they
register. The Library panel shows the credit under the thumbnail.

**RE-15 and the skill.** In `.claude/skills/hand-drawn-film/SKILL.md` and its references:
- Teaching recipes centre themselves at any aspect (session 1).
- `hdf sketch --face stick`, `--roles`, and "check a model sheet in a dark look" (session 2).
- Alignment no longer needs the `--json` detour (session 3).
- The recipe plans (session 4).
- `by` roles and per-shot ghost (session 5).
- A line on voices: macOS `say` has no child voice. Piper and edge-tts have some; name one or two.
- Pitfalls: remove the ones these sessions made obsolete.

**Files:** `src/mcp/tools.ts`, `src/mcp/hdf.ts`, `scripts/davidup-hdf-clip.ts`, `src/schema/types.ts`,
`apps/editor/app/types/commands.ts`, the editor's Library component, `scripts/hdf-to-davidup.ts`, davidup's
tests (the schema, the MCP integration count stays 60), and the skill files.

**Done when:**
- `render_hdf_clip { film: '<path>/sam-moon.js' }` places an item named `hdf:sam-moon`, and a re-render with
  `item` finds its film.
- `moon-photo` registered with its credit validates with no warnings; registered without one, it warns.
- The skill reads true against the code, with no stale pitfalls.

---

## Not in this plan

- **RE-16, the user's hand.** Photograph the three hand pages, then run `hdf hand latin.jpg symbols.jpg
  marks.jpg --name narcis`. Then set `HAND = 'narcis'` in `films/moon.js`, run `hdf hand --export-ttf
  narcis`, and re-run the davidup build.
- The golden tests that fail on the Intel Mac. They predate these sessions (see the memory note).
- Rhubarb itself. After RE-7 its absence or crash is handled; getting it to run on this Mac is not the
  package's job.

## Afterwards

Append a status table to `hand-drawn-film-v4-rough-edges.md`, one row per RE with its outcome, as the v3
rough-edges doc has. Re-render the moon film and `moon-real.mp4` from the committed fixtures as the last
check.
