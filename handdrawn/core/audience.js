// Audiences (4.0 E2, moved to core at T9 so speech and captions read them, lint profiles at T10).
// What the recipes read: text scales the letters, write is the pen's speed in characters a second, read the
// viewer's in words a second, dwell the seconds anything new stays before the next thing, count the seconds
// per counted object.
// What lint reads (core/lint.js, `film({ audience })`): words a shot may carry outside the sign-off (null: the
// look's allowance, as before 4.0), minX the least x-height of any lettering at a 240 px wide render (px),
// perWord the seconds a piece of text must stay on screen for each of its words, cutFloor the shortest shot
// (s), contrast the least contrast ratio of text on what it is drawn over. look is the look a film for that
// audience gets when it names none (4.0 L3: kids-5 picks the crayon look). general is what lint asked before
// T10 (no size, dwell or cut floor worth the name, 3:1 contrast), so a film with no audience lints as it did;
// each other profile sits under what the recipes make at that audience, so a recipe's own output passes.
export const AUDIENCES = Object.freeze({
  general: Object.freeze({ text: 1, write: 16, read: 3.3, dwell: 0.5, count: 0.5, words: null, minX: 2.5, perWord: 0.15, cutFloor: 0, contrast: 3, look: null }),
  beginner: Object.freeze({ text: 1.1, write: 14, read: 2.5, dwell: 0.7, count: 0.6, words: 16, minX: 3.5, perWord: 0.3, cutFloor: 1, contrast: 4.5, look: null }),
  'kids-9': Object.freeze({ text: 1.2, write: 12, read: 2, dwell: 0.9, count: 0.7, words: 14, minX: 4, perWord: 0.4, cutFloor: 1.5, contrast: 4.5, look: null }),
  'kids-7': Object.freeze({ text: 1.3, write: 11, read: 1.6, dwell: 1, count: 0.8, words: 10, minX: 4.5, perWord: 0.5, cutFloor: 2, contrast: 4.5, look: null }),
  'kids-5': Object.freeze({ text: 1.4, write: 10, read: 1.2, dwell: 1.2, count: 1, words: 8, minX: 5, perWord: 0.7, cutFloor: 2.5, contrast: 4.5, look: 'crayon' }),
});

// The audience record for a name (or a record passed whole); throws on a name it does not know.
export function audienceOf(a = 'general') {
  if (a && typeof a === 'object') return { ...AUDIENCES.general, ...a };
  const r = AUDIENCES[a];
  if (!r) throw new TypeError(`audience '${a}': expected one of ${Object.keys(AUDIENCES).join(', ')}`);
  return r;
}

// The words in a string (runs of non-space).
export const wordCount = (s) => String(s ?? '').split(/\s+/).filter(Boolean).length;
