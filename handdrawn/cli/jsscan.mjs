// A small scanner for the top level of an ES module, enough for `hdf donate` to copy a cel with what it needs:
// the module split into top-level statements, each with the names it declares and the identifiers it uses.
// It tokenises strings, templates (with ${} nesting), comments and regex literals so none of them are read
// as code, and relies on the house style (statements end in ';', or a function/class body's closing brace).
// Not a parser: destructuring declarations and object keys are handled by simple rules that over-include
// rather than miss, and an unneeded name only costs an unused import.

const ID0 = /[A-Za-z_$]/, ID = /[A-Za-z0-9_$]/;
const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends finally for function if '
  + 'import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set '
  + 'null true false undefined').split(' '));
// After these a '/' starts a regex, not a division.
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

// tokens: { t: 'id' | 'num' | 'str' | 'p' (punctuator) | 'tpl', v, s, e } plus comments as { t: 'c', s, e }.
export function tokenize(src) {
  const out = [], stack = [];   // stack: brace depth at which each open template expression resumes the template
  let i = 0, depth = 0;
  const sig = () => { for (let j = out.length - 1; j >= 0; j--) if (out[j].t !== 'c') return out[j]; return null; };
  const template = (start) => {   // from just after a '`' or a '}' closing ${...}: to the next '${' or closing '`'
    let j = start;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') { out.push({ t: 'tpl', s: start, e: j + 1 }); return j + 1; }
      if (c === '$' && src[j + 1] === '{') { out.push({ t: 'tpl', s: start, e: j + 2 }); stack.push(depth); depth++; return j + 2; }
      j++;
    }
    throw new SyntaxError('unterminated template literal');
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; out.push({ t: 'c', s: i, e: end }); i = end; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) throw new SyntaxError('unterminated comment'); out.push({ t: 'c', s: i, e: e + 2 }); i = e + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; if (src[j] === '\n') throw new SyntaxError(`unterminated string at ${i}`); j++; }
      out.push({ t: 'str', v: src.slice(i + 1, j), s: i, e: j + 1 }); i = j + 1; continue;
    }
    if (c === '`') { i = template(i + 1); continue; }
    if (ID0.test(c)) { let j = i + 1; while (j < src.length && ID.test(src[j])) j++; out.push({ t: 'id', v: src.slice(i, j), s: i, e: j }); i = j; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) { let j = i + 1; while (j < src.length && /[0-9a-zA-Z_.]/.test(src[j])) j++; out.push({ t: 'num', s: i, e: j }); i = j; continue; }
    if (c === '/') {
      const p = sig();
      const regex = !p || (p.t === 'p' && !')]}'.includes(p.v)) || (p.t === 'id' && REGEX_AFTER_WORD.has(p.v));
      if (regex) {
        let j = i + 1, cls = false;
        while (j < src.length) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '\n') throw new SyntaxError(`unterminated regex at ${i}`);
          if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break;
          j++;
        }
        j++;
        while (j < src.length && ID.test(src[j])) j++;
        out.push({ t: 'str', v: src.slice(i, j), s: i, e: j }); i = j; continue;
      }
    }
    if (c === '}' && stack.length && stack[stack.length - 1] === depth - 1) { stack.pop(); depth--; i = template(i + 1); continue; }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    const v = ['...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??='].includes(three) ? three
      : ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '&=', '|=', '^='].includes(two) ? two : c;
    if ('([{'.includes(v)) depth++;
    if (')]}'.includes(v)) depth--;
    out.push({ t: 'p', v, s: i, e: i + v.length });
    i += v.length;
  }
  return out;
}

