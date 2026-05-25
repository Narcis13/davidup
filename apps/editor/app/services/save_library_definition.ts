// Persist a user-authored library definition (template / behavior / scene)
// as a standalone JSON file under the chosen root.
//
// Pair with `promote_library_item.ts`:
//   * save → put a new definition on disk in either project or global
//   * promote → move an existing project file into global
//
// The watcher in library_index picks the new file up and the registry +
// merged catalog converge within ~1s; we also call `libraryIndex.flush()`
// so the response already reflects the on-disk write.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import libraryIndex, { type LibraryScope } from '#services/library_index'
import globalLibraryRoot from '#services/global_library_root'

export type DefinitionKind = 'template' | 'behavior' | 'scene'

const DEFINITION_KINDS: ReadonlySet<DefinitionKind> = new Set([
  'template',
  'behavior',
  'scene',
])

export type SaveErrorCode =
  | 'E_BAD_REQUEST'
  | 'E_KIND_UNSUPPORTED'
  | 'E_NO_PROJECT_LIBRARY'
  | 'E_NO_GLOBAL_LIBRARY'
  | 'E_TARGET_EXISTS'
  | 'E_WRITE_FAILED'

export class SaveDefinitionError extends Error {
  code: SaveErrorCode
  details?: unknown
  constructor(code: SaveErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'SaveDefinitionError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export interface SaveDefinitionOptions {
  kind: DefinitionKind
  id: string
  target: LibraryScope
  /**
   * The definition body, minus the `id` field (which we encode in both the
   * filename and the JSON object so the watcher can derive it either way).
   */
  body: Record<string, unknown>
  /** When the target file already exists, overwrite without prompting. */
  force?: boolean
}

export interface SaveDefinitionResult {
  kind: DefinitionKind
  id: string
  target: LibraryScope
  /** Absolute path of the file we wrote. */
  path: string
  /** Path relative to the owning root — surfaces nicely in the UI. */
  relative: string
}

export async function saveLibraryDefinition(
  opts: SaveDefinitionOptions,
): Promise<SaveDefinitionResult> {
  const { kind, id, target, body } = opts
  if (!id) {
    throw new SaveDefinitionError('E_BAD_REQUEST', '`id` is required')
  }
  if (!DEFINITION_KINDS.has(kind)) {
    throw new SaveDefinitionError(
      'E_KIND_UNSUPPORTED',
      `Unknown definition kind "${kind}". Allowed: template, behavior, scene.`,
    )
  }
  if (target !== 'project' && target !== 'global') {
    throw new SaveDefinitionError(
      'E_BAD_REQUEST',
      `Unknown target "${target}". Allowed: project, global.`,
    )
  }
  if (!body || typeof body !== 'object') {
    throw new SaveDefinitionError('E_BAD_REQUEST', '`body` must be an object')
  }

  const root = await resolveRoot(target)
  const subdir = `${kind}s`
  const filename = `${id}.${kind}.json`
  const relative = `${subdir}/${filename}`
  const path = join(root, relative)

  const existing = await fs.stat(path).catch(() => null)
  if (existing && !opts.force) {
    throw new SaveDefinitionError(
      'E_TARGET_EXISTS',
      `${target === 'global' ? 'Global' : 'Project'} library already has ${kind} "${id}" at ${relative}. Pass force=true to overwrite.`,
      { existingPath: path, existingRelative: relative },
    )
  }

  // Always stamp the id into the JSON body so the watcher reads the
  // intended id even if the filename is later renamed by hand.
  const finalBody = { id, ...body }

  await fs.mkdir(dirname(path), { recursive: true })
  try {
    await fs.writeFile(path, JSON.stringify(finalBody, null, 2) + '\n', 'utf8')
  } catch (err) {
    throw new SaveDefinitionError(
      'E_WRITE_FAILED',
      `Failed to write ${path}: ${(err as Error).message}`,
    )
  }

  // The watcher will catch the new file within ~1s; this forces an
  // immediate re-read so the next /api/library call sees the new entry
  // (and subsequent promote requests can find it).
  await libraryIndex.reloadNow()

  return { kind, id, target, path, relative }
}

async function resolveRoot(target: LibraryScope): Promise<string> {
  if (target === 'project') {
    const root = libraryIndex.root
    if (!root) {
      throw new SaveDefinitionError(
        'E_NO_PROJECT_LIBRARY',
        'No project library is attached. Open a project first.',
      )
    }
    return root
  }
  // Global: ensure the directory tree exists (idempotent) so first-time
  // users don't have to mkdir manually.
  const root = libraryIndex.globalRoot
  if (root) return await globalLibraryRoot.ensure()
  // Watcher may not be attached yet (rare — set up at boot); fall back to
  // resolving via the singleton anyway.
  return await globalLibraryRoot.ensure()
}
