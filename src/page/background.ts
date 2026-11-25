import { clamp, DEFAULT, LAYOUTS, PATTERNS, publicImageUrl, randomSeed, readSource, ROTATION_INTERVALS, ROTATION_MODES, SHADERS } from '../shared/config.ts'
import type { Placement, Source, ThemeConfig } from '../shared/config.ts'
import type { MediaStore } from '../shared/media-db.ts'
import type { RotationAction } from '../shared/rotation.ts'
import { equal } from '../shared/sync.ts'
import { createBackdrop, renderedFrame } from '../render/backdrop-layer.ts'
import type { BackdropScene, RenderState } from '../render/backdrop-layer.ts'
import type { mediaPage } from './library.ts'
import type { Key } from './i18n.ts'
import { preserveFocus } from './ui.ts'
import type { Ui } from './ui.ts'

const SOURCES = ['none', 'still', 'video', 'mesh', 'shader', 'pattern', 'rotation'] as const
type SourceGroup = typeof SOURCES[number]
export type ColorSample = { frame: HTMLCanvasElement; preview: boolean } | { error: 'sampleCors' | 'sampleError' }
const sourceGroup = (source: Source) => source.kind === 'local-video' ? 'video' : source.kind === 'local-image' || source.kind === 'url' ? 'still' : source.kind
const isPhoto = (source: Source) => ['url', 'local-image', 'local-video', 'rotation'].includes(source.kind)

