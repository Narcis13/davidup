/*
|--------------------------------------------------------------------------
| MCP bridge — same composition store for UI and agent (step 07)
|--------------------------------------------------------------------------
|
| Mounts the existing engine MCP server inside the editor process and routes
| every *mutating* tool call through `commandBus.apply()` with `source: 'mcp'`
| instead of letting the tool mutate a private CompositionStore.
|
| The result of step 06 is one CommandBus that owns the in-memory composition
| and gates every change behind Zod-validated commands; step 07 makes the MCP
| server a second client of that bus rather than a parallel mutation path.
| With this in place the editor surface and Claude Code see byte-equal state.
|
| Routing strategy:
|
|   1. Mutating tools (those listed in COMMAND_TO_TOOL) — intercepted by the
|      DispatchRouter. Args are translated to a Command; commandBus.apply()
|      runs it; the bridge returns what the original tool would have returned
|      so MCP callers can chain follow-up calls (e.g. read back `itemId`).
|
|   2. Read-only tools (validate / get_composition / list_assets /
|      list_tweens / render_*) — fall through to the default handler against
|      a fresh CompositionStore hydrated from `projectStore.composition`.
|      `depsFactory` builds that store per-call so reads always see the
|      latest committed state, even if commandBus.apply() ran between calls.
|
|   3. Registry-management tools (define_scene / define_user_template /
|      import_scene / remove_scene / list_scenes / list_templates /
|      list_behaviors) — fall through. They mutate global module-level
|      registries, not the composition document, so the editor doesn't need
|      to mediate them.
|
|   4. Compositional lifecycle (create_composition / reset) — fall through
|      against the per-call store. They have no effect on the editor's
|      composition (the bridge never points them at it), so they're safe to
|      run against the throwaway store; the registry tools above are the
|      only reason a read-only call needs any store at all.
|
| Surface:
|   - createEditorMcpServer(opts?) — returns a DavidupServer wired with the
|     bridge router + depsFactory. The caller `await server.start()` to
|     attach the stdio transport. Used by start/preload_mcp_stdio.ts when
|     `DAVIDUP_MCP_STDIO=1` is set (so `davidup edit ...` only mounts the
|     stdio surface when an agent is meant to attach).
*/

import { join, sep } from 'node:path'
import {
  CompositionStore,
  MCPToolError,
  createServer,
  type DavidupServer,
  type DispatchResult,
  type DispatchRouter,
  type MCPErrorCode,
  type ProjectControls,
  type ProjectInfo,
  type RecentProjectInfo,
  type ToolDeps,
} from 'davidup/mcp'
import { scaffoldProject, ScaffoldError } from 'davidup/cli/scaffold'

import commandBus, {
  CommandBus,
  CommandRejectedError,
  CommandValidationError,
  PostValidationError,
} from '#services/command_bus'
import projectStore, {
  ProjectLoadError,
  ProjectStore,
} from '#services/project_store'
import recents from '#services/recents'
import { guardProjectDirectory } from '#services/project_paths'
import { hydrateStore } from '#services/apply_command'
import {
  COMMAND_TO_TOOL,
  type Command,
  type CommandKind,
} from '#types/commands'
import type { Composition } from 'davidup/schema'

/** Reverse map: MCP tool name → editor CommandKind. */
const TOOL_TO_COMMAND: ReadonlyMap<string, CommandKind> = new Map(
  (Object.entries(COMMAND_TO_TOOL) as [CommandKind, string][]).map(
    ([kind, toolName]) => [toolName, kind]
  )
)

/** Hydration id used for the per-call read store. Picked so it doesn't clash
 *  with any caller-supplied compositionId. */
const BRIDGE_COMP_ID = '__editor_bridge__'

export interface CreateEditorMcpServerOptions {
  commandBus?: CommandBus
  projectStore?: ProjectStore
  name?: string
  version?: string
}

/**
 * Build an MCP server whose mutating tools route through the editor's
 * CommandBus. The server is unconnected; call `.start()` to attach stdio.
 */
export function createEditorMcpServer(
  opts: CreateEditorMcpServerOptions = {}
): DavidupServer {
  const bus = opts.commandBus ?? commandBus
  const store = opts.projectStore ?? projectStore

  return createServer({
    name: opts.name ?? 'davidup-editor',
    version: opts.version ?? '0.1.0',
    depsFactory: () => buildDeps(store),
    router: buildRouter(bus, store),
  })
}

/** Exposed for tests — a router that does what createEditorMcpServer wires up. */
export function buildRouter(
  bus: CommandBus,
  store: ProjectStore
): DispatchRouter {
  return async (tool, parsedArgs) => {
    const kind = TOOL_TO_COMMAND.get(tool.name)
    if (kind === undefined) return null // fall through

    if (!store.isLoaded) {
      // No project loaded → there is nothing for the CommandBus to mutate.
      // Surface a structured error rather than silently routing nowhere.
      // Re-uses the engine's E_NO_COMPOSITION code so MCP clients see the
      // same vocabulary they would from a direct CompositionStore call.
      return errorResult(
        'E_NO_COMPOSITION',
        'No project loaded; MCP mutations require an active editor project.',
        'Open a project in the editor before driving it from MCP.'
      )
    }

    const payload = stripCompositionId(parsedArgs)
    const command = { kind, payload, source: 'mcp' } as unknown as Command

    try {
      const result = await bus.apply(command)
      return { ok: true, result: normaliseToolResult(result.toolResult) }
    } catch (err) {
      return mapBusErrorToDispatch(err)
    }
  }
}

