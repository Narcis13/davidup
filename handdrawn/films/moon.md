film: moon
subject: why does the moon change shape?
audience: kids-7
look: whiteboard
format: 1:1
cast: sam, fox
actor: sam
bed: calm
anchor: the moon (a drawn disc that is there in every shot but the title and the talk)

The acceptance film of hand-drawn film 4.0 (docs/hand-drawn-film-v4-plan.md, section 10). sam is the user's
kind of character: drawn on the two rig sheets (W1), read by hdf sketch, a face grafted on so he talks. A
lesson in four chapters on the whiteboard, the second on the chalkboard (L2), the sign-off in the user's hand.

# why does the moon change shape?
card: false
- show: titleCard({ title: 'why does the moon change shape?', hand: true, x: 450, y: 600, size: 92, width: 820 })
  name: title
  what: the title written by a hand while sam walks on (planted feet) and presents it
  sound: the marker a word at a time; a step a footfall
- voice: moon-look
  name: look up
  by: sam
  what: sam looks up and asks; the moon drawn thin, then round, as he says so
- show: labelled({ subject: () => moonFace({}), x: 470, scale: 1, side: 'right', nudge: 0, labels: [{ text: 'craters', at: [530, 440] }, { text: 'bright side', at: [600, 580] }, { text: 'dark side', at: [370, 560], from: [300, 760] }] })
  name: moon
  what: the moon labelled, leader lines, the bright side ringed
  sound: a pluck a label
---

# the sun lights half
look: chalkboard~ghost:0.08
- voice: moon-sun
  name: orbit
  by: sam
  what: the sun, the earth, the moon going round it lit on the sun's side; what the earth sees, inset
- show: counting({ items: phase, n: 8, cols: 4, gap: 190, scale: 1, label: 'shapes' })
  name: count
  what: the eight shapes counted, a digit and a tally mark each
  sound: a pop a shape
---

# one month
- show: cycleDiagram({ steps: [{ text: 'new', cel: phase0 }, { text: 'growing', cel: phase2 }, { text: 'full', cel: phase4 }, { text: 'shrinking', cel: phase6 }], r: 300 })
  name: month
  what: the month as a ring, the names along it, a marker going round
- fox says: de ce?
  emote: confused
- sam says: pentru că Soarele o luminează doar pe jumătate!
  emote: happy
---

# quiz time
- show: quiz({ question: 'which moon is big and round?', options: [{ text: 'new', cel: phase0 }, { text: 'half', cel: phase2 }, { text: 'full', cel: phase4 }], answer: 2 })
  voice: moon-ask
  name: quiz
  sound: then "yes! the full moon."
---

- sign: good night
  look: whiteboard~hand:hershey-script
