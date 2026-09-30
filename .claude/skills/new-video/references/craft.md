# Craft: what makes a video look designed

Motion design reads as expensive for a small number of reasons, and every one of them is a rule you
can check on a picture. This is the list the style card, the style frames and the review use. The
numbers are for a 1920x1080 frame; scale them by the short side for other sizes.

## The frame

- **One focal point.** Each frame has one thing the eye lands on first. If two things compete,
  make one of them smaller, dimmer or later.
- **Hierarchy by scale.** Neighbouring levels of type differ by 1.5x or more (a 150 px statement,
  a 48 px line under it, never 72 over 60). Weight and colour are the second and third levers.
- **Air.** A third to a half of the frame is empty. A statement lives alone; a statement plus an
  object share the frame on thirds (text on one side, the object on the other, never touching).
- **A grid.** Margins of 5 to 8% of the width; left edges line up across a shot; a centred layout
  stays centred all the way through.
- **Type sizes that read.** Hero 140 to 240 px, statements 96 to 150, supporting lines 40 to 56,
  small print 28 to 36 and never less. Vertical (1080x1920) needs a third more: 40 px minimum.
  A statement is 2 to 6 words, 30 characters a line at most.
- **Two typefaces.** A display face with character (Playfair Display, Anton, Bebas Neue, Space
  Grotesk) and a quiet text face (DM Sans, Inter). A handwritten face (Caveat, Hershey script) is a
  third voice only for notes.
- **Contrast.** 4.5:1 for small text, 3:1 for large (`nv check` measures it under each letter).
  Light type on dark reads bigger than it is; tighten its tracking a little.
