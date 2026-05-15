import type { HttpContext } from '@adonisjs/core/http'
import editorState, { type PanelLayout } from '#services/editor_state'

/**
 * GET /api/editor-state — return the persisted UI state (panel sizes etc.).
 * PUT /api/editor-state — merge `panelLayout` into stored state and rewrite
 * `~/.davidup/state.json`. Both endpoints back the `usePanelLayout`
 * composable used by `inertia/layouts/editor.vue` (step 08).
 */
export default class EditorStateController {
  async show({ response }: HttpContext) {
    const state = await editorState.read()
    return response.ok(state)
  }

  async update({ request, response }: HttpContext) {
    const body = request.body() as {
      panelLayout?: Partial<PanelLayout> | null
    }
    if (body.panelLayout && typeof body.panelLayout !== 'object') {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: '`panelLayout` must be an object' },
      })
    }
    const next = await editorState.update({
      panelLayout: body.panelLayout ?? undefined,
    })
    return response.ok(next)
  }
}
