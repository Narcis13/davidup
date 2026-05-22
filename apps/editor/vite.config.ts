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
