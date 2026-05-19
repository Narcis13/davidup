# Implementation notes

**Spec:** **20.33 — Styled error pages.**
- `pages/errors/not_found.vue` + `server_error.vue` — match editor visual style; surface a "back to projects" button.

**Started:** 2026-05-19

---

## "Back to projects" points at `/`, not `/editor`

The "projects" surface in this app is the project picker at the root route (`apps/editor/start/routes.ts:21` → `HomeController.show` → `pages/home.vue`). `/editor` is the editing canvas for an already-loaded project, which is *not* the projects list. Used `<Link href="/">` for both error pages.

**Why:** The spec says "back to projects" — the picker IS the projects list (open + recent). Going to `/editor` would land on whatever project is loaded (or none), which is not what the wording implies.

## Used Inertia `<Link>` instead of `<a href>`

Imported `Link` from `@inertiajs/vue3` for the button.

**Why:** Consistent with `home.vue`'s navigation idiom (`router.visit('/editor')`) and avoids a full page reload when the user is already inside the Inertia app shell. For genuine 404s served by Adonis the page hits as a fresh request anyway, so `<Link>` doesn't break that path — it just helps when the not-found is reached via in-app navigation.

## Visual treatment: derived from `home.vue`, not lifted from a shared stylesheet

Both error pages reuse `home.vue`'s palette tokens inline (background radial, `#0a0a0a` base, `#5b7cfa` accent, `'Instrument Sans'` + `'JetBrains Mono'` pair, 12px uppercase brand chip).

**Why:** There is no shared design-token module in `inertia/css/` worth importing for this — `home.vue` itself uses `<style scoped>` with literal values. Copying the same literal values keeps the look identical and avoids creating a new abstraction for two leaf pages.

**Alternative considered:** Extract a shared `error-page.css` or a Vue layout. Rejected as premature — two pages, tightly aligned in shape; if a third "marketing-style" page lands, that's the time to factor.

## 404 vs 500 differ in accent color, not layout

Both pages share the same skeleton (brand chip → giant numeric code → title → sub → CTA). The 404 keeps the blue accent (`#5b7cfa` gradient on the digits); the 500 swaps the digits to the red error tone (`#ff6b6b` gradient) and adds a monospace `<pre>` block showing `error.message`.

**Why:** Color is the cheapest cue that something went wrong server-side vs. just a missing route. Reusing the same skeleton keeps the visual rhythm with `home.vue`'s card-on-radial-bg vibe.

## `server_error.vue` falls back when `error.message` is missing/blank

The previous `server_error.vue` rendered `{{ error.message }}` directly, which prints `undefined` if the Inertia handler ever passes an object without `message`. Now a computed normalises to `"Something went wrong on the server."` when the message is missing or blank.

**Why:** Defensive against the page being rendered in dev with a thrown non-Error value (e.g. a string throw) or in production where Adonis may strip the message. Cheap to add, prevents an ugly bare `undefined` in the UI.

## Deferred / out-of-scope

- No "report this error" link, no error-id/correlation-id display. Not in the spec; would need server-side plumbing to be useful.
- No retry button on the 500 page. Inertia errors during a POST don't reliably round-trip the original intent, so a generic "Retry" would mostly land back on the picker anyway.
- No localisation — strings are hardcoded English. The rest of the editor is English-only today.

## Open questions

- None. The spec was clear; the only judgment call worth flagging is the `/` vs `/editor` destination, addressed above.
