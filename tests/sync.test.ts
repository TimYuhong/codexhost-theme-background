import assert from 'node:assert/strict'
import test from 'node:test'
import type { JsonObject, StorageApi } from '../src/host-api.ts'
import { DEFAULT, MAX_SETTINGS, readAppearance, UUID4 } from '../src/shared/config.ts'
import { mediaPage } from '../src/page/library.ts'
import type { MediaRecord, MediaStore } from '../src/shared/media-db.ts'
import { fixtures } from './page-fixture.ts'
import { CHANNEL, editSettings, openNotices, readSettings, uuid, watchFocus } from '../src/shared/sync.ts'
import type { ConfigRead } from '../src/shared/config.ts'

const turn = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function host() {
  let values: JsonObject = { theme: structuredClone(DEFAULT), extra: { keep: true } }
  const listeners = new Set<(values: JsonObject) => void>()
  const stats = { reads: 0, writes: 0, pendingReads: 0, maxReads: 0, pendingWrites: 0, maxWrites: 0, conflicts: 0 }
  let readGate: Promise<void> | undefined, writeGate: Promise<void> | undefined
  let revision = 0
  const publish = (next: JsonObject) => {
    values = structuredClone(next)
    revision++
    for (const listener of listeners) listener(structuredClone(values))
  }
  const storage: StorageApi = {
    async get() {
      stats.reads++; stats.pendingReads++
      stats.maxReads = Math.max(stats.maxReads, stats.pendingReads)
      const snapshot = structuredClone(values)
      const gate = readGate; readGate = undefined
      try { if (gate) await gate; return snapshot } finally { stats.pendingReads-- }
    },
    async set(next) {
      stats.writes++; stats.pendingWrites++
      stats.maxWrites = Math.max(stats.maxWrites, stats.pendingWrites)
      const expected = revision, gate = writeGate; writeGate = undefined
      try {
        if (gate) await gate
        if (expected !== revision) stats.conflicts++ // Page wrapper retries with the same values.
        publish(next)
        return structuredClone(values)
      } finally { stats.pendingWrites-- }
    },
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { storage, publish, stats, listeners, get values() { return values },
    readGate(gate: Promise<void>) { readGate = gate }, writeGate(gate: Promise<void>) { writeGate = gate },
  }
}

test('debounced serial writes keep new edits after the old ACK and update their bases', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const h = host(), first = deferred<void>()
  let broadcasts = 0
  const page = editSettings(h.storage, () => {}, () => { broadcasts++ })
  await page.read()
  page.edit('opacity', 20)
  context.mock.timers.tick(150)
  page.edit('opacity', 30)
  context.mock.timers.tick(199)
  await turn()
  assert.equal(h.stats.writes, 0)
  h.writeGate(first.promise)
  context.mock.timers.tick(1)
  await turn()
  assert.equal(h.stats.pendingWrites, 1)
  page.edit('opacity', 45)
  const done = page.flush()
  assert.equal(page.draft?.opacity, 45)
  first.resolve()
  assert.equal(await done, true)
  assert.equal(h.stats.maxWrites, 1)
  assert.equal(h.stats.writes, 2)
  assert.equal(broadcasts, 2)
  assert.equal(page.confirmed?.opacity, 45)
  assert.equal(page.status, 'saved')
  page.edit('opacity', 45)
  await page.flush()
  assert.equal(h.stats.writes, 2)
  page.dispose()
})

test('preread merges different fields, conflicting edits stay dirty until resolved', async () => {
  const h = host(), page = editSettings(h.storage, () => {}, () => {})
  await page.read()
  const surfaces = (bg: number) => ({ ...DEFAULT.opacities, bg })
  page.edit('opacities', surfaces(5))
  h.publish({ ...h.values, theme: { ...DEFAULT, blur: 12 } })
  assert.equal(page.draft?.opacities.bg, 5)
  assert.equal(page.draft?.blur, 12)
  assert.equal(await page.flush(), true)
  assert.deepEqual(h.values, { extra: { keep: true }, theme: { ...DEFAULT, opacities: surfaces(5), blur: 12 } })
  page.edit('opacities', surfaces(20))
  h.publish({ ...h.values, theme: { ...DEFAULT, opacities: surfaces(40), blur: 12 } })
  assert.equal(await page.flush(), false)
  assert.equal(page.hasConflicts, true)
  assert.equal(page.draft?.opacities.bg, 20)
  assert.equal(h.stats.writes, 1)
  await page.resolve(false)
  assert.equal(page.draft?.opacities.bg, 40)
  page.edit('opacities', surfaces(15))
  h.publish({ ...h.values, theme: { ...DEFAULT, opacities: surfaces(55), blur: 12 } })
  await page.flush()
  await page.resolve(true)
  assert.equal(page.confirmed?.opacities.bg, 15)
  assert.equal(h.stats.writes, 2)
  page.dispose()
})