// Top-level statements: { kind: 'import'|'export-list'|'export-default'|'decl'|'expr', s, e, lead, text, decls, uses,
// imports?, exported }. lead is the comment block right above the statement (no blank line between), part of text.
export function statements(src) {
  const toks = tokenize(src), code = toks.filter((t) => t.t !== 'c'), out = [];
  let i = 0;
  while (i < code.length) {
    const first = i;
    let depth = 0, j = i;
    const head = code.slice(i, i + 4).map((t) => t.v);
    const bodyEnds = (head[0] === 'export' ? head.slice(1) : head).filter((v) => v !== 'default' && v !== 'async')[0];
    const block = bodyEnds === 'function' || bodyEnds === 'class';
    for (; j < code.length; j++) {
      const t = code[j];
      if (t.t !== 'p') continue;
      if ('([{'.includes(t.v)) depth++;
      else if (')]}'.includes(t.v)) { depth--; if (depth === 0 && t.v === '}' && block && code[j + 1]?.v !== ';') break; }
      else if (t.v === ';' && depth === 0) break;
    }
    const last = Math.min(j, code.length - 1);
    out.push(describe(src, toks, code.slice(first, last + 1), code[first].s, code[last].e));
    i = last + 1;
  }
  // attach each statement's leading comment block
  let prevEnd = 0;
  for (const st of out) {
    const gap = src.slice(prevEnd, st.s), lines = gap.split('\n');
    let k = lines.length - 1;   // the statement's own line (text before it on that line is indentation)
    while (k > 0 && /^\s*\/\//.test(lines[k - 1])) k--;
    const lead = lines.slice(k, -1).join('\n');
    st.lead = lead ? lead.replace(/^\s+/, '') + '\n' : '';
    st.text = st.lead + src.slice(st.s, st.e);
    prevEnd = st.e;
  }
  return out;
}

function describe(src, all, ts, s, e) {
  const v = (k) => ts[k]?.v;
  const st = { s, e, decls: new Set(), uses: new Set(), exported: v(0) === 'export', kind: 'expr' };
  let k = 0;
  if (v(0) === 'import' && v(1) !== '(' && v(1) !== '.') {
    st.kind = 'import';
    st.imports = parseImport(ts);
    for (const b of st.imports) st.decls.add(b.local);
    return st;
  }
  if (v(0) === 'export') {
    if (v(1) === '{' || v(1) === '*') { st.kind = 'export-list'; collectUses(ts, 1, st.uses); return st; }
    if (v(1) === 'default') { st.kind = 'export-default'; collectUses(ts, 2, st.uses); return st; }
    k = 1;
  }
  if (v(k) === 'async') k++;
  if (v(k) === 'function' || v(k) === 'class') {
    st.kind = 'decl';
    let n = k + 1;
    if (v(n) === '*') n++;
    st.decls.add(v(n));
    collectUses(ts, n + 1, st.uses);
  } else if (v(k) === 'const' || v(k) === 'let' || v(k) === 'var') {
    st.kind = 'decl';
    declarators(ts, k + 1, st.decls);
    collectUses(ts, k + 1, st.uses);
  } else collectUses(ts, k, st.uses);
  for (const d of st.decls) st.uses.delete(d);
  return st;
}

// Names bound by `const a = ..., { b, c: d } = ..., [e] = ...` (depth 0 of the declarator list).
function declarators(ts, k, into) {
  let depth = 0, expectName = true;
  for (let i = k; i < ts.length; i++) {
    const t = ts[i];
    if (depth === 0 && expectName) {
      if (t.t === 'id') into.add(t.v);
      else if (t.v === '{' || t.v === '[') {   // a pattern: identifiers not followed by ':'
        let d = 0, j = i;
        for (; j < ts.length; j++) {
          const u = ts[j];
          if ('([{'.includes(u.v)) d++; else if (')]}'.includes(u.v)) { d--; if (!d) break; }
          else if (u.t === 'id' && ts[j + 1]?.v !== ':' && ts[j - 1]?.v !== '=' && !KEYWORDS.has(u.v)) into.add(u.v);
        }
        i = j;
      }
      expectName = false;
      continue;
    }
    if (t.t === 'p') {
      if ('([{'.includes(t.v)) depth++;
      else if (')]}'.includes(t.v)) depth--;
      else if (t.v === ',' && depth === 0) expectName = true;
    }
  }
}

// Identifiers read as values: not after '.', not object keys (after '{' or ',' and before ':'), not keywords.
function collectUses(ts, k, into) {
  for (let i = k; i < ts.length; i++) {
    const t = ts[i];
    if (t.t !== 'id' || KEYWORDS.has(t.v)) continue;
    const p = ts[i - 1]?.v, n = ts[i + 1]?.v;
    if (p === '.' || p === '?.') continue;
    if ((p === '{' || p === ',') && n === ':') continue;
    into.add(t.v);
  }
}

// [{ local, imported: 'default' | '*' | name, source }]
function parseImport(ts) {
  const source = ts.find((t) => t.t === 'str')?.v;
  const out = [];
  let i = 1;
  const v = (k) => ts[k]?.v;
  if (ts[i].t === 'str') return out;   // import 'x';
  if (ts[i].t === 'id' && v(i) !== 'from') { out.push({ local: v(i), imported: 'default', source }); i++; if (v(i) === ',') i++; }
  if (v(i) === '*') { out.push({ local: v(i + 2), imported: '*', source }); i += 3; }
  if (v(i) === '{') {
    for (i++; v(i) !== '}'; i++) {
      if (v(i) === ',') continue;
      const imported = v(i);
      if (v(i + 1) === 'as') { out.push({ local: v(i + 2), imported, source }); i += 2; } else out.push({ local: imported, imported, source });
    }
  }
  return out;
}

// Import statements text for bindings grouped by source, in first-seen order.
export function importText(bindings) {
  const by = new Map();
  for (const b of bindings) {
    if (!by.has(b.source)) by.set(b.source, { def: null, ns: null, named: [] });
    const g = by.get(b.source);
    if (b.imported === 'default') g.def = b.local;
    else if (b.imported === '*') g.ns = b.local;
    else if (!g.named.some((n) => n.local === b.local)) g.named.push(b);
  }
  const lines = [];
  for (const [source, g] of by) {
    const parts = [];
    if (g.def) parts.push(g.def);
    if (g.ns) parts.push(`* as ${g.ns}`);
    if (g.named.length) {
      const names = g.named.map((b) => (b.imported === b.local ? b.local : `${b.imported} as ${b.local}`));
      const one = `{ ${names.join(', ')} }`;
      parts.push(one.length > 90 ? `{\n${wrap(names, '  ', 110)}\n}` : one);
    }
    if (g.ns && g.named.length) { lines.push(`import * as ${g.ns} from '${source}';`); parts.splice(parts.indexOf(`* as ${g.ns}`), 1); }
    lines.push(`import ${parts.join(', ')} from '${source}';`);
  }
  return lines.join('\n');
}

function wrap(names, pad, width) {
  const rows = [];
  let row = pad;
  for (const n of names) {
    const add = `${n},`;
    if (row.length + add.length + 1 > width && row.trim()) { rows.push(row.trimEnd()); row = pad; }
    row += (row.trim() ? ' ' : '') + add;
  }
  if (row.trim()) rows.push(row.trimEnd());
  return rows.join('\n');
}
