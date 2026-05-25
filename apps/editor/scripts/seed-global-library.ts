// One-off seed script — NOT run automatically. Copies the example
// templates / behaviors / scenes from `examples/editor-demo/library/` into the
// global library pool at `~/.davidup/library/` (or `$DAVIDUP_LIBRARY`) so a
// developer dogfooding the shared-pool flow has something to look at in the
// Library panel of a freshly opened project.
//
// Usage (from repo root):
//   node --import tsx apps/editor/scripts/seed-global-library.ts [--force]
//
// Flags:
//   --force   overwrite files that already exist in the target. Default is
//             skip-if-exists so user-customised entries are preserved.

import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { defaultLibraryRoot, LIBRARY_SUBDIRS } from '../app/services/global_library_root.js'

const KINDS = ['templates', 'behaviors', 'scenes'] as const

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const sourceRoot = join(repoRoot, 'examples', 'editor-demo', 'library')
const targetRoot = defaultLibraryRoot()

const force = process.argv.includes('--force')

for (const kind of KINDS) {
  if (!LIBRARY_SUBDIRS.includes(kind)) {
    console.error(`internal: ${kind} is not a known library subdir`)
    process.exit(1)
  }
}

await fs.mkdir(targetRoot, { recursive: true })

let copied = 0
let skipped = 0

for (const kind of KINDS) {
  const srcDir = join(sourceRoot, kind)
  const dstDir = join(targetRoot, kind)

  let entries: string[]
  try {
    entries = await fs.readdir(srcDir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`source missing, skipping: ${srcDir}`)
      continue
    }
    throw err
  }

  await fs.mkdir(dstDir, { recursive: true })

  for (const name of entries) {
    const srcPath = join(srcDir, name)
    const dstPath = join(dstDir, name)

    const stat = await fs.stat(srcPath)
    if (!stat.isFile()) continue

    if (!force) {
      try {
        await fs.access(dstPath)
        console.log(`  skip   ${kind}/${name} (exists — pass --force to overwrite)`)
        skipped++
        continue
      } catch {
        // not present — fall through to copy
      }
    }

    await fs.copyFile(srcPath, dstPath)
    console.log(`  copied ${kind}/${name}`)
    copied++
  }
}

console.log(`\ndone: ${copied} copied, ${skipped} skipped → ${targetRoot}`)
