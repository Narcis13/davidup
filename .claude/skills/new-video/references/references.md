# Reading a reference

A reference is evidence about **structure, rhythm, palette logic and motion language**. It is never
footage to reuse, and its logos, characters, photography and exact layouts are not ours to copy.
The output of this step is the style card in `brief.md`.

## Getting it

A file the user gives: use it as is (`.mp4 .mov .webm .mkv`, any length; long ones are analysed at
10 fps). A URL: ask for the file, or download it with a tool the user has and has the right to use
(`yt-dlp` if installed); do not work around a site's terms. Several references: decompose each,
then write one card that says what comes from which.

```bash
nv refs refs-in/launch.mp4 refs-in/brand.mov --into videos/<slug>
nv study refs-in/launch.mp4 --from 4.2 --to 5.4 --n 10 --into videos/<slug>   # one transition, frame by frame
nv beats refs-in/launch.mp4 --into videos/<slug>                             # the music alone
```

## What comes out, and how to read it

`refs/<name>/summary.md` — the numbers in sentences:

- **Shots** are scene changes by any transition (a cut, a wipe, a blur, a flash, a dissolve), found
  by comparing the layout 0.1 to 0.45 s before and after each moment; hard cuts are listed apart.
  Motion graphics change scenes with transitions far more than with cuts, so trust the scene count,
  and look at `sheet.jpg` to see what each shot is.
- **Motion** is the share of the frame that moves (over 0.1 s), by fifths of the video: the energy
  arc. "Peaks in the fourth fifth, opens at 60%" is a build; "opens at 100%" is a cold open.
- **Still spans**: 1.5 s or more with nothing moving. In a reference that is a deliberate hold (an
  end card, a statement given room); in yours it is usually a bug.
- **Brightness** mean and arc: dark, mid or light, and whether it changes act to act.
- **Palette** by area (the ground dominates) and **accents** (the saturated colours, by their share
  of the saturated pixels): the accents are the brand.
- **Tempo**: an estimate from the onsets, with a confidence (over 1.5 is a clear pulse). Sparse or
  soft music can read a wrong tempo, and half or double the felt tempo is common: check it on
  `rhythm.png` (do the beat ticks line up with the loudness bumps?). **Rises** are candidate drops.
- **Changes on a beat**: how many scene changes land within 100 ms of a beat. Over 50% means the
  editor cut to the music; match that discipline.

`sheet.jpg` — a keyframe from the middle of each shot, its start, length, motion and three colours.
Read it for: the composition of each frame (centred? thirds? how much air?), the type (serif or sans,
case, size relative to the frame, how many words at once), what kind of subject carries each shot
(type, product, photo, character, data), and how the acts are grouped.

`rhythm.png` — the video over time: thumbnails on top, the moving share (cyan), brightness (amber),
loudness (violet), hard cuts (red), transitions (dashed), beats (ticks under the axis), still spans
(shaded). Read it for: the arc, where the peaks are and what causes them (a flash is a spike to the
top, a wipe a pair of peaks), how long the calm stretches are, whether changes sit on beats.

`palette.png` — swatches by area and the accent row. Take the logic (a dark ground, one warm accent,
one cool), not necessarily the hexes.

`study-*-strip.jpg` and `-onion.jpg` — one move frame by frame. The strip shows the order of events
and the easing (bunched frames = slow, spread = fast); the onion skin shows paths and overshoot in
one picture (faint = earlier, solid = later). Rebuild the move from what you see with the kit.

## The style card

Fill each line in `brief.md` from the evidence, saying which reference it came from:

- **Pacing:** average shot (the reference's, adjusted to our length and platform), the number of
  acts, the arc ("cold open at full energy, calm middle, peak at 75%, 3 s end card").
- **Palette:** ground, ink, one or two accents, as hexes for the kit's palette constant.
- **Type:** the class of face (a high-contrast serif, a condensed grotesk, a geometric sans) mapped
  to what the library has (`nv find --kind font`, `~/.davidup/library/fonts`), case, scale.
- **Motion language:** entrances, exits, the transition family (with the kit recipe that makes it),
  the camera, what lands on the beat.
- **Hand-drawn layer:** where the reference emphasises (a zoom, a colour pop, a circle) becomes
  where our marks go; the look that suits the ground.
- **Texture and depth:** grain, light, shadows, blur.

Then write the beat sheet against it, and use `nv rhythm <dir> --ref refs/<name>` from the animatic
on: the reference's motion curve is drawn under yours (stretched to your length), so you can see
where your piece is flatter, busier or differently shaped.

## Limits

The analysis is pixels and sound only: it does not read text, recognise objects or know what the
reference means. Say what you see in the keyframes yourself. Gradual dissolves and very slow pushes
may not register as scene changes; fast camera moves inside one shot can register as several.
