import { defineConfig } from 'vite'
import { getDirname } from '@adonisjs/core/helpers'
import inertia from '@adonisjs/inertia/client'
import vue from '@vitejs/plugin-vue'
import adonisjs from '@adonisjs/vite/client'

export default defineConfig({
  plugins: [inertia({ ssr: { enabled: true, entrypoint: 'inertia/app/ssr.ts' } }), vue(), adonisjs({ entrypoints: ['inertia/app/app.ts'], reload: ['resources/views/**/*.edge'] })],

  /**
   * Define aliases for importing modules from
   * your frontend code
   */
  resolve: {
    alias: {
      '~/': `${getDirname(import.meta.url)}/inertia/`,
    },
  },

  /**
   * The Adonis Vite dev server runs in middleware mode, where Vite binds its
   * HMR websocket on a fixed 24678 unless told otherwise — so a second
   * editor on another `--port` collided with the first. `davidup edit`
   * passes `DAVIDUP_HMR_PORT` (its `--port + 1`); a bare `node ace serve`
   * falls back to `PORT + 1`, then to Vite's default.
   */
  server: { hmr: hmrPort() === undefined ? true : { port: hmrPort() } },

  /**
   * `davidup` is a workspace package consumed as TypeScript source.
   * Excluding its subpath entries from optimizeDeps avoids the stale
   * pre-bundle cache that otherwise served an older `davidup/schema`
   * chunk on first load after the package added new exports — the
   * editor would mount blank with `SyntaxError: ... does not provide
   * an export named 'BLEND_MODES'` until a hard reload rebuilt deps.
   * Serving from source means every edit flows through the normal
   * module graph / HMR, with no separate cache to invalidate.
   */
  optimizeDeps: {
    exclude: ['davidup', 'davidup/schema', 'davidup/engine', 'davidup/easings', 'davidup/assets', 'davidup/browser', 'davidup/compose'],
  },
})

function hmrPort(): number | undefined {
  const pinned = Number.parseInt(process.env.DAVIDUP_HMR_PORT ?? '', 10)
  if (Number.isInteger(pinned) && pinned > 0 && pinned <= 65_535) return pinned
  const port = Number.parseInt(process.env.PORT ?? '', 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined
  return port < 65_535 ? port + 1 : port - 1
}