export function backgroundPage(ui: Ui, panel: HTMLElement, signal: AbortSignal, media: MediaStore, library: ReturnType<typeof mediaPage>,
  current: () => ThemeConfig, edit: (patch: Partial<ThemeConfig>) => void, commit: () => void, locked: () => boolean,
  publishRotation: (poolId: string) => void, toast: (key: Key) => void, effectiveConfig: () => ThemeConfig) {
  const { make, text, on, button, check, input, select, slider, choices, card, value, label } = ui
  const previewCard = card(panel, 'preview', 'tb-preview-card')
  const preview = make('div', previewCard, 'tb-preview')
  preview.setAttribute('role', 'img'); label(preview, 'preview')
  const controls = make('div', previewCard, 'tb-actions')
  const pause = button(controls, 'pause', () => {
    paused = !paused
    if (paused) backdrop.pause(); else backdrop.resume()
    drawControls()
  })
  const reset = button(controls, 'resetPlacement', () => changePlacement(DEFAULT.placement, true))
  const output = make('p', previewCard, 'tb-hint')
  output.setAttribute('aria-live', 'polite')
  const retry = button(controls, 'retry', () => backdrop.retry())
  const link = button(controls, 'associate', () => {
    const source = resolve(current()).source
    if (source.kind === 'local-image') library.link({ kind: 'image', id: source.id })
    if (source.kind === 'local-video') library.link({ kind: 'video', id: source.id, mime: source.mime })
  })
  const fields = make('fieldset', panel, 'tb-card')
  text(make('h3', fields), 'source')
  const sources = choices(fields, 'source', SOURCES, key => void selectSource(key))
  const stillInUse = make('p', fields, 'tb-hint')
  stillInUse.setAttribute('role', 'status')
  const image = make('div', fields, 'tb-compact')
  library.upload(image, 'image', 'localImage', 'imageRules')
  const url = input(image, 'address', 'url')
  url.maxLength = 2048; url.autocomplete = 'off'
  text(make('p', image, 'tb-hint'), 'urlHint')
  const urlError = text(make('p', image, 'tb-error'), 'urlInvalid')
  urlError.hidden = true; urlError.setAttribute('role', 'alert')
  function applyUrl() {
    const valid = publicImageUrl(url.value.trim())
    urlError.hidden = !!valid; url.setAttribute('aria-invalid', String(!valid))
    if (!valid) return
    editingUrl = false
    edit({ source: { kind: 'url', url: valid }, respectReducedTransparency: false, activeProfile: null }); commit()
    if (state.state === 'unavailable') backdrop.retry()
  }
  on(url, 'input', () => { editingUrl = true; urlError.hidden = true; url.removeAttribute('aria-invalid') })
  on(url, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyUrl() } })
  button(image, 'apply', applyUrl)
  const video = library.upload(fields, 'video', 'localVideo', 'videoRules')
  const generator = make('div', fields, 'tb-compact')
  const shaders = choices(generator, 'shader', SHADERS, preset => changeGenerator({ preset }, true), 'tb-effects')
  const patterns = choices(generator, 'pattern', PATTERNS, preset => changeGenerator({ preset }, true), 'tb-effects')
  const seeds = make('div', generator, 'tb-actions')
  const seed = input(seeds, 'seed', 'number')
  seed.min = '1'; seed.max = '2147483647'; seed.step = '1'
  on(seed, 'change', () => {
    if (Number.isFinite(seed.valueAsNumber)) changeGenerator({ seed: seed.valueAsNumber }, true)
    render(current(), locked(), !panel.hidden)
  })
  button(seeds, 'random', () => changeGenerator({ seed: randomSeed() }, true))
  const regenerate = check(generator, 'regenerate', regenerateOnReload => edit({ regenerateOnReload }))
  const scale = slider(generator, 'scale', 0.5, 2, 0.01, scale => changeGenerator({ scale }))
  const intensity = slider(generator, 'intensity', 0, 1, 0.01, intensity => changeGenerator({ intensity }))
  const speed = slider(generator, 'speed', 0, 1, 0.01, speed => changeGenerator({ speed }))
  const density = slider(generator, 'density', 0, 1, 0.01, density => changeGenerator({ density }))
  const poolCard = make('section', fields, 'tb-pool tb-compact')
  text(make('h3', poolCard), 'rotationPool')
  library.upload(poolCard, 'pool', 'poolUpload', 'imageRules')
  const poolControls = make('div', poolCard, 'tb-actions')
  const order = select(poolControls, 'playOrder', ROTATION_MODES), interval = select(poolControls, 'interval', ROTATION_INTERVALS)
  const nextImage = button(poolControls, 'nextImage', () => void rotate('next'))
  on(order, 'change', () => changePool({ mode: order.value as ThemeConfig['rotation']['mode'] }))
  on(interval, 'change', () => changePool({ interval: interval.value as ThemeConfig['rotation']['interval'] }))
  const thumbnails = make('div', poolCard, 'tb-pool-grid')
  const placement = make('div', fields, 'tb-compact tb-placement')
  const modes = choices(placement, 'layout', LAYOUTS, mode => changePlacement({ mode }, true))
  const zoom = slider(placement, 'zoom', 0.25, 4, 0.001, zoom => changePlacement({ zoom }))
  const panX = slider(placement, 'panX', 0, 1, 0.001, panX => changePlacement({ panX }))
  const panY = slider(placement, 'panY', 0, 1, 0.001, panY => changePlacement({ panY }))
  text(make('p', placement, 'tb-hint'), 'gesture')
  const opacity = slider(fields, 'opacity', 0, 100, 1, opacity => edit({ opacity, activeProfile: null }))
  const blur = slider(fields, 'blur', 0, 60, 1, blur => edit({ blur, activeProfile: null }))
  button(fields, 'resetBackdrop', () => void resetBackground())
  panel.prepend(previewCard); previewCard.after(fields)

  let browse: SourceGroup | undefined, previousSource: Source | undefined, editingUrl = false, state: RenderState = { state: 'idle' }
  let sourceTicket = 0
  const remembered: Partial<Record<'image' | 'video', string>> = {}
  let paused = false, shown = false, poolId = '', renderedPool = '', lastPool: ThemeConfig['rotation'] | undefined, selected: string | null = null, ticket = 0
  let thumbnailController: AbortController | undefined, captureController: AbortController | undefined
  const backdrop = createBackdrop(preview, signal, media.backgroundBlob, next => { state = next; drawControls() })
  async function selectSource(key: SourceGroup) {
    if (locked()) return
    const generation = ++sourceTicket, config = current()
    browse = key
    if (key === 'still' || key === 'video') {
      render(config, false, shown)
      if (sourceGroup(config.source) === key) return
      const kind = key === 'still' ? 'image' : 'video'
      try {
        const rows = await media.list(kind)
        if (signal.aborted || locked() || !shown || sourceTicket !== generation || browse !== key || !equal(config.source, current().source)) return
        const row = rows.find(row => row.id === remembered[kind]) ?? rows[0]
        if (row) library.apply(row)
      } catch { if (!signal.aborted && sourceTicket === generation) toast('storageError') }
      return
    }
    edit({ source: key === 'rotation' ? { kind: key, poolId: config.rotation.poolId } : config.source.kind === key ? config.source : readSource({ kind: key }),
      activeProfile: null, ...(key !== 'none' ? { respectReducedTransparency: false } : {}) })
    commit(); render(current(), locked(), shown)
  }
  function resolve(config: ThemeConfig): ThemeConfig {
    if (config.source.kind !== 'rotation') return config
    const id = selected && config.rotation.items.includes(selected) ? selected : config.rotation.items[0]
    return { ...config, source: id ? { kind: 'local-image', id } : { kind: 'none' } }
  }
  function changeGenerator(patch: Record<string, string | number>, save = false) {
    const source = current().source
    if ('seed' in source) edit({ source: readSource({ ...source, ...patch }), activeProfile: null })
    if (save) commit()
  }
  const framingKey = () => current().source.kind === 'local-video' ? 'videoPlacement' : 'placement'
  function changePlacement(patch: Partial<Placement>, save = false) {
    if (!gesture()) return
    const key = framingKey()
    edit({ [key]: { ...current()[key], ...patch }, activeProfile: null })
    if (save) commit()
  }
  function changePool(patch: Partial<ThemeConfig['rotation']>) { edit({ rotation: { ...current().rotation, ...patch } }); commit() }
  async function resetBackground() {
    if (!await ui.confirm('resetBackdrop', 'resetPrompt') || locked() || signal.aborted) return
    browse = undefined; editingUrl = false; urlError.hidden = true
    edit({ source: DEFAULT.source, placement: DEFAULT.placement, videoPlacement: DEFAULT.videoPlacement,
      regenerateOnReload: DEFAULT.regenerateOnReload, opacity: DEFAULT.opacity, blur: DEFAULT.blur, activeProfile: null })
    commit(); render(current(), locked(), shown)
  }
  async function rotate(action: RotationAction) {
    if (action !== 'read' && locked()) return
    const pool = current().rotation, generation = ++ticket
    try {
      const { state, changed } = await media.rotate(pool, action)
      if (signal.aborted) return
      if (changed) publishRotation(pool.poolId)
      if (generation !== ticket || pool.poolId !== current().rotation.poolId) return
      selected = state.current
      render(current(), locked(), shown)
    } catch { if (!signal.aborted && action !== 'read') toast('storageError') }
  }
  function drawControls() {
    const config = current(), source = config.source
    const motion = 'seed' in source || source.kind === 'local-video' || 'animatedImage' in state
    text(pause, paused ? 'resume' : 'pause')
    pause.hidden = !motion; pause.setAttribute('aria-pressed', String(paused))
    reset.hidden = !isPhoto(source) || !!browse && browse !== sourceGroup(source); reset.disabled = locked()
    const message = state.state === 'loading' ? 'loadingImage' : state.state === 'fallback' ? state.effect === 'mesh' ? 'fallbackMesh' : 'fallbackGradient' :
      state.state === 'unavailable' ? ({ 'missing-local': 'missing', image: 'imageError', video: 'videoError', storage: 'storageError' } as const)[state.reason] : undefined
    if (message) text(output, message)
    else { output.textContent = ''; delete output.dataset.tbText }
    retry.hidden = state.state !== 'unavailable'
    link.hidden = state.state !== 'unavailable' || state.reason !== 'missing-local'; link.disabled = locked()
    preview.dataset.tbState = state.state
  }
  function drawPool(pool: ThemeConfig['rotation']) {
    const images = library.rows.filter(row => row.kind === 'image' && pool.items.includes(row.id))
    const key = JSON.stringify([pool.items, images, library.loaded])
    if (renderedPool !== key) {
      renderedPool = key
      thumbnailController?.abort()
      const thumbnailsSignal = (thumbnailController = new AbortController()).signal
      preserveFocus(thumbnails, () => {
        thumbnails.replaceChildren()
        if (!pool.items.length) text(make('p', thumbnails, 'tb-hint'), 'emptyPool')
        for (const [index, id] of pool.items.entries()) {
          const row = images.find(row => row.id === id)
          const tile = make('div', thumbnails, 'tb-pool-tile')
          tile.dataset.tbId = id
          const select = button(tile, 'apply', () => {
            if (locked()) return
            const rotation = current().rotation
            edit({ source: { kind: 'rotation', poolId: rotation.poolId }, respectReducedTransparency: false, activeProfile: null })
            commit(); void rotate({ select: id })
          })
          select.dataset.tbFocus = `${id}-select`
          if (row) {
            const photo = make('img'); photo.alt = ''
            select.prepend(photo)
            const caption = make('span', select); caption.textContent = row.name
            delete select.dataset.tbText
            select.childNodes[1]?.remove()
            void thumbnail(photo, id, thumbnailsSignal)
          } else text(select, library.loaded ? 'missing' : 'apply').append(` ${index + 1}`)
          const actions = make('div', tile, 'tb-actions')
          if (!row && library.loaded) button(actions, 'associate', () => library.link({ kind: 'image', id })).dataset.tbFocus = `${id}-link`
          button(actions, 'remove', () => changePool({ items: current().rotation.items.filter(item => item !== id) })).dataset.tbFocus = `${id}-remove`
        }
      })
    }
    const active = selected && pool.items.includes(selected) ? selected : pool.items[0]
    for (const tile of thumbnails.querySelectorAll<HTMLElement>('[data-tb-id]')) tile.querySelector('button')?.setAttribute('aria-pressed', String(tile.dataset.tbId === active))
  }
  async function thumbnail(node: HTMLImageElement, id: string, lifetime: AbortSignal) {
    try {
      const blob = await media.backgroundBlob(id, 'image')
      if (!blob || lifetime.aborted || signal.aborted) return
      const url = URL.createObjectURL(blob)
      const release = () => { node.removeAttribute('src'); URL.revokeObjectURL(url) }
      lifetime.addEventListener('abort', release, { once: true })
      node.src = url
    } catch { /* File metadata is still useful. */ }
  }
  const pointers = new Map<number, { x: number; y: number }>()
  const gesture = () => !locked() && isPhoto(current().source) && (!browse || browse === sourceGroup(current().source))
  const zoomBy = (amount: number) => changePlacement({ zoom: clamp(current()[framingKey()].zoom * amount, 0.25, 4) })
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
  on(preview, 'wheel', event => {
    if (!gesture()) return
    event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.05 : 1 / 1.05)
  }, { passive: false })
  on(preview, 'pointerdown', event => {
    if (!gesture() || event.button !== 0 || pointers.size >= 2) return
    preview.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  })
  on(preview, 'pointermove', event => {
    const before = pointers.get(event.pointerId)
    if (!before || !gesture()) return
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1]
    const now = { x: event.clientX, y: event.clientY }
    pointers.set(event.pointerId, now)
    if (other) { const base = distance(before, other); if (base > 0) zoomBy(distance(now, other) / base) }
    else { const next = backdrop.pan(now.x - before.x, now.y - before.y); if (next) changePlacement(next) }
  })
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) on(preview, event, e => {
    if (pointers.delete(e.pointerId)) commit()
  })
  function render(config: ThemeConfig, readOnly: boolean, visible: boolean) {
    if (shown && !visible) sourceTicket++
    shown = visible
    const source = config.source
    if (!equal(previousSource, source)) { browse = undefined; previousSource = source; sourceTicket++ }
    const applied = sourceGroup(source), group = browse ?? applied
    if (source.kind === 'local-image' || source.kind === 'local-video') remembered[source.kind === 'local-image' ? 'image' : 'video'] = source.id
    stillInUse.hidden = group === applied
    if (!stillInUse.hidden) stillInUse.textContent = ui.t('stillInUse').replace('{source}', ui.t(applied))
    fields.disabled = readOnly
    sources.set(group)
    image.hidden = group !== 'still'; video.hidden = group !== 'video'; poolCard.hidden = group !== 'rotation'
    if (!editingUrl) value(url, source.kind === 'url' ? source.url : '')
    generator.hidden = !['mesh', 'shader', 'pattern'].includes(group)
    shaders.group.hidden = group !== 'shader'; patterns.group.hidden = group !== 'pattern'
    intensity.row.hidden = group !== 'mesh'; speed.row.hidden = group !== 'shader'; density.row.hidden = group !== 'pattern'
    if ('seed' in source) {
      if (!seed.matches(':focus') || !seed.value) value(seed, String(source.seed))
      scale.set(source.scale)
      if (source.kind === 'mesh') intensity.set(source.intensity)
      if (source.kind === 'shader') { speed.set(source.speed); shaders.set(source.preset) }
      if (source.kind === 'pattern') { density.set(source.density); patterns.set(source.preset) }
    }
    regenerate.checked = config.regenerateOnReload
    const place = config[framingKey()]
    placement.hidden = group !== applied || !isPhoto(source)
    modes.set(place.mode); zoom.set(place.zoom); panX.set(place.panX); panY.set(place.panY)
    opacity.set(config.opacity); blur.set(config.blur)
    preview.classList.toggle('tb-gestures', gesture() && (sourceGroup(source) === group))
    order.value = config.rotation.mode; interval.value = config.rotation.interval; nextImage.disabled = !config.rotation.items.length
    if (group === 'rotation' && visible) {
      if (poolId !== config.rotation.poolId) { poolId = config.rotation.poolId; selected = null }
      if (!equal(lastPool, config.rotation)) { lastPool = config.rotation; void rotate('read') }
      drawPool(config.rotation)
    } else if (renderedPool) {
      ticket++; lastPool = undefined; renderedPool = ''; thumbnailController?.abort(); thumbnails.replaceChildren()
    }
    backdrop.setVisible(visible)
    backdrop.update(readOnly ? DEFAULT : resolve(config))
    drawControls()
  }
  async function capturePreview(scene: BackdropScene, lifetime: AbortSignal, cors: boolean, width = 480, height = 270) {
    if (lifetime.aborted) return undefined
    const slot = make('div', panel.parentElement!, 'tb-capture'), renderJob = new AbortController()
    const captureSignal = AbortSignal.any([lifetime, renderJob.signal])
    slot.style.width = `${width}px`; slot.style.height = `${height}px`
    slot.setAttribute('aria-hidden', 'true')
    try {
      return await new Promise<HTMLCanvasElement | undefined>(resolve => {
        const timeout = setTimeout(() => renderJob.abort(), 8000)
        const finish = (frame?: HTMLCanvasElement) => { clearTimeout(timeout); resolve(frame) }
        captureSignal.addEventListener('abort', () => finish(), { once: true })
        const renderer = createBackdrop(slot, captureSignal, media.backgroundBlob, state => {
          if (state.state === 'unavailable' || state.state === 'idle') finish()
          if (state.state === 'ready' || state.state === 'fallback') {
            try { finish(renderer.snapshot()) } catch { finish() }
          }
        }, { cors })
        renderer.pause(); renderer.update({ ...DEFAULT, ...scene, blur: 0, opacity: 100 })
      })
    } finally { renderJob.abort(); slot.remove() }
  }
  async function capture(): Promise<ColorSample> {
    captureController?.abort()
    const job = captureController = new AbortController()
    const failed = { error: 'sampleError' } as const
    const blocked = { error: 'sampleCors' } as const
    function readable(frame: HTMLCanvasElement | undefined) {
      if (!frame) return false
      try { return !!frame.getContext('2d')?.getImageData(0, 0, 1, 1) }
      catch (error) {
        if (error instanceof DOMException && error.name === 'SecurityError') return false
        throw error
      }
    }
    try {
      const live = renderedFrame(ui.doc)
      if (live?.frame && readable(live.frame)) return { frame: live.frame, preview: false }
      let scene = live?.scene
      if (!scene) {
        const effective = effectiveConfig()
        scene = effective
        if (effective.source.kind === 'rotation') {
          const { state } = await media.rotate(effective.rotation, 'read')
          scene = { ...effective, source: state.current ? { kind: 'local-image', id: state.current } : { kind: 'none' } }
        }
      }
      if (job.signal.aborted || scene.source.kind === 'none' || !scene.opacity) return failed
      const remote = scene.source.kind === 'url'
      const frame = await capturePreview(scene, job.signal, remote, live?.width, live?.height)
      if (frame && readable(frame)) return { frame, preview: true }
      if (!remote || job.signal.aborted) return failed
      if (live?.frame) return blocked
      const displayOnly = await capturePreview(scene, job.signal, false, live?.width, live?.height)
      return displayOnly ? readable(displayOnly) ? { frame: displayOnly, preview: true } : blocked : failed
    } finally { job.abort() }
  }
  signal.addEventListener('abort', () => { thumbnailController?.abort(); captureController?.abort() }, { once: true })
  return {
    render, capture,
    retry(id?: string) {
      const source = resolve(current()).source
      if (id === undefined || ('id' in source && source.id === id)) backdrop.retry()
    },
    syncRotation(id: string) { if (id === current().rotation.poolId) void rotate('read') },
  }
}
