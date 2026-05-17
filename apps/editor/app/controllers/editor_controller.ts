import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { normalize, relative, resolve } from 'node:path'
import type { HttpContext } from '@adonisjs/core/http'
import projectStore from '#services/project_store'
import globalLibraryRoot from '#services/global_library_root'

export interface CompositionSource {
  /** Authored JSON text exactly as it lives on disk. */
  text: string
  /** Absolute path of the file the text came from. */
  file: string
  /** mtime in ms — lets the client cache and re-fetch only on change. */
  mtimeMs: number
}

/**
 * Read the authored composition.json text from disk. Flushes any pending
 * project_store writes first so the returned text reflects the latest
 * committed state. Returns null when no project is loaded.
 *
 * Note: `composition.json` on disk holds the *authored* JSON — the form the
 * user wrote, including any $template / $ref / scene / $behavior constructs
 * the precompile pipeline lowers into the in-memory canonical composition.
 * That's exactly what the step-17 "reveal in source" drawer should display.
 */
export async function loadAuthoredCompositionSource(): Promise<CompositionSource | null> {
  const project = projectStore.project
  if (!project) return null
  // Make sure the in-memory mutations (Inspector edits, MCP commands) have
  // hit disk before we read — otherwise the drawer would show stale text.
  await projectStore.flush()
  const text = await fs.readFile(project.compositionPath, 'utf8').catch(() => null)
  if (text === null) return null
  const stat = await fs.stat(project.compositionPath).catch(() => null)
  return {
    text,
    file: project.compositionPath,
    mtimeMs: stat?.mtimeMs ?? Date.now(),
  }
}

const PROJECT_FILES_PREFIX = '/project-files'
const LIBRARY_FILES_PREFIX = '/library-files'

type AssetLike = { src?: unknown; [k: string]: unknown }
type CompositionLike = { assets?: unknown; [k: string]: unknown }

/**
 * Rewrite every asset.src in `composition` to an absolute URL under
 * `${PROJECT_FILES_PREFIX}/<relative-from-project-root>`.
 *
 * The on-disk composition stores `src` as a path relative to the project
 * root (e.g. `./ball.png`, `fonts/Display.ttf`). The browser driver's asset
 * loader needs a URL it can fetch — the `/project-files/*` route serves
 * those files back. Asset srcs that are already absolute URLs or data URIs
 * are left alone.
 */
export function rewriteAssetsForBrowser(composition: unknown): unknown {
  if (!composition || typeof composition !== 'object') return composition
  const cloned = JSON.parse(JSON.stringify(composition)) as CompositionLike
  if (!Array.isArray(cloned.assets)) return cloned
  for (const asset of cloned.assets as AssetLike[]) {
    if (typeof asset.src !== 'string') continue
    asset.src = toProjectFileUrl(asset.src)
  }
  return cloned
}

function toProjectFileUrl(src: string): string {
  // Shared-pool srcs map to the global library route, not the project root.
  if (src.startsWith('global:')) {
    const rest = src.slice('global:'.length).replace(/^\/+/, '')
    return `${LIBRARY_FILES_PREFIX}/${rest}`
  }
  if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:')) return src
  // Strip leading ./ and / so it lines up with the `/project-files/...` route.
  const trimmed = src.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
  return `${PROJECT_FILES_PREFIX}/${trimmed}`
}

export default class EditorController {
  /**
   * GET /editor — render the single Inertia page that mounts the engine.
   *
   * Passes the currently loaded composition (asset srcs rewritten) plus a
   * tiny project descriptor. When no project is loaded the page still
   * renders, but with `composition: null` and a friendly error payload so
   * the user sees instructions instead of a blank canvas.
   */
  async show({ inertia }: HttpContext) {
    const project = projectStore.project
    if (!project) {
      return inertia.render('editor', {
        composition: null,
        compositionSource: null,
        project: null,
        error: {
          code: 'E_NO_PROJECT',
          message:
            'No project loaded. Boot the editor with `davidup edit <dir>`.',
        },
      })
    }

    const compositionSource = await loadAuthoredCompositionSource()

    return inertia.render('editor', {
      composition: rewriteAssetsForBrowser(project.composition),
      compositionSource,
      project: {
        root: project.root,
        compositionPath: project.compositionPath,
        libraryIndexPath: project.libraryIndexPath,
        assetsDir: project.assetsDir,
        loadedAt: project.loadedAt,
      },
      error: null,
    })
  }

