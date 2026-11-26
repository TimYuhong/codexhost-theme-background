import assert from 'node:assert/strict'
import test from 'node:test'
import type { JsonObject, StorageApi } from '../src/host-api.ts'
import { DEFAULT, MAX_SETTINGS, NATIVE_DEFAULT, readAppearance, UUID4 } from '../src/shared/config.ts'
import { mediaPage } from '../src/page/library.ts'
import { profilesPage } from '../src/page/profiles.ts'
import { createOtterPet, OTTER_ACCENT_PATH, OTTER_BODY_PATH } from '../src/shared/otter-pet.ts'
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
  const values = { ...h.values, theme: structuredClone(NATIVE_DEFAULT), extra: '' }
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

test('built-in preset cards have no customize button; custom editor imports local wallpaper after IDB commit and saves independently', async () => {
  const h = host(), signal = new AbortController(), browser = fixtures(signal.signal)
  const commitBlob = deferred<void>(), stored: MediaRecord[] = [], notices: string[] = []
  const page = editSettings(h.storage, () => {}, () => {})
  h.publish({ theme: { ...DEFAULT, accent: '#e5a952', source: { kind: 'preset', id: 'default' } } })
  await page.read()
  const store = {
    async list(kind: MediaRecord['kind']) { return stored.filter(item => item.kind === kind) },
    async backgroundBlob(id: string, kind: 'image' | 'video') { return stored.find(item => item.id === id && item.kind === kind)?.blob },
    async put(row: MediaRecord) { await commitBlob.promise; stored.push(row) },
  } as unknown as MediaStore
  const panel = browser.panel('profiles')
  const renderProfiles = profilesPage(browser.ui, panel, signal.signal, () => page.draft!, page.editMany, page.flush, () => {}, () => page.readOnly,
    async () => undefined, store, id => notices.push(id))
  try {
    renderProfiles(page.draft!, page.readOnly)
    // Built-in cards must not expose any customize button
    assert.equal(browser.root.find(node => 'tbCustomize' in node.dataset), undefined)
    assert.ok(browser.root.find(node => node.dataset.tbPreset === 'default'))

    // Open independent custom theme editor
    const addBtn = browser.root.find(node => 'tbAddProfile' in node.dataset)!
    assert.ok(addBtn)
    addBtn.click()
    await turn()

    // Editor must not offer built-in presets, and must expose direct local image import
    const upload = browser.root.find(node => node.dataset.tbEditorUpload === 'image')!
    assert.ok(upload)
    upload.files = [new File(['GIF89a'], 'my-wallpaper.gif')]
    upload.dispatchEvent(new Event('change'))
    await turn()
    assert.deepEqual(notices, [], 'must not broadcast media-changed before IDB commit')
    commitBlob.resolve()
    await turn(); await turn()
    assert.equal(stored.length, 1)
    assert.deepEqual(notices, [stored[0].id], 'broadcasts media-changed only after IDB commit')

    // Name and save & apply custom theme
    const dialog = browser.root.find(node => node.className.includes('tb-dialog'))!
    const nameInput = dialog.find(node => node.className === '' && 'maxLength' in node)!
    nameInput.value = 'My Independent Theme'
    nameInput.dispatchEvent(new Event('input'))
    const saveApply = dialog.find(node => node.textContent === 'Save & apply')!
    saveApply.click()
    await turn(); await turn()

    assert.equal(page.confirmed?.profiles.length, 1)
    const saved = page.confirmed!.profiles[0]
    assert.equal(saved.name, 'My Independent Theme')
    assert.deepEqual(saved.source, { kind: 'local-image', id: stored[0].id })
    assert.equal(saved.appearance.accent, null, 'independent of active built-in accent')
    assert.equal(page.confirmed?.activeProfile, saved.id)

    // Save current active theme color/appearance directly via header button
    page.editMany({ accent: '#33aa88', schemeOverride: 'light', activeProfile: null })
    await page.flush()
    renderProfiles(page.draft!, page.readOnly)
    const saveCurrent = browser.root.find(node => 'tbSaveCurrentProfile' in node.dataset)!
    assert.ok(saveCurrent)
    saveCurrent.click()
    await turn()
    const currentDialog = browser.root.find(node => node.className.includes('tb-dialog'))!
    const currentName = currentDialog.find(node => node.className === '' && 'maxLength' in node)!
    currentName.value = 'My Current Color Theme'
    currentName.dispatchEvent(new Event('input'))
    currentDialog.find(node => node.textContent === 'Save')!.click()
    await turn(); await turn()
    assert.equal(page.confirmed?.profiles.length, 2)
    const savedCurrent = page.confirmed!.profiles[1]
    assert.equal(savedCurrent.name, 'My Current Color Theme')
    assert.equal(savedCurrent.appearance.accent, '#33aa88')
    assert.equal(savedCurrent.appearance.schemeOverride, 'light')

    // Inside blank editor, "Use current color" pulls ONLY accent + scheme without copying active wallpaper
    addBtn.click()
    await turn()
    const blankDialog = browser.root.find(node => node.className.includes('tb-dialog'))!
    blankDialog.find(node => 'tbUseCurrentColor' in node.dataset)!.click()
    const blankName = blankDialog.find(node => node.className === '' && 'maxLength' in node)!
    blankName.value = 'Color Only Import'
    blankName.dispatchEvent(new Event('input'))
    blankDialog.find(node => node.textContent === 'Save')!.click()
    await turn(); await turn()
    const colorOnly = page.confirmed!.profiles[2]
    assert.equal(colorOnly.appearance.accent, '#33aa88')
    assert.equal(colorOnly.appearance.schemeOverride, 'light')
    assert.deepEqual(colorOnly.source, { kind: 'none' }, 'keeps independent blank wallpaper')
  } finally { signal.abort(); page.dispose() }
})

