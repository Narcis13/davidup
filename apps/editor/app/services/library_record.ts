// The record drawer (docs/asset-library-plan.md E4): one asset library record
// read and edited by the editor itself.
//
// Clicking a record card opens a drawer that shows what search reads (name,
// desc, tags, licence, credit, source), the record's facts, what it was made
// from and what was made from it. The read is the MCP `get_asset`, the edit
// the MCP `tag_asset`, both dispatched in-process as E2's upload and E3's
// promote dispatch `add_asset`. `tag_asset` writes the shelf, not the
// composition, so an edit is no command and no undo step; the catalog is
// re-read before the answer, so the panel's next search sees the edit.

import { CompositionStore, TOOLS, dispatchTool } from 'davidup/mcp'

import libraryIndex from '#services/library_index'

const GET_ASSET = TOOLS.find((t) => t.name === 'get_asset')
const TAG_ASSET = TOOLS.find((t) => t.name === 'tag_asset')

/** The fields of a record the drawer edits (tag_asset's input, less `id`). */
export const EDITABLE_FIELDS = [
  'add',
  'remove',
  'name',
  'desc',
  'credit',
  'source',
  'licence',
  'shelf',
] as const

export class LibraryRecordError extends Error {
  readonly code: string
  readonly hint: string | undefined
  readonly status: number
  constructor(code: string, message: string, status: number, hint?: string) {
    super(message)
    this.name = 'LibraryRecordError'
    this.code = code
    this.status = status
    this.hint = hint
  }
}

/** HTTP status of a get_asset / tag_asset failure: bad input 400, no such record 404. */
function statusOf(code: string): number {
  if (code === 'E_INVALID_VALUE' || code === 'E_INVALID_PROPERTY') return 400
  if (code === 'E_ASSET_MISSING') return 404
  return 500
}

type Tool = NonNullable<typeof GET_ASSET>

async function run(tool: Tool | undefined, name: string, args: Record<string, unknown>) {
  if (!tool) {
    throw new LibraryRecordError('E_FEATURE_UNAVAILABLE', `This davidup has no ${name} tool.`, 501)
  }
  const project = libraryIndex.assetProject
  const out = await dispatchTool(tool, args, {
    store: new CompositionStore(),
    ...(project ? { assetProject: project } : {}),
  })
  if (!out.ok) {
    throw new LibraryRecordError(
      out.error.code,
      out.error.message,
      statusOf(out.error.code),
      out.error.hint
    )
  }
  return out.result as Record<string, unknown>
}

/**
 * `get_asset { id }` on the shelves the panel lists: the record in full, its
 * shelves, `made.from` / `made.into`, `same` and `use`.
 */
export async function readLibraryRecord(id: string): Promise<Record<string, unknown>> {
  return run(GET_ASSET, 'get_asset', { id })
}

/**
 * `tag_asset` with the drawer's edit (`add` / `remove` tags, `name`, `desc`,
 * `credit`, `source`, `licence`, and the `shelf` whose record it is), then the
 * record as `get_asset` reads it now. Fields outside tag_asset's are refused
 * before anything is written.
 */
export async function editLibraryRecord(
  body: Record<string, unknown>
): Promise<{ edit: Record<string, unknown>; detail: Record<string, unknown> }> {
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) throw new LibraryRecordError('E_INVALID_VALUE', 'Body `id` is required.', 400)
  const extra = Object.keys(body).filter(
    (k) => k !== 'id' && !(EDITABLE_FIELDS as readonly string[]).includes(k)
  )
  if (extra.length) {
    throw new LibraryRecordError(
      'E_INVALID_VALUE',
      `A record edit takes ${EDITABLE_FIELDS.join(', ')}, not ${extra.join(', ')}.`,
      400,
      "The bytes, kind and id are the record's; upload again to change them."
    )
  }
  const edit = await run(TAG_ASSET, 'tag_asset', body)
  // The panel searches the catalog: re-read it now rather than on the shelf's next poll.
  await libraryIndex.reloadNow().catch(() => {})
  const detail = await readLibraryRecord(id)
  return { edit, detail }
}
