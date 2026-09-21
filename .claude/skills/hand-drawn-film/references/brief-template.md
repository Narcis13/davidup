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