test('saved custom local-video profile card renders a captured poster frame and immediately releases the temporary video URL', async context => {
  const h = host(), signal = new AbortController(), browser = fixtures(signal.signal)
  const videoId = uuid(), videoBlob = new Blob(['mp4data'], { type: 'video/mp4' })
  const posterBlob = new Blob(['webpdata'], { type: 'image/webp' })
  const created: string[] = [], revoked: string[] = []
  let uid = 0
  context.mock.method(URL, 'createObjectURL', () => { const url = `blob:thumb/${++uid}`; created.push(url); return url })
  context.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url) })

  const origCreate = browser.ui.doc.createElement.bind(browser.ui.doc)
  browser.ui.doc.createElement = ((tag: string) => {
    const el = origCreate(tag) as unknown as Record<string, unknown>
    if (tag === 'video') {
      let currentSrc = ''
      Object.defineProperty(el, 'src', {
        get: () => currentSrc,
        set: (v: string) => {
          currentSrc = v
          if (v) queueMicrotask(() => (el as unknown as EventTarget).dispatchEvent(new Event('loadeddata')))
        },
      })
    }
    if (tag === 'canvas') {
      el.getContext = () => ({ drawImage() {} })
      el.toBlob = (cb: (b: Blob | null) => void) => cb(posterBlob)
    }
    return el as unknown as HTMLElement
  }) as typeof browser.ui.doc.createElement

  const page = editSettings(h.storage, () => {}, () => {})
  h.publish({ theme: {
    ...DEFAULT,
    profiles: [{
      id: uuid(), name: 'Video Look', createdAt: 1,
      appearance: readAppearance({ accent: '#00ef07', schemeOverride: 'dark' }),
      source: { kind: 'local-video', id: videoId, mime: 'video/mp4' },
    }],
  } })
  await page.read()
  const store = {
    async list() { return [] },
    async backgroundBlob(id: string, kind: 'image' | 'video') { return id === videoId && kind === 'video' ? videoBlob : undefined },
  } as unknown as MediaStore
  const panel = browser.panel('profiles')
  const renderProfiles = profilesPage(browser.ui, panel, signal.signal, () => page.draft!, page.editMany, page.flush, () => {}, () => page.readOnly,
    async () => undefined, store)
  try {
    renderProfiles(page.draft!, page.readOnly)
    await turn(); await turn(); await turn()
    const card = browser.root.find(node => node.className.includes('tb-custom-card'))!
    const img = card.find(node => node.className === 'tb-preset-img')!
    assert.equal(img.hidden, false, 'captured poster frame must be shown on saved video profile card')
    assert.equal(img.src, 'blob:thumb/2')
    assert.deepEqual(revoked, ['blob:thumb/1'], 'temporary video ObjectURL is revoked immediately after poster capture')
  } finally {
    signal.abort()
    page.dispose()
  }
  assert.deepEqual(revoked, created, 'poster ObjectURL is revoked on dispose')
})

