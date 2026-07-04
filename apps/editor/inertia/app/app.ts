// Type-only reference so `SharedProps` (declared via module augmentation in
// config/inertia.ts) is visible when the client tree is type-checked on its
// own (`vue-tsc -p inertia/tsconfig.json`, Session 24). Deliberately NOT
// referencing `../../adonisrc.ts` here (the starter-kit scaffold did) — that
// pulls the whole server dependency graph (start/kernel.ts → every
// #middleware/* file) into this client-only program, which type-checks them
// under the wrong compilerOptions (no config/auth.ts augmentation reachable,
// so `Authenticators` resolves empty and guard calls type as `never`).
// Nothing here currently needs adonisrc.ts's types; config/inertia.ts is
// self-contained.
/// <reference path="../../config/inertia.ts" />

import '../css/app.css';
import { createSSRApp, h } from 'vue'
import type { DefineComponent } from 'vue'
import { createInertiaApp } from '@inertiajs/vue3'
import { resolvePageComponent } from '@adonisjs/inertia/helpers'

const appName = import.meta.env.VITE_APP_NAME || 'AdonisJS'

createInertiaApp({
  progress: { color: '#5468FF' },

  title: (title) => `${title} - ${appName}`,

  resolve: (name) => {
    return resolvePageComponent(
      `../pages/${name}.vue`,
      import.meta.glob<DefineComponent>('../pages/**/*.vue'),
    )
  },

  setup({ el, App, props, plugin }) {
    
    createSSRApp({ render: () => h(App, props) })
    
      .use(plugin)
      .mount(el)
  },
})