import assert from 'node:assert/strict'
import test from 'node:test'
import { rotationStep, isoWeekKey, pickNextRotationIndex, rotationAdvancesLive, rotationDue } from '../src/shared/rotation.ts'
import { createMediaStore } from '../src/shared/media-db.ts'
import { DEFAULT } from '../src/shared/config.ts'
import type { RotationCadence } from '../src/shared/rotation.ts'

const rotation: RotationCadence = { enabled: true, mode: 'order', interval: 'reload', current: 2, items: ['a', 'b', 'c'], lastRotate: null }
test('disabled, empty, singleton, order wrap and deterministic shuffle', context => {
  assert.equal(rotationDue({ ...rotation, enabled: false }), false)
  assert.equal(rotationDue({ ...rotation, items: [] }), false)
  assert.equal(pickNextRotationIndex({ ...rotation, items: [] }), -1)
  assert.equal(pickNextRotationIndex({ ...rotation, items: ['a'], mode: 'shuffle' }), 0)
  assert.equal(pickNextRotationIndex(rotation), 0)
  let calls = 0
  context.mock.method(Math, 'random', () => { calls++; return 0.8 })
  assert.equal(pickNextRotationIndex({ ...rotation, mode: 'shuffle' }), 1)
  assert.equal(calls, 1)
})
test('startup reload is due, never live; hourly is epoch time and daily uses local dates', () => {
  assert.equal(rotationDue(rotation), true)
  assert.equal(rotationAdvancesLive(rotation), false)
  assert.equal(rotationAdvancesLive({ interval: 'hourly' }), true)
  const hourly = { ...rotation, interval: 'hourly', lastRotate: new Date(3599998).toISOString() } as const
  assert.equal(rotationDue(hourly, new Date(3599999)), false)
  assert.equal(rotationDue(hourly, new Date(3600000)), true)
  const daily = { ...rotation, interval: 'daily', lastRotate: new Date(2025, 7, 10, 0, 1).toISOString() } as const
  assert.equal(rotationDue(daily, new Date(2025, 7, 10, 23, 59)), false)
  assert.equal(rotationDue(daily, new Date(2025, 7, 11)), true)
})
test('weekly cadence rolls on Monday across ISO year boundaries', () => {
  assert.equal(isoWeekKey(new Date(2021, 0, 1)), '2020-W53')
  assert.equal(isoWeekKey(new Date(2021, 0, 4)), '2021-W1')
  const weekly = { ...rotation, interval: 'weekly', lastRotate: new Date(2020, 11, 31).toISOString() } as const
  assert.equal(rotationDue(weekly, new Date(2021, 0, 3, 23, 59)), false)
  assert.equal(rotationDue(weekly, new Date(2021, 0, 4)), true)
})

test('startup is distinct from rereads and runtime ticks, references survive item reordering', () => {
  const pool = { ...DEFAULT.rotation, mode: 'order', items: ['a', 'b', 'c'] } as const
  const ordered = { ...pool, items: [...pool.items] }
  const now = new Date('2026-05-01T01:00:00.000Z')
  const first = rotationStep(ordered, undefined, 'startup', now)
  assert.equal(first.state.current, 'a')
  for (const action of ['read', 'tick'] as const) assert.deepEqual(rotationStep(ordered, first.state, action, now), { state: first.state, changed: false })
  assert.equal(rotationStep(ordered, first.state, 'startup', now).state.current, 'b')
  assert.equal(rotationStep({ ...ordered, items: ['c', 'a'] }, first.state, 'read', now).state.current, 'a')
  assert.equal(rotationStep(ordered, first.state, { select: 'c' }, now).state.current, 'c')
})

test('rotation reads and writes within one IDB transaction and waits for commit', async context => {
  const request = { onsuccess: () => {}, result: undefined }
  const get = { onsuccess: () => {}, result: undefined }
  const tx = { oncomplete: () => {}, objectStore: () => ({ get: () => get, put: (row: unknown) => writes.push(row) }) }
  const writes: unknown[] = []
  const db = { transaction(name: string, mode: string) { assert.equal(name, 'rotationState'); assert.equal(mode, 'readwrite'); return tx }, close() {} }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open(name: string, version: number) {
    assert.equal(name, 'codexhost.ext.theme-background.media'); assert.equal(version, 2)
    return Object.assign(request, { result: db })
  } } })
  context.after(() => { if (original) Object.defineProperty(globalThis, 'indexedDB', original); else Reflect.deleteProperty(globalThis, 'indexedDB') })
  const store = createMediaStore()
  const pool = { ...DEFAULT.rotation, items: ['a', 'b'], mode: 'order' as const }
  let settled = false
  const pending = store.rotate(pool, 'next').then(result => { settled = true; return result })
  request.onsuccess()
  await new Promise(resolve => setImmediate(resolve))
  get.onsuccess()
  assert.equal(writes.length, 1)
  assert.equal(settled, false)
  tx.oncomplete()
  assert.equal((await pending).state.current, 'a')
  store.close()
})
