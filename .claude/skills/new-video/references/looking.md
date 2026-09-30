# Looking: the review list

Every picture `nv` makes answers a different question. Look at the one that answers yours, say what
you see in one line, compare it with the brief, fix the largest gap first, and look again at what
changed (a sheet at the same times badges the changed frames and writes `diff.jpg`).

## `nv frame --at t` (a style frame, full size)

- One focal point; the eye lands where the act's idea is.
- Hierarchy: the statement, then the object, then the small print; levels 1.5x apart.
- Air: a third of the frame empty; nothing touching (type and object, type and edge).
- Alignment: margins match across the piece; centred things are centred.
- Type: sizes that read at a glance (see `craft.md`), line breaks that make sense, no widows, no
  word cut by the edge.
- Colour: only palette colours; accents on the thing that matters; contrast.
- Depth: a ground that is not flat, a shadow under objects, nothing floating by accident.
- Would it work as a poster? If not, it will not work moving.

When a patch is wrong and the reason is not obvious: `nv frame <dir> --at t --only <layer|ids>` or
`--hide <layer|ids>`; each layer alone shows who paints what.

## `nv sheet` (the whole piece, 12 to 16 frames)

- Each act reads in a second and a half; one idea per act.
- The acts look like one film: the same palette, type, margins, texture.
- Transitions cover fully at their moment (a frame that is all one colour at a marker is a wipe
  covering, which is right; the frames either side show the old and the new act).
- Nothing lingers from the last act (a leftover title means a missing `exit`).
- The hand marks sit on their targets and belong to the act they are in.
- The CHANGED badges are where you expected them, and only there (a change elsewhere is a side
  effect of your edit).

## `nv motion --from a --to b` (a move)

- Strip: the order is right (the thing that matters arrives first), siblings are staggered, nothing
  arrives in the last fifth of the shot. Bunched frames at the end of a move mean a soft landing
  (good for `snap`); evenly spread frames mean linear (bad, except drifts).
- Onion skin: the path is a clean line or arc (no zigzags from two tweens fighting), overshoot is
  small and settles, nothing drifts off by accident.
- A pop overshoots once; a wipe covers completely before it leaves; a zoom-through blurs out the old
  before the new lands.

## `nv rhythm [--ref refs/<name>]` (time)

- The arc has the shape the style card promised; the reference's curve (grey) and yours differ
  only on purpose.
- Scene changes (dashed and red lines) sit on markers and beats; "markers with nothing happening"
  names the ones that do not.
- No amber (still) band longer than 1.5 s except the end card.
- Loudness (in a final render's `.look/final/rhythm.png`) rises into the drops and does not clip.

## `nv check` (what a machine can measure)

- Errors first: contrast under 2:1 for a second or more, type under 70% of the minimum size,
  validation errors. These are never a style choice.
- Warnings: fix or justify each in the log (a 0.3 s flash over a title is a choice; 24 px copy on a
  phone is not). `check.jpg` boxes each finding on its frame; the thin amber frame is the safe area.
- Coverage: the last line says how many text items it measured; if a title is missing from that
  count it was never on screen at a sampled time (too brief, or hidden).

## The final render (`nv render`, `.look/final/`)

- `sheet.jpg`: the encoded video looks like the composition (colour, sharpness, nothing missing).
- `rhythm.png`: the same arc as `nv rhythm`, plus the real loudness; the music fades at the end.
- Watch the mp4 once if a player is available (`open <file>` on macOS): the sound on the picture,
  the feel of the timing. Then deliver.

## Stop when

The brief's one thing is unmistakable, every act passes the frame list, `nv check` has no errors,
the rhythm matches the card, and the last pass changed nothing you would call better. Two passes
that only nudge numbers mean the shot's idea is the problem: rethink it or cut it.
