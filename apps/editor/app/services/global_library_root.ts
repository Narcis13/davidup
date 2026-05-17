// Global library root — the shared pool every project draws from.
//
// Resolves the on-disk location once (env var `DAVIDUP_LIBRARY` wins, else
// `~/.davidup/library`) and lazily creates the standard subdir layout the
// shared-pool contract promises (templates / behaviors / scenes / assets /
// fonts). Lives outside any project, like `editor_state` does.

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LIBRARY_SUBDIRS = [
  'templates',
  'behaviors',
  'scenes',
  'assets',
  'fonts',
] as const

export class GlobalLibraryRoot {
  #explicitPath: string | null
  #ensured = false

  constructor(opts: { path?: string } = {}) {
    this.#explicitPath = opts.path ?? null
  }

  /**
   * Absolute path of the global library root. Resolved on every access so
   * tests can flip `DAVIDUP_LIBRARY` after construction.
   */
  get path(): string {
    return this.#explicitPath ?? defaultLibraryRoot()
  }

  /** Override the root path. Tests use this; production keeps defaults. */
  setPath(path: string | null): void {
    this.#explicitPath = path
    this.#ensured = false
  }

  /**
   * Ensure the standard subdir tree exists. Idempotent — the first caller
   * creates the directories, subsequent calls are no-ops in the same
   * process. Re-runs after {@link setPath} (which clears the flag).
   */
  async ensure(): Promise<string> {
    const root = this.path
    if (this.#ensured) return root
    await fs.mkdir(root, { recursive: true })
    await Promise.all(
      LIBRARY_SUBDIRS.map((sub) => fs.mkdir(join(root, sub), { recursive: true })),
    )
    this.#ensured = true
    return root
  }
}

export function defaultLibraryRoot(): string {
  const override = process.env.DAVIDUP_LIBRARY
  if (override && override.length > 0) return override
  return join(homedir(), '.davidup', 'library')
}

const globalLibraryRoot = new GlobalLibraryRoot()
export default globalLibraryRoot
