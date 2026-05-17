// Recents registry — the list of recently-opened projects, persisted to
// `~/.davidup/recents.json` (or `$DAVIDUP_STATE_DIR/recents.json` when set).
//
// Lives outside any project, like editor_state, because recents are a
// user-level preference. Atomic writes (tmp + rename) so a torn file can't
// survive a crash (R-P4 in polish_plan.md). Entries whose `path` no longer
// resolves to a directory are pruned on every read — a project deleted from
// disk should not linger in the picker.

import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import logger from '@adonisjs/core/services/logger'

export type RecentProject = {
  path: string
  name: string
  lastOpenedAt: number
  lastModifiedAt: number
}

type RecentsFile = {
  projects: RecentProject[]
}

export class RecentsStore {
  #explicitPath: string | null

  constructor(opts: { path?: string } = {}) {
    this.#explicitPath = opts.path ?? null
  }

  /**
   * Absolute path of the recents.json file. Resolved on every access so
   * tests can flip `DAVIDUP_STATE_DIR` (or call setPath) after construction.
   */
  get path(): string {
    return this.#explicitPath ?? defaultRecentsPath()
  }

  /** Override the path. Tests use this; production keeps defaults. */
  setPath(path: string | null): void {
    this.#explicitPath = path
  }

  /**
   * Return the recents list sorted by lastOpenedAt desc. Entries whose
   * `path` no longer resolves to a directory are omitted (pruned). The
   * on-disk file is not rewritten here — the next touch() does the
   * canonical write.
   */
  async list(): Promise<RecentProject[]> {
    const raw = await this.#readRaw()
    const live = await pruneMissing(raw.projects)
    return [...live].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }

  /**
   * Upsert an entry for `projectPath` and bump its lastOpenedAt to now.
   * `lastModifiedAt` is read from the composition.json mtime when present,
   * falling back to now. Missing entries are pruned before writing.
   * Returns the resulting list (sorted by lastOpenedAt desc).
   */
  async touch(projectPath: string, name?: string): Promise<RecentProject[]> {
    const root = resolve(projectPath)
    const now = Date.now()
    const compMtime = await statMtime(join(root, 'composition.json'))
    const entry: RecentProject = {
      path: root,
      name: name && name.length > 0 ? name : basename(root),
      lastOpenedAt: now,
      lastModifiedAt: compMtime ?? now,
    }
    const raw = await this.#readRaw()
    const others = raw.projects.filter((p) => p.path !== root)
    const live = await pruneMissing([entry, ...others])
    await this.#write({ projects: live })
    return [...live].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }

  async #readRaw(): Promise<RecentsFile> {
    let raw: string
    try {
      raw = await fs.readFile(this.path, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.warn(
          { err, path: this.path },
          'recents: failed to read recents.json — using empty list',
        )
      }
      return { projects: [] }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      logger.warn({ err, path: this.path }, 'recents: malformed recents.json — using empty list')
      return { projects: [] }
    }
    return normalize(parsed)
  }

  async #write(state: RecentsFile): Promise<void> {
    const path = this.path
    await fs.mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    const json = `${JSON.stringify(state, null, 2)}\n`
    await fs.writeFile(tmp, json, 'utf8')
    await fs.rename(tmp, path)
  }
}

function normalize(input: unknown): RecentsFile {
  const src = (input ?? {}) as { projects?: unknown }
  if (!Array.isArray(src.projects)) return { projects: [] }
  const out: RecentProject[] = []
  for (const raw of src.projects) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.path !== 'string' || r.path.length === 0) continue
    const lastOpenedAt = Number(r.lastOpenedAt)
    const lastModifiedAt = Number(r.lastModifiedAt)
    out.push({
      path: r.path,
      name: typeof r.name === 'string' && r.name.length > 0 ? r.name : basename(r.path),
      lastOpenedAt: Number.isFinite(lastOpenedAt) ? lastOpenedAt : 0,
      lastModifiedAt: Number.isFinite(lastModifiedAt) ? lastModifiedAt : 0,
    })
  }
  return { projects: out }
}

async function pruneMissing(projects: RecentProject[]): Promise<RecentProject[]> {
  const alive = await Promise.all(
    projects.map((p) =>
      fs
        .stat(p.path)
        .then((s) => s.isDirectory())
        .catch(() => false),
    ),
  )
  return projects.filter((_, i) => alive[i])
}

async function statMtime(path: string): Promise<number | null> {
  try {
    const s = await fs.stat(path)
    return s.mtimeMs
  } catch {
    return null
  }
}

export function defaultRecentsPath(): string {
  const override = process.env.DAVIDUP_STATE_DIR
  const dir = override ? override : join(homedir(), '.davidup')
  return join(dir, 'recents.json')
}

const recents = new RecentsStore()
export default recents
