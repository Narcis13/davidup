/*
|--------------------------------------------------------------------------
| Global library preload
|--------------------------------------------------------------------------
|
| Attaches the shared library pool (env `DAVIDUP_LIBRARY`, default
| `~/.davidup/library`) into `LibraryIndex` once at server boot. The global
| root is permanent for the lifetime of the process; per-project attachments
| happen later (see `preload_project.ts` → `projectStore.load()`).
|
| Runs before `preload_project` so any project that attaches afterwards
| merges against an already-populated global catalog on its first reload.
|
| Failures here are logged but non-fatal: the catalog still works with the
| project root only, and the editor surfaces empty-global state gracefully.
*/

import libraryIndex from '#services/library_index'
import globalLibraryRoot from '#services/global_library_root'
import logger from '@adonisjs/core/services/logger'

try {
  const root = await globalLibraryRoot.ensure()
  await libraryIndex.attachGlobal(root)
  logger.info({ root }, 'preload_global_library: global pool attached')
} catch (err) {
  logger.error({ err }, 'preload_global_library: failed to attach global pool')
}
