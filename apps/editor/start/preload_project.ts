/*
|--------------------------------------------------------------------------
| Project preload
|--------------------------------------------------------------------------
|
| The `davidup edit <dir>` CLI sets `DAVIDUP_PROJECT` to an absolute path
| before booting this AdonisJS server. This preload hook loads that
| directory into the in-memory ProjectStore so the editor is usable the
| moment the HTTP server accepts connections.
|
| If `DAVIDUP_PROJECT` is unset (e.g. when running tests or `node ace`
| directly) we no-op — tests drive `projectStore.load()` explicitly and the
| `/api/project` controller returns 404 until a project is loaded.
|
| Load failures are logged but do not block the server from starting; the
| editor surfaces the error in the UI via the `/api/project` 404 response.
*/

import projectStore from '#services/project_store'
import logger from '@adonisjs/core/services/logger'

const target = process.env.DAVIDUP_PROJECT
if (target) {
  try {
    await projectStore.load(target)
    logger.info({ dir: target }, 'preload_project: composition loaded')
  } catch (err) {
    logger.error({ err, dir: target }, 'preload_project: failed to load project')
  }
} else {
  logger.debug('preload_project: DAVIDUP_PROJECT not set, skipping')
}