test('Host revision retry reuses the original payload, so readback can miss overwritten fields', async () => {
  const h = host(), page = editSettings(h.storage, () => {}, () => {}), gate = deferred<void>()
  await page.read()
  page.edit('opacities', { ...DEFAULT.opacities, bg: 15 })
  h.writeGate(gate.promise)
  const save = page.flush()
  await turn()
  h.publish({ ...h.values, theme: { ...DEFAULT, blur: 15 } })
  gate.resolve()
  assert.equal(await save, true)
  assert.equal(h.stats.conflicts, 1)
  assert.equal(page.confirmed?.blur, DEFAULT.blur)
  page.dispose()
})

test('readback mismatch and failed writes retain the draft; disposal suppresses late ACK', async () => {
  const h = host(), ack = deferred<JsonObject>()
  const page = editSettings({ ...h.storage, set: () => ack.promise }, () => {}, () => {})
  await page.read()
  page.edit('opacity', 50)
  const saving = page.flush()
  await turn()
  h.publish({ theme: { ...DEFAULT, opacity: 10 } })
  ack.resolve({ theme: { ...DEFAULT, opacity: 50 } })
  assert.equal(await saving, false)
  assert.equal(page.status, 'changed')
  assert.equal(page.draft?.opacity, 50)
  page.dispose()

  const gate = deferred<void>()
  let sent = 0
  const failure = editSettings(h.storage, () => {}, () => { sent++ })
  await failure.read()
  failure.edit('opacity', 55)
  h.writeGate(Promise.reject(new Error('offline')))
  assert.equal(await failure.flush(), false)
  assert.equal(failure.status, 'failed')
  assert.equal(failure.draft?.opacity, 55)
  h.writeGate(gate.promise)
  const inflight = failure.flush()
  await turn()
  failure.dispose()
  assert.equal(h.listeners.size, 0)
  const { reads, writes } = h.stats
  gate.resolve()
  assert.equal(await inflight, false)
  await failure.read()
  failure.edit('opacity', 90)
  assert.equal(await failure.flush(), false)
  assert.deepEqual([h.stats.reads, h.stats.writes, sent], [reads, writes, 0])
})

test('oversized sibling values block the envelope write and preserve the draft', async () => {
  const h = host(), page = editSettings(h.storage, () => {}, () => {})
  const values = { ...h.values, extra: '' }
  const overhead = Buffer.byteLength(JSON.stringify({ settingsRevision: Number.MAX_SAFE_INTEGER, values }))
  const extra = '字'.repeat(Math.floor((MAX_SETTINGS - overhead) / 3))
  h.publish({ ...values, extra })
  await page.read()
  const accent = '#123456'
  page.edit('accent', accent)
  assert.equal(await page.flush(), false)
  assert.equal(page.status, 'failed')
  assert.equal(page.draft?.accent, accent)
  assert.equal(h.values.extra, extra)
  assert.equal(h.stats.writes, 0)
  h.publish({ ...values, extra: 'retained sibling' })
  assert.equal(await page.flush(), true)
  assert.equal(h.values.extra, 'retained sibling')
  page.dispose()
})

test('re-association from a saved profile reuses its UUID and commits the Blob before notifying without Host writes', async () => {
  const h = host(), id = uuid(), signal = new AbortController(), browser = fixtures(signal.signal)
  const commitBlob = deferred<void>(), stored: MediaRecord[] = [], notices: string[] = []
  const page = editSettings(h.storage, () => {}, () => {})
  h.publish({ theme: { ...DEFAULT, respectReducedTransparency: true,
    profiles: [{ id: uuid(), name: 'Missing', createdAt: 1, appearance: readAppearance(DEFAULT), source: { kind: 'local-image', id } }] } })
  await page.read()
  const store = { async list() { return stored }, async put(row: MediaRecord) { await commitBlob.promise; stored.push(row) } } as unknown as MediaStore
  Object.assign(browser.ui.doc, { createElement: () => ({ naturalWidth: 1, naturalHeight: 1, async decode() {}, removeAttribute() {} }) })
  const library = mediaPage(browser.ui, browser.panel('font'), browser.panel('background'), signal.signal, store, () => page.draft!, page.editMany,
    page.flush, () => page.readOnly, id => notices.push(id), () => library.render(page.draft!, page.readOnly), key => assert.notEqual(key, 'storageError'))
  try {
    library.open(); await turn()
    const link = browser.root.find(node => node.textContent === 'Link file on this device' && node.dataset.tbFocus === `${id}-associate`)
    assert.ok(link, 'inactive profile references are shown before application')
    link.click()
    const input = browser.root.find(node => node.dataset.tbUpload === 'image')!
    input.files = [new File(['GIF89a'], 'empty-type.gif')]; input.dispatchEvent(new Event('change'))
    await turn(); assert.deepEqual(notices, []); assert.equal(h.stats.writes, 0)
    commitBlob.resolve(); await turn(); await turn()
    assert.deepEqual(notices, [id]); assert.equal(stored[0].id, id)
    assert.equal(stored[0].mime, 'image/gif'); assert.equal(await stored[0].blob.text(), 'GIF89a')
    assert.deepEqual(page.draft?.source, DEFAULT.source)
    assert.equal(page.draft?.respectReducedTransparency, true)
    assert.equal(h.stats.writes, 0)
  } finally { signal.abort(); page.dispose() }
})