/** Exposed for tests — deps for a single MCP call: fresh hydrated store. */
export function buildDeps(store: ProjectStore): ToolDeps {
  const compositionStore = new CompositionStore()
  const current = store.composition as Composition | null
  if (current) {
    hydrateStore(compositionStore, current, BRIDGE_COMP_ID)
  }
  return { store: compositionStore, projectControls: buildProjectControls(store) }
}

/**
 * Implements the MCP-side `ProjectControls` contract by reusing the same
 * services the HTTP controllers do: `ProjectStore#load` for open/create,
 * `recents` for list, `scaffoldProject` for create. Errors thrown from here
 * surface to the agent as structured MCPToolError envelopes.
 */
export function buildProjectControls(store: ProjectStore): ProjectControls {
  return {
    current: (): ProjectInfo | null => {
      const p = store.project
      if (!p) return null
      return {
        root: p.root,
        compositionPath: p.compositionPath,
        libraryIndexPath: p.libraryIndexPath,
        assetsDir: p.assetsDir,
        loadedAt: p.loadedAt,
      }
    },
    list: async (): Promise<RecentProjectInfo[]> => {
      const projects = await recents.list()
      return projects.map((p) => ({
        path: p.path,
        name: p.name,
        lastOpenedAt: p.lastOpenedAt,
        lastModifiedAt: p.lastModifiedAt,
      }))
    },
    open: async ({ path }: { path: string }): Promise<ProjectInfo> => {
      const guard = guardProjectDirectory(path)
      if (!guard.ok) throw guardToMcpError(guard)
      try {
        const project = await store.load(guard.directory)
        return {
          root: project.root,
          compositionPath: project.compositionPath,
          libraryIndexPath: project.libraryIndexPath,
          assetsDir: project.assetsDir,
          loadedAt: project.loadedAt,
        }
      } catch (err) {
        throw projectLoadToMcpError(err)
      }
    },
    create: async ({
      name,
      location,
      template,
    }: {
      name: string
      location: string
      template?: string
    }): Promise<ProjectInfo> => {
      const locationGuard = guardProjectDirectory(location)
      if (!locationGuard.ok) throw guardToMcpError(locationGuard)
      // Reject `name` shapes that try to climb out of the location ("..",
      // absolute paths, NUL bytes). `path.join` would normalize most of these
      // away silently, which is exactly the trick we want to block.
      if (
        name.length === 0 ||
        /[\x00-\x1f]/.test(name) ||
        name.includes('..') ||
        name.startsWith('/') ||
        name.startsWith('\\') ||
        /^[a-zA-Z]:[\\/]/.test(name)
      ) {
        throw new MCPToolError(
          'E_INVALID_VALUE',
          '`name` must be a simple directory name, not a path that escapes `location`.',
        )
      }
      const targetDir = join(locationGuard.directory, name)
      // Re-guard the joined path so the resolved target still passes the
      // shared filesystem-path checks (length, control chars, sensitive
      // prefixes).
      const targetGuard = guardProjectDirectory(targetDir)
      if (!targetGuard.ok) throw guardToMcpError(targetGuard)
      // Belt-and-braces containment check: target must live strictly inside
      // `location`. Defensive against any future path-normalisation surprise.
      if (
        targetGuard.directory !== locationGuard.directory &&
        !targetGuard.directory.startsWith(locationGuard.directory + sep)
      ) {
        throw new MCPToolError(
          'E_INVALID_VALUE',
          'Resolved project directory falls outside `location`.',
        )
      }

      try {
        await scaffoldProject({
          targetDir: targetGuard.directory,
          ...(template !== undefined ? { template } : {}),
        })
      } catch (err) {
        if (err instanceof ScaffoldError) {
          const code = err.code === 'E_TEMPLATE_NOT_FOUND' ? 'E_NOT_FOUND' : 'E_INVALID_VALUE'
          throw new MCPToolError(code, err.message)
        }
        throw err
      }

      try {
        const project = await store.load(targetGuard.directory)
        // Honour the supplied `name` as the recents-list label, mirroring the
        // POST /api/projects controller. Best-effort: a recents-write failure
        // never blocks the load.
        await recents.touch(project.root, name).catch(() => {})
        return {
          root: project.root,
          compositionPath: project.compositionPath,
          libraryIndexPath: project.libraryIndexPath,
          assetsDir: project.assetsDir,
          loadedAt: project.loadedAt,
        }
      } catch (err) {
        throw projectLoadToMcpError(err)
      }
    },
  }
}

