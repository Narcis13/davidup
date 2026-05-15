// Runtime resolution check: every subpath the editor PRD calls out must resolve
// through the workspace symlink + davidup/exports map. Typecheck of these from
// server-side is out of scope (browser driver needs DOM lib in client tsconfig).
const subpaths = ['davidup/schema', 'davidup/node', 'davidup/browser', 'davidup/mcp'] as const

for (const sub of subpaths) {
  const mod = await import(sub)
  if (!mod || typeof mod !== 'object') {
    console.error(`failed to import ${sub}`)
    process.exit(1)
  }
  console.log(`${sub} -> ${Object.keys(mod).slice(0, 4).join(', ')}${Object.keys(mod).length > 4 ? ', ...' : ''}`)
}

console.log('ok: all PRD subpaths resolve at runtime')