test('profilesPage defers thumbnail fetches while hidden and removes signal listeners when cards re-render', async context => {
  const h = host(), signal = new AbortController(), browser = fixtures(signal.signal)
  const imgId = uuid(), imgBlob = new Blob(['png'], { type: 'image/png' })
  let uid = 0
  const revoked: string[] = []
  context.mock.method(URL, 'createObjectURL', () => `blob:lazy/${++uid}`)
  context.mock.method(URL, 'revokeObjectURL', (u: string) => { revoked.push(u) })

  let signalListeners = 0
  const origAdd = signal.signal.addEventListener.bind(signal.signal)
  const origRem = signal.signal.removeEventListener.bind(signal.signal)
  signal.signal.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    if (type === 'abort') signalListeners++
    return origAdd(type, fn, opts)
  }) as typeof signal.signal.addEventListener
  signal.signal.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | EventListenerOptions) => {
    if (type === 'abort') signalListeners--
    return origRem(type, fn, opts)
  }) as typeof signal.signal.removeEventListener

  const assetCalls: string[] = []
  const page = editSettings(h.storage, () => {}, () => {})
  const profId = uuid()
  h.publish({ theme: {
    ...DEFAULT,
    profiles: [{
      id: profId, name: 'Lazy Look', createdAt: 1,
      appearance: readAppearance({ accent: '#3da58a', schemeOverride: 'dark' }),
      source: { kind: 'local-image', id: imgId },
    }],
  } })
  await page.read()
  const store = {
    async list() { return [] },
    async backgroundBlob(id: string) { return id === imgId ? imgBlob : undefined },
  } as unknown as MediaStore
  const panel = browser.panel('profiles')
  const renderProfiles = profilesPage(browser.ui, panel, signal.signal, () => page.draft!, page.editMany, page.flush, () => {}, () => page.readOnly,
    async p => { assetCalls.push(p); return `/${p}` }, store)
  try {
    renderProfiles(page.draft!, page.readOnly, false)
    await turn()
    assert.deepEqual(assetCalls, [], 'no preset assets loaded while profiles tab is hidden')
    assert.equal(uid, 0, 'no custom thumbnail ObjectURL allocated while profiles tab is hidden')

    renderProfiles(page.draft!, page.readOnly, true)
    await turn(); await turn()
    assert.equal(assetCalls.length, 4, 'loads built-in thumbnails once visible')
    assert.equal(uid, 1, 'loads custom image thumbnail once visible')
    const baselineListeners = signalListeners

    // Force repeated re-renders via retryMedia; abort listeners must NOT accumulate on page signal
    renderProfiles.retryMedia(imgId)
    await turn(); await turn()
    renderProfiles.retryMedia(imgId)
    await turn(); await turn()
    assert.equal(uid, 3)
    assert.equal(revoked.length, 2, 'previous thumbnail ObjectURLs revoked on re-render')
    assert.equal(signalListeners, baselineListeners, 'onRelease cleans up page signal abort listener on re-render')
  } finally {
    signal.abort()
    page.dispose()
  }
  assert.equal(revoked.length, 3, 'final thumbnail ObjectURL revoked on dispose')
})

