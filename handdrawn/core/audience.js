// Audiences (4.0 E2, moved to core at T9 so speech and captions read them; T10 turns them into lint profiles
// too): text scales the letters, write is the pen's speed in characters a second, read the viewer's in words
// a second, dwell the seconds anything new stays before the next thing, count the seconds per counted object.
export const AUDIENCES = Object.freeze({
  general: Object.freeze({ text: 1, write: 16, read: 3.3, dwell: 0.5, count: 0.5 }),
  beginner: Object.freeze({ text: 1.1, write: 14, read: 2.5, dwell: 0.7, count: 0.6 }),
  'kids-9': Object.freeze({ text: 1.2, write: 12, read: 2, dwell: 0.9, count: 0.7 }),
  'kids-7': Object.freeze({ text: 1.3, write: 11, read: 1.6, dwell: 1, count: 0.8 }),
  'kids-5': Object.freeze({ text: 1.4, write: 10, read: 1.2, dwell: 1.2, count: 1 }),
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
