# Brief template

Fill this from the user's request before touching code. Keep it at the top of
the film module as a comment, with the beat sheet under it. (v1's template;
only the names changed to 2.0's.)

```
BRIEF
Subject: <one sentence, e.g. "the life of a request inside a 4x RTX 3090 rig">
Format: <1:1 | 16:9 | 9:16>, output width <1080 | 1920 | 3840>, drawn 12 fps, output 24 fps, <N> seconds
Look: ink | riso | screen | pencil | doodle (photos of real objects, see engines.md) | cut-out (card puppets) | mixed
Engine: flat (default) | found motion (real movement, traced or retargeted onto a puppet) | sand (one take)
        | paper in space (pop-up book)   (name the cuts where the look changes)
Look preset: paperInk | risoPop | screenSea | pencilMinimal | blueprintNight | doodlePastel | cutout
         | withLook(base, {...}) | derive(base, { hue, sat, light }) | duotone(base, a, b) | pastel(base, sheet)
         | modifiers: ~hand:<id> (the user's handwriting) ~from:<id> (a cutout's colours)
Hand: house | <id> (from the store: hdf find --kind hand; or the sheet the user fills in, assets.md)
Finish: follows the look unless stated
Anchor: <the element that survives every cut: a dot, a cel, a thread, a puppet>
Cast: <actors on screen: CAST.FOX | CAST.HOG | a puppet to import (SVG asked for) | none>
      <what each does: says "...", turns, walks (cycle), a retargeted motion>
Store: <ids the film reads (hdf find first): cutouts, clips, puppets, the hand>
Cels: <list, 1..3: from packs or pack mirrors where one fits, else new; each with 1..4 inputs>
Beats (8..14, each 0.25..3 s):
  1. <what happens> | look <ink/riso/screen/pencil/doodle/cutout> | camera <static/push-in/follow> | recipe <A..Z, AA..AM> | cast <actor> | sound <motif>
  2. ...
Must include: one establishing shot (A or U), one drawn transition (B, iris or torn section),
              one of C/D/E/O, one POV or gallery (H or P), sign-off (S)
Deliver: work/<name>/<name>.js, out/<name>-final.mp4, out/<name>.html, out/<name>-sheet.jpg,
         the credit line of every store asset; into davidup when asked (scripts/hdf-to-davidup.ts)
```

Instruction to prepend when handing the brief to another agent:

```
You are writing a short film as a JavaScript module on the handdrawn package,
following the hand-drawn-film skill. Run `hdf find` for every subject before
drawing anything and place what the store has by id; ask for an SVG before
writing a character's polylines. Build the timeline from recipes and pack
cels first, with `actor:` where a cast member is on screen, run `hdf board`
and look at it, write only the cels no pack or store has and check each with
`hdf sheet`, run `hdf lint` until clean and `hdf grid` before the first full
render, then `hdf render` and look at the contact sheet. Colours are roles,
never hex; no Math.random, Date, filters or gradients.
```

## A lesson's brief in the script dialect (4.0 E5)

For a lesson, write the brief as a markdown file the tool reads, and let
`hdf script <brief.md>` do the timing: it prints the beat sheet (each length
the film's own) and writes the stub `work/<film>/<film>.js` with the recipes
named; run it again after changing the brief (a film that exists keeps its
code, only its beat-sheet comment is replaced); `hdf script --check
<film.js>` says whether the film still plays its sheet.

```
film: <name>                      header lines, before the first beat or chapter
subject: <one sentence>           (any other key is kept in the BRIEF comment; other lines are prose)
audience: general | beginner | kids-9 | kids-7 | kids-5
look: <preset>                    hand: <id> letters it in a stored hand; format: 1:1 | 16:9 | 9:16
cast: sam, kit (kid), fox         a store puppet by id, else a stick built in code (build in brackets)
actor: sam                        the teacher: every teaching recipe (AN to AY) and chapter card gets it
bed: calm | bright | mystery | march

# <chapter title>                 its title card (AN), its beats, a hold
hand: true                        options: hand, sub, look, card (false), hold, and the card's (size, y, width, ...)
- show: <recipe>({ ... })         a recipe by name or letter, its options as JS; an unknown identifier is a stub cel
- show: <what happens>            a placeholder shot (dur: n, else 2.5 s)
- text: <copy>                    lettering written by a hand at reading speed (AN, hand: true)
- voice: <sample id>              a narration, captioned; the teacher speaks it (by: <cast> | none); copy: <text>
                                  times a line not recorded yet
- <name> says: <line>             speech; consecutive lines are one exchange (AY), one speaker stands alone
  emote: <expression>             sub-items: name, dur, look, sound, what, voice, copy, by, kind, emote
---                               ends the chapter
- sign: <a> <b>                   the sign-off, last
```

`work/moon/moon.md` is the pattern: the acceptance film of 4.0, four
chapters, 98 s at kids-7.
