// Hashing and seeded randomness. Nothing here reads Date, Math.random or global state.

const enc = new TextEncoder();

// FNV-1a 32 over the parts, each fed as UTF-8 text and separated by 0x1f, so ('ab', 'c') != ('a', 'bc').
export function hash32(...parts) {
  let h = 0x811c9dc5;
  for (let p = 0; p < parts.length; p++) {
    if (p) h = Math.imul(h ^ 0x1f, 0x01000193);
    const bytes = enc.encode(String(parts[p]));
    for (let j = 0; j < bytes.length; j++) h = Math.imul(h ^ bytes[j], 0x01000193);
  }
  return h >>> 0;
}

// FNV-1a 64 in four 16-bit limbs (prime 2^40 + 0x1b3). `walker(feed)` pushes data through
// feed.byte(b), feed.str(s), feed.num(n) (quantised to 1/1024). Returns 16 hex digits.
export function hash64(walker) {
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
  const byte = (b) => {
    h0 ^= b & 0xff;
    let t0 = h0 * 0x1b3, t1 = h1 * 0x1b3, t2 = h2 * 0x1b3 + (h0 << 8), t3 = h3 * 0x1b3 + (h1 << 8);
    t1 += t0 >>> 16; h0 = t0 & 0xffff;
    t2 += t1 >>> 16; h1 = t1 & 0xffff;
    t3 += t2 >>> 16; h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  };
  const str = (s) => { const b = enc.encode(s); for (let i = 0; i < b.length; i++) byte(b[i]); byte(0); };
  const num = (n) => str(String(Math.round(n * 1024) || 0));   // || 0 folds -0 and NaN
  walker({ byte, str, num });
  const hex = (x) => x.toString(16).padStart(4, '0');
  return hex(h3) + hex(h2) + hex(h1) + hex(h0);
}

// Seeds are paths: a child's seed is its parent's seed hashed with its own name.
export const seedOf = (parent, name) => hash32(parent, name);

// Same generator as v1 core.js, so ported marks land where they used to.
export function rng(seed) {
  let a = (seed * 1000003) >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
