// B-5 regression for the editor's export path.
//
// `render_worker#resolveAssetSources` rewrites relative `assets[].src` to
// absolute paths before handing a composition to davidup's Node driver — the
// editor server's cwd is `apps/editor/`, not the project directory. It used to
// treat *every* non-absolute src as a relative path, which mangled the
// symbolic `global:` / `bundled:` prefixes the asset loader resolves itself
// (`/project/global:fonts/x.woff2` → ENOENT). The rule now lives in
// `davidup/assets#resolveAssetSrcAgainst`, shared with `src/cli/render.ts`.

import { test } from '@japa/runner'
import type { Composition } from 'davidup/schema'
import { resolveAssetSources } from '../../app/workers/render_worker.js'

function compWith(srcs: string[]): Composition {
  return {
    assets: srcs.map((src, i) => ({ id: `a${i}`, type: 'image', src })),
  } as unknown as Composition
}

function resolved(srcs: string[]): string[] {
  const out = resolveAssetSources(compWith(srcs), '/projects/demo/composition.json')
  return (out.assets as Array<{ src: string }>).map((a) => a.src)
}

test.group('render_worker · resolveAssetSources', () => {
  test('resolves relative srcs against the project directory', ({ assert }) => {
    assert.deepEqual(resolved(['./fonts/Bebas.ttf', 'clips/intro.mp4']), [
      '/projects/demo/fonts/Bebas.ttf',
      '/projects/demo/clips/intro.mp4',
    ])
  })

  test('leaves absolute srcs untouched', ({ assert }) => {
    assert.deepEqual(resolved(['/abs/logo.png']), ['/abs/logo.png'])
  })

  test('leaves global: and bundled: srcs symbolic (B-5)', ({ assert }) => {
    assert.deepEqual(resolved(['global:fonts/anton-400.woff2', 'bundled:Inter-Regular.ttf']), [
      'global:fonts/anton-400.woff2',
      'bundled:Inter-Regular.ttf',
    ])
  })

  test('leaves other schemes and Windows drive letters alone', ({ assert }) => {
    assert.deepEqual(resolved(['https://cdn.example/logo.png', 'C:\\assets\\logo.png']), [
      'https://cdn.example/logo.png',
      'C:\\assets\\logo.png',
    ])
  })
})