  /**
   * GET /api/composition-source — fresh read of the authored composition.json
   * text from disk. The Inertia page bootstrap also embeds this same payload
   * for first paint, but the drawer re-fetches after commands so the line
   * mapping stays in sync with the latest persisted state.
   */
  async compositionSource({ response }: HttpContext) {
    const project = projectStore.project
    if (!project) {
      return response.notFound({
        error: { code: 'E_NO_PROJECT', message: 'No project loaded' },
      })
    }
    const source = await loadAuthoredCompositionSource()
    if (!source) {
      return response.notFound({
        error: { code: 'E_COMPOSITION_MISSING', message: 'composition.json not found on disk' },
      })
    }
    return response.ok(source)
  }

  /**
   * GET /library-files/* — stream any file under the global library root.
   * Mirrors {@link file} but rooted at `$DAVIDUP_LIBRARY` (default
   * `~/.davidup/library`). No project needs to be loaded — the shared
   * pool exists at server scope. Same path-traversal guard.
   */
  async libraryFile({ params, response }: HttpContext) {
    const root = await globalLibraryRoot.ensure()

    const raw = params['*']
    const segments = Array.isArray(raw) ? raw : raw ? [String(raw)] : []
    if (segments.length === 0) {
      return response.badRequest({
        error: { code: 'E_EMPTY_PATH', message: 'File path is required' },
      })
    }

    const rel = normalize(segments.join('/'))
    const target = resolve(root, rel)
    // Resolved path must remain inside the library root — block `../` traversal.
    const inside = relative(root, target)
    if (inside.startsWith('..') || resolve(root, inside) !== target) {
      return response.forbidden({
        error: { code: 'E_PATH_TRAVERSAL', message: 'Path escapes library root' },
      })
    }

    const stat = await fs.stat(target).catch(() => null)
    if (!stat || !stat.isFile()) {
      return response.notFound({
        error: { code: 'E_FILE_NOT_FOUND', message: `Not found: ${rel}` },
      })
    }

    response.header('content-length', String(stat.size))
    response.header('cache-control', 'no-cache')
    response.type(extToContentType(target))
    return response.stream(createReadStream(target))
  }

  /**
   * GET /project-files/* — stream any file under the loaded project's
   * root. Path traversal is blocked: the resolved absolute path must stay
   * inside `project.root`. Returns 404 when no project is loaded or the
   * file does not exist.
   */
  async file({ params, response }: HttpContext) {
    const project = projectStore.project
    if (!project) {
      return response.notFound({
        error: { code: 'E_NO_PROJECT', message: 'No project loaded' },
      })
    }

    const raw = params['*']
    const segments = Array.isArray(raw) ? raw : raw ? [String(raw)] : []
    if (segments.length === 0) {
      return response.badRequest({
        error: { code: 'E_EMPTY_PATH', message: 'File path is required' },
      })
    }

    const rel = normalize(segments.join('/'))
    const target = resolve(project.root, rel)
    // The resolved path must remain inside project.root — block `../` traversal.
    const inside = relative(project.root, target)
    if (inside.startsWith('..') || resolve(project.root, inside) !== target) {
      return response.forbidden({
        error: { code: 'E_PATH_TRAVERSAL', message: 'Path escapes project root' },
      })
    }

    const stat = await fs.stat(target).catch(() => null)
    if (!stat || !stat.isFile()) {
      return response.notFound({
        error: { code: 'E_FILE_NOT_FOUND', message: `Not found: ${rel}` },
      })
    }

    response.header('content-length', String(stat.size))
    response.header('cache-control', 'no-cache')
    response.type(extToContentType(target))
    return response.stream(createReadStream(target))
  }
}

function extToContentType(path: string): string {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'ttf':
      return 'font/ttf'
    case 'otf':
      return 'font/otf'
    case 'woff':
      return 'font/woff'
    case 'woff2':
      return 'font/woff2'
    case 'json':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}

// Re-export the URL prefix so route definitions stay in lockstep with rewrite.
export const PROJECT_FILES_URL_PREFIX = PROJECT_FILES_PREFIX
export const LIBRARY_FILES_URL_PREFIX = LIBRARY_FILES_PREFIX
