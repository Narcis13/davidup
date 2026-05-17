import type { HttpContext } from '@adonisjs/core/http'

import commandBus, {
  CommandRejectedError,
  CommandValidationError,
  PostValidationError,
} from '#services/command_bus'
import projectStore, { ProjectLoadError } from '#services/project_store'

export default class CommandsController {
  /**
   * POST /api/command — apply a typed command to the loaded composition.
   *
   * Body: a single Command object (`{ kind, payload, source? }`). The bus
   * Zod-validates it, runs `applyCommand`, snapshots the previous state for
   * undo, persists via ProjectStore's debounced writer, and returns the next
   * composition.
   *
   * Status codes:
   *   200 — applied, returns `{ composition, command, undoStackSize, toolResult }`.
   *   400 — malformed command shape (Zod rejection).
   *   404 — no project loaded.
   *   409 — tool rejected the mutation (E_TWEEN_OVERLAP, E_NOT_FOUND, …).
   *   422 — applied but next composition fails schema validation.
   */
  async apply({ request, response }: HttpContext) {
    if (!projectStore.isLoaded) {
      return response.notFound({
        error: {
          code: 'E_NO_PROJECT',
          message: 'No project loaded.',
          hint: 'POST /api/project with a directory first.',
        },
      })
    }

    try {
      const result = await commandBus.apply(request.body())
      return response.ok({
        composition: result.composition,
        command: result.command,
        undoStackSize: result.undoStackSize,
        toolResult: result.toolResult,
      })
    } catch (err) {
      if (err instanceof CommandValidationError) {
        return response.badRequest({
          error: { code: err.code, message: err.message, issues: err.issues },
        })
      }
      if (err instanceof ProjectLoadError) {
        return response.notFound({ error: { code: err.code, message: err.message } })
      }
      if (err instanceof CommandRejectedError) {
        return response.status(409).send({
          error: { code: err.code, message: err.message, hint: err.hint },
        })
      }
      if (err instanceof PostValidationError) {
        return response.status(422).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.result,
          },
        })
      }
      throw err
    }
  }
}
