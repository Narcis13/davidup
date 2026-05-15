import { validateComposition } from 'davidup/schema'

const valid = {
  version: '1.0',
  composition: { width: 1920, height: 1080, fps: 30, duration: 1, background: '#000000' },
  assets: [],
  items: {},
  layers: [],
  tweens: [],
}

const ok = validateComposition(valid)
if (!ok.valid) {
  console.error('expected valid composition, got errors:', ok.errors)
  process.exit(1)
}

const bad = { ...valid, version: undefined as unknown as string }
const fail = validateComposition(bad)
if (fail.valid) {
  console.error('expected invalid composition, got valid')
  process.exit(1)
}

console.log('ok: davidup/schema resolves and validateComposition works')