test('otter composer pet mounts official silhouette, reacts to typing and clicks, and cleans up completely on dispose', () => {
  class FakeNode extends EventTarget {
    tag: string
    className = ''
    dataset: Record<string, string> = {}
    attrs = new Map<string, string>()
    children: FakeNode[] = []
    parent: FakeNode | null = null
    hidden = false
    textContent = ''
    offsetWidth = 10
    #classes = new Set<string>()
    constructor(tag: string) { super(); this.tag = tag }
    get isConnected(): boolean { return this.tag === 'host' || !!this.parent?.isConnected }
    classList = {
      add: (c: string) => { this.#classes.add(c); this.className = [...this.#classes].join(' ') },
      remove: (c: string) => { this.#classes.delete(c); this.className = [...this.#classes].join(' ') },
    }
    setAttribute(k: string, v: string) { this.attrs.set(k, v) }
    toggleAttribute(k: string, force?: boolean) { if (force === false) this.attrs.delete(k); else this.attrs.set(k, '') }
    append(...nodes: FakeNode[]) { for (const n of nodes) { n.parent = this; this.children.push(n) } }
    remove() { if (!this.parent) return; this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null }
  }
  const makeNode = (tag: string) => new FakeNode(tag)
  const hostEl = makeNode('host')
  const timers = new Map<number, () => void>()
  let nextTimer = 0
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    defaultView: {
      setTimeout(fn: () => void) { const id = ++nextTimer; timers.set(id, fn); return id },
      clearTimeout(id: number) { timers.delete(id) },
    },
    querySelector: (sel: string) => sel === '[data-composer-card]' ? hostEl : null,
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (_ns: string, tag: string) => makeNode(tag),
  }) as unknown as Document

  const pet = createOtterPet(doc, '[data-composer-card]', target => {
    const container = makeNode('div')
    ;(target as unknown as FakeNode).append(container)
    return { container: container as unknown as HTMLElement, dispose() { container.remove() } }
  })

  pet.sync(true)
  assert.equal(pet.isHealthy(), true)
  assert.equal(hostEl.children.length, 1)
  const petBox = hostEl.children[0]
  assert.equal(petBox.dataset.tbPetMood, 'idle')
  const svg = petBox.children[1].children[0]
  const classes = svg.children.map(c => c.attrs.get('class') ?? c.tag)
  assert.deepEqual(classes, ['tb-otter-laptop', 'tb-otter-tail', 'tb-otter-back-legs', 'tb-otter-torso', 'tb-otter-paw-l', 'tb-otter-paw-r'])
  assert.equal(svg.children[3].children[2].attrs.get('d'), OTTER_BODY_PATH)
  assert.equal(svg.children[0].children[5].attrs.get('d'), OTTER_ACCENT_PATH)

  // Typing triggers typing mood, then settles back to idle
  hostEl.dispatchEvent(new Event('input'))
  assert.equal(petBox.dataset.tbPetMood, 'typing')
  for (const fn of [...timers.values()]) fn()
  timers.clear()
  assert.equal(petBox.dataset.tbPetMood, 'idle')

  // Click triggers hop + sparkle without propagating
  petBox.dispatchEvent(new Event('click'))
  assert.equal(petBox.dataset.tbPetMood, 'hop')
  assert.equal(petBox.children[2].hidden, false)

  // Priority anchor re-mounts onto a higher dock when present while still listening to composer input
  const dockRoot = makeNode('host')
  const dockEl = makeNode('div')
  dockRoot.append(dockEl)
  let dockOpen = true
  const multiDoc = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    defaultView: doc.defaultView,
    querySelector: (sel: string) => sel === '[data-queue-dock]' ? (dockOpen ? dockEl : null) : sel === '[data-composer-card]' ? hostEl : null,
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (_ns: string, tag: string) => makeNode(tag),
  }) as unknown as Document
  const smartPet = createOtterPet(multiDoc, ['[data-queue-dock]', '[data-composer-card]'], target => {
    const container = makeNode('div')
    ;(target as unknown as FakeNode).append(container)
    return { container: container as unknown as HTMLElement, dispose() { container.remove() } }
  }, '[data-composer-card]')
  smartPet.sync(true)
  assert.equal(dockEl.children.length, 1)
  assert.equal(smartPet.hasLostHost(), false)
  hostEl.dispatchEvent(new Event('input'))
  assert.equal(dockEl.children[0].dataset.tbPetMood, 'typing')
  // Removing the queue dock disconnects the pet's current host and triggers hasLostHost() so the observer hops back
  dockOpen = false
  dockEl.remove()
  assert.equal(smartPet.isHealthy(), false)
  assert.equal(smartPet.hasLostHost(), true)
  smartPet.sync(true)
  assert.equal(smartPet.isHealthy(), true)
  assert.equal(smartPet.hasLostHost(), false)
  assert.equal(dockEl.children.length, 0)
  assert.equal(hostEl.children.length, 2)
  smartPet.dispose()

  // Dispose removes DOM and clears timers
  pet.dispose()
  assert.equal(pet.isHealthy(), false)
  assert.equal(hostEl.children.length, 0)
  assert.equal(timers.size, 0)
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