function guardToMcpError(
  guard: { ok: false; code: 'E_BAD_REQUEST' | 'E_FORBIDDEN_PATH'; message: string },
): MCPToolError {
  // Both guard failure modes map to E_INVALID_VALUE on the MCP surface —
  // there is no distinct "forbidden" code in the engine vocabulary, and from
  // the agent's perspective the request is simply not acceptable.
  return new MCPToolError('E_INVALID_VALUE', guard.message)
}

function projectLoadToMcpError(err: unknown): MCPToolError {
  if (err instanceof ProjectLoadError) {
    const code: MCPErrorCode =
      err.code === 'E_PROJECT_NOT_FOUND' || err.code === 'E_COMPOSITION_MISSING'
        ? 'E_NOT_FOUND'
        : err.code === 'E_COMPOSITION_PARSE' || err.code === 'E_COMPOSITION_INVALID'
          ? 'E_VALIDATION_FAILED'
          : 'E_NO_COMPOSITION'
    return new MCPToolError(code, err.message)
  }
  if (err instanceof Error) return new MCPToolError('E_UNKNOWN', err.message)
  return new MCPToolError('E_UNKNOWN', String(err))
}

// ──────────────── Helpers ────────────────

function stripCompositionId(
  args: Record<string, unknown>
): Record<string, unknown> {
  if (!('compositionId' in args)) return args
  const { compositionId: _ignored, ...rest } = args
  void _ignored
  return rest
}

function normaliseToolResult(value: unknown): unknown {
  // The MCP tool layer expects an object payload (server.ts wraps non-objects
  // under `{ value }`). For ergonomic chaining we forward whatever the tool
  // would have produced; commandBus.apply already returns those shapes.
  return value ?? { ok: true as const }
}

function errorResult(
  code: MCPErrorCode,
  message: string,
  hint?: string
): DispatchResult {
  const body: { code: MCPErrorCode; message: string; hint?: string } = {
    code,
    message,
  }
  if (hint !== undefined) body.hint = hint
  return { ok: false, error: body }
}

/**
 * Translate editor-layer errors into the engine's `MCPErrorCode` vocabulary
 * so MCP clients see the same error envelope a direct tool call would emit.
 *
 *   - CommandRejectedError already carries an engine code (`E_NOT_FOUND`,
 *     `E_TWEEN_OVERLAP`, …) bubbled up from the underlying tool handler;
 *     pass it through after narrowing the type.
 *   - CommandValidationError + PostValidationError + ProjectLoadError +
 *     anything else map to the closest engine code.
 */
function mapBusErrorToDispatch(err: unknown): DispatchResult {
  if (err instanceof CommandValidationError) {
    const issue = err.issues[0]
    return errorResult(
      'E_INVALID_VALUE',
      err.message,
      issue?.path ? `Invalid value at "${issue.path}".` : undefined
    )
  }
  if (err instanceof CommandRejectedError) {
    return errorResult(narrowMcpCode(err.code), err.message, err.hint)
  }
  if (err instanceof PostValidationError) {
    const first = err.result.errors[0]?.message
    return errorResult(
      'E_VALIDATION_FAILED',
      err.message,
      first ?? 'Composition would fail validation after the mutation.'
    )
  }
  if (err instanceof ProjectLoadError) {
    return errorResult('E_NO_COMPOSITION', err.message)
  }
  if (err instanceof Error) {
    return errorResult('E_UNKNOWN', err.message)
  }
  return errorResult('E_UNKNOWN', String(err))
}

const KNOWN_CODES = new Set<string>([
  'E_NO_COMPOSITION',
  'E_DUPLICATE_ID',
  'E_NOT_FOUND',
  'E_VALIDATION_FAILED',
  'E_TWEEN_OVERLAP',
  'E_INVALID_PROPERTY',
  'E_LAYER_NOT_EMPTY',
  'E_ASSET_IN_USE',
  'E_ASSET_TYPE_MISMATCH',
  'E_INVALID_VALUE',
  'E_RENDER_FAILED',
  'E_BEHAVIOR_UNKNOWN',
  'E_BEHAVIOR_PARAM_MISSING',
  'E_BEHAVIOR_PARAM_TYPE',
  'E_TEMPLATE_UNKNOWN',
  'E_TEMPLATE_PARAM_MISSING',
  'E_TEMPLATE_PARAM_TYPE',
  'E_SCENE_UNKNOWN',
  'E_SCENE_PARAM_MISSING',
  'E_SCENE_PARAM_TYPE',
  'E_SCENE_RECURSION',
  'E_SCENE_INSTANCE_DEEP_TARGET',
  'E_ASSET_CONFLICT',
  'E_TIME_MAPPING_INVALID',
  'E_TIME_MAPPING_TWEEN_SPLIT',
  'E_UNKNOWN',
])

function narrowMcpCode(code: string): MCPErrorCode {
  return (KNOWN_CODES.has(code) ? code : 'E_UNKNOWN') as MCPErrorCode
}

