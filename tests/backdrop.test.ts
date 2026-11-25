import assert from 'node:assert/strict'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { DEFAULT, LAYOUTS, PATTERNS, SHADERS } from '../src/shared/config.ts'
import { createFontLoader } from '../src/shared/font-loader.ts'
import { createBackdrop, imageGeometry } from '../src/render/backdrop-layer.ts'
import type { RenderState } from '../src/render/backdrop-layer.ts'

const local = (id: string) => ({ ...DEFAULT, source: { kind: 'local-image', id } as const })
const mesh = { ...DEFAULT, source: { kind: 'mesh', seed: 1729, scale: 1, intensity: 0.65 } as const }
const shader = { ...DEFAULT, source: { kind: 'shader', preset: 'aurora', seed: 1729, scale: 1, speed: 0.5 } as const }
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

function browser(context: TestContext, initial = 300) {
  let uid = 0, refresh!: ResizeObserverCallback, draws = 0, decodeFailure = false
  let samples = 0, sampleError = false, pixel = [10, 10, 10, 255]
  const copies: number[][] = []
  let gl: Partial<WebGLRenderingContext> | null = null, supports2d = true, disconnected = false
  const objects: string[] = [], revoked: string[] = []
  const canvases: Canvas[] = [], images: Image[] = [], videos: Video[] = [], rafs = new Map<number, FrameRequestCallback>()
  const motion = Object.assign(new EventTarget(), { matches: false })
  const win = {
    devicePixelRatio: 1, matchMedia: () => motion,
    requestAnimationFrame(callback: FrameRequestCallback) { rafs.set(++uid, callback); return uid },
    cancelAnimationFrame(id: number) { rafs.delete(id) },
  }
  const doc = Object.assign(new EventTarget(), {
    defaultView: win, visibilityState: 'visible',
    createElement(name: string) {
      if (name === 'img') { const image = new Image(); images.push(image); return image }
      if (name === 'canvas') { const canvas = new Canvas(); canvases.push(canvas); return canvas }
      if (name === 'video') { const video = new Video(); videos.push(video); return video }
      return new Element()
    },
  })
  class Element extends EventTarget {
    ownerDocument = doc
    style: Record<string, string> = {}
    children = new Set<Element>()
    parent: Element | undefined
    get parentElement() { return this.parent }
    setAttribute() {}
    clientWidth = initial
    clientHeight = initial
    hidden = false
    isConnected = true
    append(el: Element) { el.parent = this; this.children.add(el) }
    remove() { this.parent?.children.delete(this); this.parent = undefined }
  }
  const ctx = {
    clearRect() {}, setTransform() {}, drawImage(_frame: unknown, ...args: number[]) { copies.push(args); draws++ }, fillRect() { draws++ },
    getImageData() {
      samples++
      if (sampleError) throw new DOMException('Tainted', 'SecurityError')
      return { data: new Uint8ClampedArray(pixel) }
    },
    createPattern: () => ({ setTransform() {} }),
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() { draws++ }, fill() { draws++ }, arc() {},
  }
  class Canvas extends Element {
    tagName = 'CANVAS'
    width = 300; height = 150
    contexts: string[] = []
    getContext(type: string) {
      this.contexts.push(type)
      return type === 'webgl' ? gl : supports2d ? ctx : null
    }
  }
  class Image extends Element {
    referrerPolicy = ''
    src = ''
    naturalWidth = 0; naturalHeight = 0
    async decode() {
      if (decodeFailure) throw new Error('decode failed')
      this.naturalWidth = 400; this.naturalHeight = 200
    }
    removeAttribute(name: string) { if (name === 'src') this.src = '' }
  }
  class Video extends Element {
    muted = false; defaultMuted = false; playsInline = false; loop = false; autoplay = false; paused = true
    videoWidth = 480; videoHeight = 270
    currentTime = 0; loads = 0
    #src = ''
    get src() { return this.#src }
    set src(value) { this.#src = value; if (value) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))) }
    async play() { this.paused = false }
    pause() { this.paused = true }
    load() { this.loads++ }
    removeAttribute(name: string) { if (name === 'src') this.src = '' }
  }
  const beforeObserver = globalThis.ResizeObserver
  context.after(() => { globalThis.ResizeObserver = beforeObserver })
  globalThis.ResizeObserver = class {
    constructor(fn: ResizeObserverCallback) { refresh = fn }
    observe() {}
    disconnect() { disconnected = true }
  } as unknown as typeof ResizeObserver
  context.mock.method(URL, 'createObjectURL', () => { const value = `blob:test/${++uid}`; objects.push(value); return value })
  context.mock.method(URL, 'revokeObjectURL', (value: string) => {
    assert.ok(images.every(image => image.src !== value) && videos.every(video => video.src !== value), 'detach media before revoking')
    assert.ok(!revoked.includes(value), 'never revoke twice')
    revoked.push(value)
  })
  const container = new Element(), abort = new AbortController(), states: RenderState[] = []
  return {
    start: (load = async (_id: string): Promise<Blob | undefined> => undefined, sample = false) =>
      createBackdrop(container as unknown as HTMLElement, abort.signal, load, state => states.push(state), sample ? { baseColor: () => '#fff' } : {}),
    resize(width: number, height: number) { refresh([{ contentRect: { width, height } }] as ResizeObserverEntry[], {} as ResizeObserver) },
    tick(time: number) { for (const [id, fn] of [...rafs]) { rafs.delete(id); fn(time) } },
    failDecode() { decodeFailure = true }, mockGL(next: Partial<WebGLRenderingContext>) { gl = next }, fail2d() { supports2d = false },
    failSample() { sampleError = true }, setPixel(next: number[]) { pixel = next },
    objects, revoked, images, videos, canvases, rafs, states, container, motion, doc, abort, copies,
    get disconnected() { return disconnected }, get draws() { return draws }, get samples() { return samples },
  }
}

test('400×200 into 300×300: five layouts, edge alignment, zoom and zero size', () => {
  const expected = [[300, 150, 0, 75], [600, 300, -150, 0], [300, 300, 0, 0], [400, 200, 0, 0], [400, 200, -50, 50]]
  for (const [i, mode] of LAYOUTS.entries()) {
    const g = imageGeometry(300, 300, 400, 200, { ...DEFAULT.placement, mode })!
    assert.deepEqual([g.dw, g.dh, g.x, g.y], expected[i])
  }
  const tile = imageGeometry(300, 300, 400, 200, { mode: 'tile', zoom: 2, panX: 0, panY: 1 })!
  assert.deepEqual(tile, { dw: 800, dh: 400, x: -400, y: 200, spanX: 800, spanY: 400 })
  assert.equal(imageGeometry(300, 0, 400, 200, DEFAULT.placement), undefined)
})
test('zero size allocates nothing; resize, opacity, motion, hide and dispose manage one render loop', context => {
  const b = browser(context, 0), layer = b.start()
  layer.update(mesh)
  assert.equal(b.canvases.length, 0)
  assert.equal(b.rafs.size, 0)
  b.resize(10000, 5000)
  assert.equal(b.canvases.length, 1)
  assert.equal(b.canvases[0].width, 2048)
  assert.deepEqual(b.states.at(-1), { state: 'ready', frameDark: null })
  assert.equal(b.rafs.size, 1)
  const draws = b.draws
  b.tick(20)
  b.tick(30)
  assert.ok(b.draws > draws)
  assert.equal(b.rafs.size, 1)
  layer.update({ ...mesh, opacity: 0 })
  assert.equal(b.rafs.size, 0)
  layer.update({ ...mesh, blur: 60 })
  assert.equal(b.canvases.length, 1)
  assert.equal(b.canvases[0].style.inset, '-180px')
  layer.pause(); assert.equal(b.rafs.size, 0)
  layer.resume(); assert.equal(b.rafs.size, 1)
  b.motion.matches = true
  b.motion.dispatchEvent(new Event('change'))
  assert.equal(b.rafs.size, 0)
  b.motion.matches = false
  b.motion.dispatchEvent(new Event('change'))
  layer.setVisible(false)
  assert.equal(b.rafs.size, 0)
  layer.setVisible(true)
  b.doc.visibilityState = 'hidden'
  b.doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(b.rafs.size, 0)
  b.abort.abort(); layer.dispose()
  assert.equal(b.rafs.size, 0)
  assert.equal(b.container.children.size, 0)
  assert.equal(b.disconnected, true)
  b.resize(200, 200)
  assert.equal(b.canvases.length, 1)
})
test('late Blob cannot replace the current frame; URLs are consumer-owned and revoked once', async context => {
  let release!: (blob: Blob) => void
  const late = new Promise<Blob>(resolve => { release = resolve })
  const b = browser(context), layer = b.start(id => id === 'old' ? late : Promise.resolve(new Blob(['test'])))
  layer.update(local('old'))
  layer.update(local('new'))
  await flush()
  assert.deepEqual(b.states.at(-1), { state: 'ready', frameDark: null })
  assert.equal(b.images.length, 1)
  assert.equal(b.images[0].referrerPolicy, 'no-referrer')
  release(new Blob(['late']))
  await flush()
  assert.equal(b.images.length, 1)
  assert.equal(b.objects.length, 1)
  assert.deepEqual(layer.pan(12, 40), { ...DEFAULT.placement, panX: 0.46 })
  layer.update({ ...local('new'), opacity: 30, placement: { ...DEFAULT.placement, zoom: 2 } })
  assert.equal(b.images.length, 1)
  layer.update(DEFAULT)
  layer.dispose(); layer.dispose()
  assert.deepEqual(b.revoked, b.objects)
})
test('decode failure releases URL; missing and failed media stay distinct', async context => {
  const b = browser(context), layer = b.start(async id => {
    if (id === 'storage') throw new Error('blocked DB')
    if (id === 'missing') return undefined
    return new Blob(['invalid'])
  })
  b.failDecode()
  for (const [id, reason] of [['broken', 'image'], ['missing', 'missing-local'], ['storage', 'storage']]) {
    layer.update(local(id))
    await flush()
    assert.deepEqual(b.states.at(-1), { state: 'unavailable', reason })
    assert.equal(b.container.children.size, 0)
  }
  layer.dispose()
  assert.equal(b.objects.length, 1)
  assert.deepEqual(b.revoked, b.objects)
})

test('every pattern draws on canvas and all four shaders reuse the seeded Mesh downgrade', context => {
  const b = browser(context), layer = b.start()
  for (const preset of PATTERNS) {
    const before = b.draws
    layer.update({ ...DEFAULT, source: { kind: 'pattern', preset, seed: 1234, scale: 1, density: 0.4 } })
    assert.deepEqual(b.states.at(-1), { state: 'ready', frameDark: null }, preset)
    assert.ok(b.draws > before, preset)
    assert.equal(b.container.children.size, 1)
  }
  for (const preset of SHADERS) {
    layer.update({ ...shader, source: { ...shader.source, preset } })
    assert.deepEqual(b.canvases.slice(-2).map(canvas => canvas.contexts), [['webgl'], ['2d']])
    assert.deepEqual(b.states.at(-1), { state: 'fallback', effect: 'mesh', frameDark: null }, preset)
  }
  layer.dispose()
  assert.equal(b.container.children.size, 0)
  assert.equal(b.rafs.size, 0)
})

test('video owns a source URL, uses independent placement and pauses for visibility and disposal', async context => {
  const b = browser(context), layer = b.start(async () => new Blob(['video'], { type: 'video/webm' }))
  layer.update({ ...DEFAULT, source: { kind: 'local-video', id: 'clip', mime: 'video/webm' }, videoPlacement: { ...DEFAULT.placement, mode: 'fit' } })
  await flush()
  const video = b.videos[0]
  assert.ok(video.muted && video.playsInline && video.loop && video.autoplay && !video.paused)
  assert.equal(video.style.width, '300px')
  assert.equal(video.style.height, '168.75px')
  layer.setVisible(false); assert.ok(video.paused && !video.autoplay)
  layer.setVisible(true); assert.equal(video.paused, false)
  const frame = layer.snapshot()
  assert.equal(frame?.width, 300)
  assert.deepEqual(b.copies.at(-1), [0, 65.625, 300, 168.75])
  b.abort.abort()
  assert.ok(video.paused && video.loads === 1 && !video.src)
  assert.deepEqual(b.revoked, b.objects)
})

test('font load generations use ArrayBuffer (CSP-safe) and never register a late face', async () => {
  const sources: unknown[] = [], registered = new Set<MockFace>()
  const finish: (() => void)[] = []
  class MockFace {
    constructor(_family: string, source: unknown) { sources.push(source) }
    load() { return new Promise<MockFace>(resolve => { finish.push(() => resolve(this)) }) }
  }
  const doc = { defaultView: { FontFace: MockFace }, fonts: registered } as unknown as Document
  const abort = new AbortController(), states: string[] = []
  const makeFont = (id: string) => ({ enabled: true, mediaId: id, mime: 'font/woff2' } as const)
  const loader = createFontLoader(doc, abort.signal, async id => ({ id, name: id, mime: 'font/woff2', size: 4,
    kind: 'font', createdAt: 0, blob: new Blob(['wOF2']) }), state => states.push(state))
  loader.update(makeFont('old')); await flush(); await flush()
  loader.update(makeFont('new')); await flush(); await flush()
  assert.equal(sources.length, 2)
  assert.ok(sources.every(s => s instanceof ArrayBuffer), 'loads font via ArrayBuffer to satisfy Desktop font-src CSP')
  finish[0](); await flush(); assert.equal(registered.size, 0)
  finish[1](); await flush(); assert.equal(registered.size, 1)
  assert.equal(states.at(-1), 'ready')
  abort.abort(); loader.dispose()
  assert.equal(registered.size, 0)
})

test('GL partial allocation is reclaimed and Mesh uses a fresh canvas, then gradients work without 2D', context => {
  const b = browser(context), deleted: string[] = []
  let shaderCount = 0
  b.mockGL({
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, ARRAY_BUFFER: 3, COMPILE_STATUS: 4, LINK_STATUS: 5,
    createShader: () => ({ id: ++shaderCount }), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => false,
    useProgram() {}, bindBuffer() {}, deleteProgram: () => { deleted.push('program') },
    deleteShader: (value: { id: number }) => { deleted.push(`shader${value.id}`) },
    isContextLost: () => false, getExtension: () => ({ loseContext() { deleted.push('context') } }),
  } as unknown as Partial<WebGLRenderingContext>)
  const layer = b.start()
  layer.update(shader)
  assert.deepEqual(b.canvases.map(c => c.contexts), [['webgl'], ['2d']])
  assert.equal(b.container.children.has(b.canvases[0]), false)
  assert.deepEqual(b.states.at(-1), { state: 'fallback', effect: 'mesh', frameDark: null })
  assert.deepEqual(deleted, ['program', 'shader1', 'shader2', 'context'])
  b.fail2d()
  layer.update(mesh)
  assert.deepEqual(b.states.at(-1), { state: 'fallback', effect: 'gradient', frameDark: null })
  assert.equal(b.rafs.size, 0)
  layer.dispose()
})

test('brightness is sampled only once per source, crops blur padding, and isolates read errors', async context => {
  let stale!: (blob: Blob) => void
  const old = new Promise<Blob>(resolve => { stale = resolve })
  const b = browser(context), layer = b.start(id => id === 'old' ? old : Promise.resolve(new Blob(['image'])), true)
  layer.update({ ...mesh, blur: 10 })
  assert.deepEqual(b.states.at(-1), { state: 'ready', frameDark: true })
  assert.deepEqual(b.copies.at(-1), [16.5, 16.5, 165, 165, 0, 0, 32, 32])
  b.tick(40); b.tick(100); layer.update(mesh); b.resize(720, 480)
  assert.equal(b.samples, 1)
  b.setPixel([255, 255, 255, 255])
  layer.update({ ...mesh, source: { ...mesh.source, seed: 2 } })
  assert.deepEqual(b.states.at(-1), { state: 'ready', frameDark: false })
  layer.update(local('old')); assert.deepEqual(b.states.at(-1), { state: 'loading' })
  b.failSample(); layer.update({ ...DEFAULT, source: { kind: 'url', url: 'https://wallpaper.test/no-cors' } })
  await flush()
  assert.deepEqual(b.states.at(-1), { state: 'ready', frameDark: null, animatedImage: true })
  stale(new Blob(['old'])); await flush()
  assert.equal(b.samples, 3)
  b.container.isConnected = false; b.resize(0, 0)
  assert.deepEqual(b.states.at(-1), { state: 'idle' })
  assert.equal(layer.snapshot(), undefined)
  layer.dispose()
})

test('GIF animates natively with one blur board and only the needed extensions; pause and reduce freeze it', async context => {
  const original = globalThis.DOMMatrix
  context.after(() => { globalThis.DOMMatrix = original })
  globalThis.DOMMatrix = class {} as typeof DOMMatrix
  const b = browser(context), layer = b.start(async () => new Blob(['GIF89a'], { type: 'image/gif' }), true)
  const setup = { ...local('gif'), blur: 10, placement: { ...DEFAULT.placement, mode: 'fit' } as const }
  layer.update(setup); await flush()
  const photo = b.images[0], board = photo.parent!
  assert.deepEqual(b.states.at(-1), { state: 'ready', frameDark: true, animatedImage: true })
  assert.equal(board.style.filter, 'blur(10px)')
  assert.deepEqual([photo.style.left, photo.style.top, photo.style.width, photo.style.height], ['30px', '105px', '300px', '150px'])
  assert.equal(photo.style.inset, undefined)
  const clips = [...board.children].slice(1)
  assert.equal(clips.length, 2)
  assert.ok(clips.every(c => c.style.top === '105px' && c.style.height === '150px'))
  layer.update({ ...setup, placement: { ...setup.placement, mode: 'stretch' } })
  assert.equal(board.children.size, 9, 'four edges and four corners')
  layer.pause()
  assert.equal(photo.parent, undefined)
  assert.ok(b.container.children.has(b.canvases.at(-1)!))
  layer.resume(); assert.ok(photo.parent)
  b.motion.matches = true; b.motion.dispatchEvent(new Event('change'))
  assert.equal(photo.parent, undefined)
  b.motion.matches = false; b.motion.dispatchEvent(new Event('change'))
  assert.ok(photo.parent)
  layer.update({ ...setup, placement: { ...setup.placement, mode: 'tile' } })
  assert.equal(photo.parent, undefined)
  assert.equal(b.samples, 1)
  assert.equal(b.objects.length, 1)
  layer.update(DEFAULT); layer.dispose()
  assert.deepEqual(b.revoked, b.objects)
})

test('a GL context loss replaces the sampled frame once and retires the old canvas', context => {
  const b = browser(context), noop = () => {}, object = () => ({})
  b.mockGL({ createShader: object, shaderSource: noop, compileShader: noop, getShaderParameter: () => true,
    createProgram: object, attachShader: noop, linkProgram: noop, getProgramParameter: () => true,
    createBuffer: object, getAttribLocation: () => 0, bindBuffer: noop, bufferData: noop, enableVertexAttribArray: noop,
    vertexAttribPointer: noop, useProgram: noop, getUniformLocation: object, uniform1f: noop, uniform2f: noop,
    getError: () => 0, NO_ERROR: 0, viewport: noop, drawArrays: noop, isContextLost: () => false,
    deleteShader: noop, deleteProgram: noop, deleteBuffer: noop, getExtension: () => null } as unknown as WebGLRenderingContext)
  const layer = b.start(undefined, true)
  layer.update(shader)
  assert.equal(b.samples, 1)
  assert.deepEqual(b.states.at(-1), { state: 'ready', frameDark: true })
  b.setPixel([255, 255, 255, 255]); const [canvas] = b.canvases
  canvas.dispatchEvent(new Event('webglcontextlost'))
  canvas.dispatchEvent(new Event('webglcontextlost')); b.tick(150)
  assert.equal(b.samples, 2)
  assert.deepEqual(b.states.at(-1), { state: 'fallback', effect: 'mesh', frameDark: false })
  layer.dispose()
})
