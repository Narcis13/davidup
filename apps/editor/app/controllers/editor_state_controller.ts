import type { HttpContext } from '@adonisjs/core/http'
import editorState, {
  type OnboardingState,
  type PanelLayout,
  type RenderPrefs,
} from '#services/editor_state'

/**
 * GET /api/editor-state — return the persisted UI state (panel sizes etc.).
 * PUT /api/editor-state — merge a partial state into stored state and rewrite
 * `~/.davidup/state.json`. Mutable keys: `panelLayout`, `renderPrefs`
 * (UX_GAPS §N), `onboarding` (UX_GAPS §S).
 */
export default class EditorStateController {
  async show({ response }: HttpContext) {
    const state = await editorState.read()
    return response.ok(state)
  }

  async update({ request, response }: HttpContext) {
    const body = request.body() as {
      panelLayout?: Partial<PanelLayout> | null
      renderPrefs?: Partial<RenderPrefs> | null
      onboarding?: Partial<OnboardingState> | null
    }
    if (body.panelLayout && typeof body.panelLayout !== 'object') {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: '`panelLayout` must be an object' },
      })
    }
    if (body.renderPrefs && typeof body.renderPrefs !== 'object') {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: '`renderPrefs` must be an object' },
      })
    }
    if (body.onboarding && typeof body.onboarding !== 'object') {
      return response.badRequest({
        error: { code: 'E_BAD_REQUEST', message: '`onboarding` must be an object' },
      })
    }
    const next = await editorState.update({
      panelLayout: body.panelLayout ?? undefined,
      renderPrefs: body.renderPrefs ?? undefined,
      onboarding: body.onboarding ?? undefined,
    })
    return response.ok(next)
  }
}
