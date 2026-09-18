import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

// `DAVIDUP_DB_PATH` lets a packaged install (npm global install, `npx davidup
// edit`) point the sqlite file at a writable, stable location (~/.davidup/)
// instead of `app.tmpPath()`, which resolves inside the installed package
// directory and may not be writable (or may be wiped on reinstall). Unset in
// the monorepo dev workflow, where the tmp-path default is unchanged.
const dbConfig = defineConfig({
  connection: 'sqlite',
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: {
        filename: process.env.DAVIDUP_DB_PATH || app.tmpPath('db.sqlite3')
      },
      useNullAsDefault: true,
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig