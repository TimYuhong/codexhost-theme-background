import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT, profileSnapshot } from '../src/shared/config.ts'
import type { ThemeConfig } from '../src/shared/config.ts'
import { createEffects } from '../src/shared/effects.ts'
import type { MediaStore } from '../src/shared/media-db.ts'
import { rotationStep } from '../src/shared/rotation.ts'
import type { RotationAction, RotationState } from '../src/shared/rotation.ts'

const turn = () => new Promise<void>(resolve => setImmediate(resolve))
const font = (mediaId: string) => ({ enabled: true, mediaId, mime: 'font/woff2' } as const)
const pool = { ...DEFAULT.rotation, items: ['first', 'second'], mode: 'order' as const }
function fixture() {
  let timer: (() => void) | undefined, paint = 0, saved: RotationState | undefined
  const system = Object.assign(new EventTarget(), { matches: false }), signal = new AbortController()
  const loads: string[] = [], actions: RotationAction[] = [], broadcasts: string[] = []
  let deferRead: Promise<ReturnType<typeof rotationStep>> | undefined
  const media = {
    async get(id: string) { loads.push(id); return { mime: 'font/woff2', kind: 'font', blob: new Blob(['wOF2']) } },
    async rotate(rotation: typeof pool, action: RotationAction) {
      actions.push(action)
      if (deferRead) { const wait = deferRead; deferRead = undefined; return wait }
      const step = rotationStep(rotation, saved, action)
      if (step.changed) saved = step.state
      return step
    },
  } as MediaStore
  class Face { async load() { return this } }
  const doc = { visibilityState: 'visible', fonts: new Set(), defaultView: { FontFace: Face, matchMedia: () => system,
    setInterval(run: () => void, ms: number) { assert.equal(ms, 30000); timer = run; return 1 }, clearInterval() { timer = undefined },
  } } as unknown as Document
  const effects = createEffects(doc, signal.signal, media, { send: notice => { broadcasts.push(notice.type) } }, () => { paint++ })
  return { loads, actions, broadcasts, effects, system, doc, signal,
    tick() { timer?.() }, get paints() { return paint }, get timer() { return timer }, setSaved(state: RotationState) { saved = state },
    deferRead(pending: Promise<ReturnType<typeof rotationStep>>) { deferRead = pending },
  }
}
const withPool: ThemeConfig = { ...DEFAULT, source: { kind: 'rotation', poolId: pool.poolId }, rotation: pool,
  placement: { ...DEFAULT.placement, mode: 'center' }, font: font('profile-font') }
const day = { id: 'day', name: 'Day', createdAt: 0, ...profileSnapshot(withPool) }

test('schedule resolves source and font before rotation and rendering, with no reload on later switches', async () => {
  const f = fixture(), base: ThemeConfig = { ...DEFAULT, font: font('base-font'), rotation: pool,
    profiles: [day], schedule: { ...DEFAULT.schedule, enabled: true, mode: 'system', nightProfile: day.id } }
  f.setSaved({ poolId: pool.poolId, current: 'second', lastRotate: null })
  f.effects.adopt(base); await turn(); await turn()
  assert.deepEqual(f.loads, ['base-font'])
  f.system.matches = true; f.system.dispatchEvent(new Event('change'))
  assert.deepEqual(f.effects.effective()?.source, { kind: 'none' }, 'a switched pool waits for its local read')
  await turn(); await turn()
  assert.deepEqual(f.actions, ['read'])
  assert.deepEqual(f.effects.effective()?.source, { kind: 'local-image', id: 'second' })
  assert.equal(f.effects.effective()?.placement.mode, 'center')
  assert.deepEqual(f.loads, ['base-font', 'profile-font'])
  for (let i = 0; i < 10; i++) { f.tick(); f.effects.adopt(structuredClone(base)) }
  f.effects.focus(); await turn()
  assert.deepEqual(f.actions, ['read', 'read'])
  f.effects.notice({ v: 1, sender: 'a', type: 'media-changed', id: 'base-font', op: 'put' })
  f.effects.notice({ v: 1, sender: 'a', type: 'media-changed', id: 'profile-font', op: 'put' })
  await turn(); await turn()
  assert.deepEqual(f.loads, ['base-font', 'profile-font', 'profile-font'])
  f.system.matches = false; f.system.dispatchEvent(new Event('change'))
  assert.deepEqual(f.effects.effective()?.source, DEFAULT.source)
  await turn(); await turn()
  assert.equal(f.loads.at(-1), 'base-font')
  assert.equal(f.broadcasts.length, 0)
  f.signal.abort()
  assert.equal(f.timer, undefined)
  assert.equal(f.doc.fonts.size, 0)
})

test('late pool transactions are ignored after a time-based switch and interval ticks only advance time pools', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 0, 1, 6, 59) })
  const f = fixture(), next = { ...pool, interval: 'hourly' as const }
  const base: ThemeConfig = { ...DEFAULT, rotation: next, profiles: [day],
    schedule: { ...DEFAULT.schedule, enabled: true, dayProfile: day.id } }
  let release!: (result: ReturnType<typeof rotationStep>) => void
  f.deferRead(new Promise(resolve => { release = resolve }))
  f.effects.adopt(base)
  context.mock.timers.setTime(+new Date(2026, 0, 1, 7))
  f.tick()
  assert.deepEqual(f.actions, ['read'])
  context.mock.timers.setTime(+new Date(2026, 0, 1, 19))
  f.tick()
  release({ state: { poolId: pool.poolId, current: 'first', lastRotate: null }, changed: true })
  await turn()
  assert.deepEqual(f.effects.effective()?.source, DEFAULT.source)
  assert.equal(f.broadcasts.length, 0)
  context.mock.timers.setTime(+new Date(2026, 0, 2, 8))
  f.tick(); await turn(); f.tick(); await turn()
  assert.deepEqual(f.actions, ['read', 'read', 'tick'])
  assert.equal(f.broadcasts.length, 1)
  f.effects.dispose()
})

test('startup consumes reload once, or chooses one temporary seed for the effective scheduled generator', async context => {
  const first = fixture()
  first.effects.adopt(withPool); await turn()
  for (let i = 0; i < 10; i++) { first.effects.adopt(withPool); first.tick() }
  first.effects.adopt(DEFAULT); first.effects.adopt(withPool); first.effects.focus(); await turn()
  assert.deepEqual(first.actions, ['startup', 'read', 'read'])
  first.effects.dispose()
  const second = fixture(), generator = { kind: 'mesh', seed: 33, scale: 1, intensity: 0.6 } as const
  context.mock.method(crypto, 'getRandomValues', (buffer: Uint32Array) => { buffer[0] = 99; return buffer })
  const base: ThemeConfig = { ...DEFAULT, regenerateOnReload: true,
    profiles: [{ ...day, source: generator }], schedule: { ...DEFAULT.schedule, enabled: true, mode: 'system', dayProfile: day.id } }
  second.effects.adopt(base)
  assert.deepEqual(second.effects.effective()?.source, { ...generator, seed: 100 })
  second.tick(); second.effects.adopt(base); second.effects.focus()
  assert.deepEqual(second.effects.effective()?.source, { ...generator, seed: 100 })
  second.system.matches = true; second.system.dispatchEvent(new Event('change'))
  assert.deepEqual(second.effects.effective()?.source, DEFAULT.source)
  second.system.matches = false; second.system.dispatchEvent(new Event('change'))
  assert.deepEqual(second.effects.effective()?.source, generator)
  assert.equal(base.profiles[0].source, generator)
  second.effects.dispose()
})
