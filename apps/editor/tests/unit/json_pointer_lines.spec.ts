// Unit tests for the SourceDrawer's RFC-6901 pointer → line indexer.
//
// The drawer relies on this mapping being byte-correct: a stale pointer
// would highlight the wrong line in the authored JSON and undermine the
// whole reveal-in-source affordance. The cases below exercise the moving
// parts (objects, nested objects, arrays, arrays of objects, special
// characters that need RFC-6901 encoding, malformed JSON tolerance).

import { test } from '@japa/runner'
import {
  encodePtrToken,
  indexJsonPointerLines,
  pointerForSelection,
} from '../../inertia/composables/jsonPointerLines.js'

test.group('indexJsonPointerLines · top-level keys', () => {
  test('records each top-level member at the line of its key', ({ assert }) => {
    const text = ['{', '  "version": "0.1",', '  "items": {', '  }', '}'].join('\n')
    const { lines } = indexJsonPointerLines(text)
    assert.equal(lines.get(''), 1)
    assert.equal(lines.get('/version'), 2)
    assert.equal(lines.get('/items'), 3)
  })

  test('handles nested objects', ({ assert }) => {
    const text = [
      '{',
      '  "items": {',
      '    "logo": {',
      '      "type": "shape"',
      '    }',
      '  }',
      '}',
    ].join('\n')
    const { lines } = indexJsonPointerLines(text)
    assert.equal(lines.get('/items/logo'), 3)
    assert.equal(lines.get('/items/logo/type'), 4)
  })
})

test.group('indexJsonPointerLines · arrays', () => {
  test('indexes array elements positionally', ({ assert }) => {
    const text = ['{', '  "layers": [', '    "fg",', '    "bg"', '  ]', '}'].join('\n')
    const { lines } = indexJsonPointerLines(text)
    assert.equal(lines.get('/layers/0'), 3)
    assert.equal(lines.get('/layers/1'), 4)
  })

  test('records object-element members', ({ assert }) => {
    const text = [
      '{',
      '  "tweens": [',
      '    {',
      '      "id": "fade",',
      '      "target": "logo"',
      '    }',
      '  ]',
      '}',
    ].join('\n')
    const { lines } = indexJsonPointerLines(text)
    assert.equal(lines.get('/tweens/0'), 3)
    assert.equal(lines.get('/tweens/0/id'), 4)
    assert.equal(lines.get('/tweens/0/target'), 5)
  })
})

test.group('indexJsonPointerLines · RFC-6901 token encoding', () => {
  test('encodes "/" as ~1 and "~" as ~0', ({ assert }) => {
    assert.equal(encodePtrToken('a/b'), 'a~1b')
    assert.equal(encodePtrToken('a~b'), 'a~0b')
    assert.equal(encodePtrToken('a~/b'), 'a~0~1b')
  })

  test('resolves keys with slashes via encoded tokens', ({ assert }) => {
    const text = ['{', '  "items": {', '    "logo/main": "value"', '  }', '}'].join('\n')
    const { lines } = indexJsonPointerLines(text)
    assert.equal(lines.get('/items/logo~1main'), 3)
  })
})

test.group('indexJsonPointerLines · resilience', () => {
  test('returns the lines collected so far when JSON is malformed', ({ assert }) => {
    const text = ['{', '  "items": {', '    "logo":'].join('\n')
    const { lines } = indexJsonPointerLines(text)
    assert.equal(lines.get(''), 1)
    assert.equal(lines.get('/items'), 2)
  })

  test('counts total lines even when parsing aborts', ({ assert }) => {
    const text = 'not-json\nline-two\nline-three'
    const { totalLines } = indexJsonPointerLines(text)
    assert.equal(totalLines, 3)
  })

  test('returns line 1 for the document root on a single-line empty object', ({ assert }) => {
    const { lines } = indexJsonPointerLines('{}')
    assert.equal(lines.get(''), 1)
  })
})

test.group('pointerForSelection', () => {
  test('prefers lastPickSource pointer when files match', ({ assert }) => {
    const ptr = pointerForSelection({
      selectedItemId: 'logo',
      pickSourceFile: '/proj/composition.json',
      pickSourceJsonPointer: '/scenes/intro',
      displayedFile: '/proj/composition.json',
    })
    assert.equal(ptr, '/scenes/intro')
  })

  test('falls back to /items/<id> when the pick is in a different file', ({ assert }) => {
    const ptr = pointerForSelection({
      selectedItemId: 'logo',
      pickSourceFile: '/proj/library.json',
      pickSourceJsonPointer: '/items/wrapped',
      displayedFile: '/proj/composition.json',
    })
    assert.equal(ptr, '/items/logo')
  })

  test('encodes ids that contain slashes', ({ assert }) => {
    const ptr = pointerForSelection({
      selectedItemId: 'scene/header',
      pickSourceFile: null,
      pickSourceJsonPointer: null,
      displayedFile: null,
    })
    assert.equal(ptr, '/items/scene~1header')
  })

  test('returns null when there is no selection and no pick', ({ assert }) => {
    const ptr = pointerForSelection({
      selectedItemId: null,
      pickSourceFile: null,
      pickSourceJsonPointer: null,
      displayedFile: null,
    })
    assert.isNull(ptr)
  })
})