- **Palette discipline.** 60% ground, 30% ink, 10% accent; one or two accents; colours pulled from
  the product, the reference or a photograph in the frame (`refs/<name>/palette.png` and the
  record's `colours`). Every coloured element takes its colour from the palette constant, never a
  new hex.
- **Depth.** Three planes: a ground that moves slowly (aurora, a texture, a blurred photo), the
  subject, and foreground accents (particles, hand marks, rings). Objects cast soft shadows down
  (blur 30 to 40, offset 20 to 30 px, 50% black); blur pushes things back; glow only for light.

## Motion

| move | duration | easing |
|---|---|---|
| a word, a small element arriving | 0.3 to 0.5 s | `snap` (or `outExpo`) |
| a statement or an object arriving | 0.6 to 1.2 s | `snap` |
| a hero reveal (line mask, track-in) | 0.9 to 1.6 s | `snap` |
| a pop, a stamp | 0.4 to 0.6 s | `punch` (a little overshoot), once or twice a video |
| leaving | 0.3 to 0.5 s | `accel`, faster than arriving |
| a wipe | 0.8 to 1.0 s in all | `swift` |
| a camera move | 1 to 3 s | `swift`, or `glide` for a drift |
| a drift on a hold | the whole hold | `glide`/linear: 3 to 6% scale |

- **Stagger.** Siblings never arrive together: 60 to 120 ms between words, 80 to 150 ms between
  list items or cards. On a beat, stagger on eighths.
- **Overlap.** The next move starts while the last is settling (at 60 to 80% of it). Waiting for
  each move to finish reads as a slideshow.
- **Hold.** A landed statement holds at least its reading time (about 0.3 s a word plus 0.5 s),
  and nothing new arrives in the last fifth of a shot.
- **Direction.** Things arrive the way the story moves (up out of a mask, in from the right when
  the story goes forward) and leave the same way throughout the piece.
- **Never dead.** A hold drifts (`v.drift`), the ground moves (`aurora`), a texture crawls. `nv check`
  flags 1.75 s with nothing moving.
- **Never linear** except drifts, counters, tickers and camera pans at constant speed.
- **One move per region at a time.** If the title is arriving, the object is holding.

## Rhythm

- **Music first.** Acts start on bars, entrances land on beats, kinetic words on eighths, transitions
  cover on the downbeat (the whoosh 0.3 to 0.45 s before it). `nv rhythm` shows scene changes
  against beats and markers.
- **The arc.** Hook (motion in the first 0.3 s, the most striking frame in the first 2 s), build,
  a peak around 70 to 80% through, resolve, and an end card held 2 to 3 s. A contrast in pace
  (fast then suddenly slow) is the strongest emphasis there is.
- **Average shot length** by kind: social hook 0.8 to 1.8 s, promo 1.5 to 3 s, brand story 3 to 5 s,
  explainer 3 to 6 s. `nv refs` measures a reference's; match its feel, not its numbers.

## Transitions

- One family per video (bands, or zoom-through, or whip), used at every act change; a flash at most
  twice, on the biggest drops.
- Cut under cover: switch the content at the moment the transition covers the frame (`v.wipe(t)`
  covers at t; set the old act's `exit: t`).
- Motivate it: zoom-through for going deeper, whip for "next", iris to focus on a point, bands in
  the brand's colours for chapters, a match cut when a shape in one act becomes a shape in the next
  (a ring that becomes a dot, a bar that becomes an underline).

## Typography in motion

Line mask reveals (`lineReveal`) for statements; word staggers (`words`) for a hook or a list;
tracking-in (`trackIn`) for a wordmark; scale from 1.3 to 1 with `snap` for a single word; counters
for numbers (people read a number that moves); type-on only for code, UI or a chat. Animate the
statement, not every word of a paragraph; a paragraph on screen is a failure of the copy.

## The hand-drawn layer

- It is emphasis: a circle round the thing that matters, an underline under the word that matters,
  an arrow from the claim to the proof, a written aside that sounds like a person. 3 to 6 marks in
  20 s; none in the first second of a statement (let it land, then mark it 0.3 to 0.8 s later).
- One look for all marks, inks from the palette, a pen weight that matches the type's stroke (4 to
  6 px at 1080).
- On dark frames use `chalkboard` (chalk) or light inks; on light frames `paperInk` (ink),
  `whiteboard` (marker) or `crayon`. `highlight` is a translucent marker band: light frames only.
- A character (a sprite) is a cast member, not decoration: give it something to do (walk to the
  object, wave on the end card) and draw its sheet in a look that reads on the ground
  (`hdf sprite ... --look chalkboard` for dark frames).
- A texture (`paper-kraft` overlay at 0.12 to 0.25 on dark, `paper-warm` multiply on light) makes
  crisp vector type feel printed and ties it to the drawn marks.

## Sound

A bed that fits the pace (a made bed has exact beats), hits that match what moves (pop on a pop,
whoosh into a wipe, tick on a counter, ding or tada on the end card), silence before a big moment
(end the bed a beat early, hit on the drop). Sound effects at 0.4 to 0.6 under a bed at 0.5 to 0.7.

## Amateur tells (fix on sight)

Everything fades in and out; everything arrives at once; every element centred with no hierarchy;
three or more typefaces; a rainbow palette; text too small or gone before it is read; a different
transition on every cut; holds where nothing moves; motion with no reason; sound off the picture;
things cut by the frame edge by accident; hand marks scattered everywhere, or too small to see.

## Style cards to start from

| style | palette | type | motion | hand |
|---|---|---|---|---|
| warm editorial (`examples/nv-steep`) | espresso, cream, amber, terracotta | Playfair Display + DM Sans | slow snaps, line reveals, band wipes, drifts | chalkboard circles and notes, kraft overlay |
| neon tech (`examples/showcase-v1.1`) | near-black, cyan, magenta, amber | Anton / Bebas + JetBrains Mono | fast expo moves, glows, flashes on drops, dot grids | whiteboard marks in cyan, sparingly |
| clean product | white or pale grey, one brand colour, ink | Space Grotesk + Inter | precise slides, bars and counters, zoom-through | paperInk underlines and arrows |
| playful explainer | cream, primaries at 80% | DM Sans bold + Caveat | pops with `punch`, bouncy characters, iris | crayon or notebook marks, a character walking on |
| chalk lecture | slate green, chalk white, yellow | Playfair + Hershey script | calm reveals, writing on | chalkboard throughout, `write` with the hand |
