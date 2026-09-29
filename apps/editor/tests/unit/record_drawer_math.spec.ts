// Unit tests for the record drawer's pure half (asset library E4): the
// composition's uses of a record, the tag box, and a text field's edit.

import { test } from '@japa/runner'
import { LICENCES } from 'davidup/assetlib'
import {
  RECORD_LICENCES,
  newTags,
  recordUses,
  textEdit,
} from '../../inertia/composables/recordDrawerMath.js'

const SHA = '9f2c1a3b4c5d' + 'e'.repeat(52)

test.group('recordDrawerMath', () => {
  test("the drawer's licences are assetlib's", ({ assert }) => {
    assert.deepEqual([...RECORD_LICENCES], [...LICENCES])
  })

  test('recordUses finds the assets registered from the record and what uses them', ({
    assert,
  }) => {
    const comp = {
      assets: [
        { id: 'moon', src: `asset:moon@${SHA.slice(0, 12)}`, credit: 'NASA', licence: 'PD' },
        { id: 'moon-old', src: 'asset:moon@000000000000' },
        { id: 'loose', src: 'asset:moon' },
        { id: 'other', src: 'asset:moonlight' },
        { id: 'file', src: './assets/moon.png' },
      ],
      items: {
        a: { type: 'sprite', asset: 'moon' },
        b: { type: 'video', asset: 'loose' },
        c: { type: 'text', font: 'moon-old' },
        d: { type: 'sprite', asset: 'other' },
        e: { type: 'shape' },
      },
      audio: [{ asset: 'loose' }, { id: 'bed', asset: 'moon' }],
    }
    const uses = recordUses(comp, 'moon', SHA)
    assert.deepEqual(
      uses.map((u) => [u.assetId, u.pin, u.current, u.items, u.audio]),
      [
        ['moon', SHA.slice(0, 12), true, ['a'], ['bed']],
        ['moon-old', '000000000000', false, ['c'], []],
        ['loose', null, true, ['b'], ['#0']],
      ]
    )
    assert.deepInclude(uses[0]!, { credit: 'NASA', licence: 'PD' })
    assert.deepEqual(recordUses(null, 'moon', SHA), [])
    assert.deepEqual(recordUses(comp, 'sun', SHA), [])
  })

  test('newTags splits, lower-cases and drops what the record has', ({ assert }) => {
    assert.deepEqual(newTags(' Night, sky  moon,,sky ', ['moon']), ['night', 'sky'])
    assert.deepEqual(newTags('  ', []), [])
  })

  test('textEdit sends a changed field, never a cleared name', ({ assert }) => {
    assert.deepEqual(textEdit('desc', 'old', ' new line '), { desc: 'new line' })
    assert.deepEqual(textEdit('desc', 'old', ''), { desc: '' })
    assert.isNull(textEdit('desc', null, ''))
    assert.isNull(textEdit('credit', 'NASA', 'NASA '))
    assert.isNull(textEdit('name', 'Moon', ''))
    assert.deepEqual(textEdit('name', 'Moon', 'Full moon'), { name: 'Full moon' })
  })
})
