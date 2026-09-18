import { test } from '@japa/runner'
import { firstSyntaxErrorOffset, parseSourceDraft } from '../../inertia/composables/sourceDraft.js'

test.group('parseSourceDraft (v1.1 S29)', () => {
  test('returns the parsed object for valid JSON', ({ assert }) => {
    assert.deepEqual(parseSourceDraft('{ "version": "0.1" }'), {
      ok: true,
      json: { version: '0.1' },
    })
  })

  test('reports the line of a syntax error', ({ assert }) => {
    const result = parseSourceDraft('{\n  "a": 1,\n  "b": ,\n}')
    assert.isFalse(result.ok)
    if (!result.ok) assert.equal(result.line, 3)
  })

  test('rejects a non-object document', ({ assert }) => {
    const result = parseSourceDraft('[1, 2]')
    assert.isFalse(result.ok)
    if (!result.ok) assert.equal(result.message, 'The document must be a JSON object.')
  })

  test('firstSyntaxErrorOffset finds trailing commas and unterminated input', ({ assert }) => {
    assert.isNull(firstSyntaxErrorOffset('{"a": [1, 2.5e3, "x\\"y"], "b": null}'))
    assert.equal(firstSyntaxErrorOffset('{"a": 1,}'), 8)
    assert.equal(firstSyntaxErrorOffset('{"a": '), 6)
  })
})