test('notifications supersede old reads and never start writes; disposes during a read', async () => {
  const h = host(), gate = deferred<void>(), seen: ConfigRead[] = []
  h.readGate(gate.promise)
  const reader = readSettings(h.storage, theme => seen.push(theme), () => {})
  const read = reader.read()
  await turn()
  h.publish({ theme: { ...DEFAULT, opacity: 34 } })
  gate.resolve()
  await read
  assert.equal(h.stats.reads, 2)
  assert.ok(seen.every(theme => theme.state === 'ready' && theme.config.opacity === 34))
  const delayed = deferred<void>()
  h.readGate(delayed.promise)
  const pending = reader.read()
  await turn()
  reader.dispose()
  delayed.resolve()
  assert.equal(await pending, undefined)
  assert.equal(h.stats.writes, 0)
  assert.equal(h.listeners.size, 0)
})

test('focus/visibility reads are single flight, hidden intervals are stopped, and polling never writes', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] })
  const h = host(), target = new EventTarget(), window = new EventTarget()
  const doc = Object.assign(target, { visibilityState: 'visible', defaultView: Object.assign(window, { setInterval, clearInterval }) })
  const gate = deferred<void>()
  const reader = readSettings(h.storage, () => {}, () => {})
  const stop = watchFocus(doc as unknown as Document, () => void reader.read(true), true)
  h.readGate(gate.promise)
  window.dispatchEvent(new Event('focus'))
  await turn()
  doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(h.stats.pendingReads, 1)
  gate.resolve()
  await turn()
  assert.equal(h.stats.maxReads, 1)
  doc.visibilityState = 'hidden'
  doc.dispatchEvent(new Event('visibilitychange'))
  const reads = h.stats.reads
  context.mock.timers.tick(12500)
  await turn()
  assert.equal(h.stats.reads, reads)
  doc.visibilityState = 'visible'
  doc.dispatchEvent(new Event('visibilitychange'))
  await turn()
  context.mock.timers.tick(5000)
  await turn()
  assert.equal(h.stats.reads, reads + 2)
  stop(); reader.dispose()
  context.mock.timers.tick(6000)
  window.dispatchEvent(new Event('focus'))
  await turn()
  assert.equal(h.stats.reads, reads + 2)
  assert.equal(h.stats.writes, 0)
})

test('BC carries only notices and rejects invalid messages; HTTP UUID fallback is v4', async context => {
  const outgoing: unknown[] = []
  let closed = false
  const channel = new EventTarget()
  function FakeChannel(name: string) {
    assert.equal(name, CHANNEL)
    return Object.assign(channel, { postMessage: (message: unknown) => { outgoing.push(message) }, close: () => { closed = true } })
  }
  const original = globalThis.BroadcastChannel
  context.after(() => { globalThis.BroadcastChannel = original })
  globalThis.BroadcastChannel = FakeChannel as unknown as typeof BroadcastChannel
  const h = host(), reader = readSettings(h.storage, () => {}, () => {})
  const endpoint = openNotices(() => { void reader.read() })
  endpoint.send({ type: 'settings-committed' })
  const [own] = outgoing as [{ sender: string; type: string; v: number }]
  assert.match(own.sender, UUID4)
  for (const data of [own, { ...own, sender: 'bad' }, { ...own, v: 2 }, { ...own, sender: uuid(), type: 'media-changed', id: 'bad', op: 'put' }]) {
    channel.dispatchEvent(new MessageEvent('message', { data }))
  }
  await turn()
  assert.equal(h.stats.reads, 0)
  channel.dispatchEvent(new MessageEvent('message', { data: { ...own, sender: uuid(), values: { bypass: true } } }))
  await turn()
  assert.equal(h.stats.reads, 1)
  assert.equal(h.stats.writes, 0)
  endpoint.close(); reader.dispose()
  assert.equal(closed, true)
  endpoint.send({ type: 'settings-observed' })
  assert.equal(outgoing.length, 1)
  const random = crypto.randomUUID
  context.after(() => { crypto.randomUUID = random })
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, writable: true, value: undefined })
  assert.match(uuid(), UUID4)
})
