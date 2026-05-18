import type { HttpContext } from '@adonisjs/core/http'
import { listScaffoldTemplates } from 'davidup/cli/scaffold'
import recents from '#services/recents'

/**
 * Hydrates the home page (`inertia/pages/home.vue` — the project picker).
 *
 * Props passed in:
 *  - `projects`: list of recent projects (newest first; pruned of any whose
 *    directory no longer exists on disk).
 *  - `templates`: available scaffold template names (from `davidup/cli/scaffold`).
 *  - `loadedProjectRoot`: the absolute path of the currently loaded project,
 *    if any — lets the picker show a "Continue editing" affordance.
 */
export default class HomeController {
  async show({ inertia }: HttpContext) {
    const [projects, templates] = await Promise.all([
      recents.list(),
      listScaffoldTemplates().catch(() => ['basic']),
    ])
    return inertia.render('home', {
      projects,
      templates: templates.length > 0 ? templates : ['basic'],
    })
  }
}
