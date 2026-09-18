// Unit tests for `useNudge` (v1.1 S26) against a fake, slow command bus:
// presses that land while a request is in flight must accumulate (never
// read the stale composition twice), requests go out one at a time in
// order, every command carries the selection's coalesceKey, and locked /
// transform-less items are skipped.

import { test } from '@japa/runner'
import type { Command, Composition } from '../../inertia/composables/useCommandBus.js'
import { useNudge } from '../../inertia/composables/useNudge.js'

function makeComp(): Composition {
  return {
    composition: { width: 100, height: 100, fps: 30, duration: 1 },
    assets: [],
    layers: [{ id: 'fg', items: ['a', 'b', 'locked', 'g'] }],
    items: {
      a: { type: 'shape', transform: { x: 10, y: 20 } },
      b: { type: 'shape', transform: { x: 0, y: 0 } },
      locked: { type: 'shape', locked: true, transform: { x: 5, y: 5 } },
      g: { type: 'group' },
    },
    tweens: [],
  }
}

function fakeBus(comp: Composition) {
  const sent: Command[] = []
  let inFlight = 0
  let maxInFlight = 0
  return {
    sent,
    maxInFlight: () => maxInFlight,
    apply: async (command: Command) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      sent.push(command)
      await new Promise((r) => setTimeout(r, 5))
      const { id, props } = command.payload as { id: string; props: { x: number; y: number } }
      const item = comp.items[id] as unknown as { transform: { x: number; y: number } }
      item.transform = { x: props.x, y: props.y }
      inFlight--
    },
  }
}

test.group('useNudge', () => {
  test('rapid presses accumulate onto the in-flight target', async ({ assert }) => {
    const comp = makeComp()
    const bus = fakeBus(comp)
    const nudger = useNudge({
      getComposition: () => comp,
      getSelectedIds: () => ['a'],
      apply: bus.apply,
    })
    for (let i = 0; i < 5; i++) nudger.nudge(1, 0)
    nudger.nudge(0, 10)
    await nudger.settled()

    assert.deepEqual((comp.items.a as any).transform, { x: 15, y: 30 })
    assert.equal(bus.maxInFlight(), 1)
    // First press goes out alone; everything after it collapses into one
    // follow-up carrying the latest target.
    assert.lengthOf(bus.sent, 2)
    assert.deepEqual(bus.sent[0]!.payload, { id: 'a', props: { x: 11, y: 20 } })
    assert.deepEqual(bus.sent[1]!.payload, { id: 'a', props: { x: 15, y: 30 } })
    for (const c of bus.sent) {
      assert.equal(c.kind, 'update_item')
      assert.equal(c.coalesceKey, 'nudge:a')
    }
  })

  test('skips locked and transform-less items; false when nothing moves', async ({ assert }) => {
    const comp = makeComp()
    const bus = fakeBus(comp)
    let selected = ['locked', 'g']
    const nudger = useNudge({
      getComposition: () => comp,
      getSelectedIds: () => selected,
      apply: bus.apply,
    })
    assert.isFalse(nudger.nudge(1, 0))
    assert.lengthOf(bus.sent, 0)

    selected = ['a', 'locked', 'b']
    assert.isTrue(nudger.nudge(-10, 0))
    await nudger.settled()
    assert.deepEqual(
      bus.sent.map((c) => (c.payload as { id: string }).id),
      ['a', 'b'],
    )
    assert.equal(bus.sent[0]!.coalesceKey, 'nudge:a,b,locked')
    assert.deepEqual((comp.items.b as any).transform, { x: -10, y: 0 })
  })
})
