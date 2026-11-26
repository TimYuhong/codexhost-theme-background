import { ANIMATED_PRESETS, clamp, PRESET_ASSET_PATH } from '../shared/config.ts'
import type { Placement, ThemeConfig } from '../shared/config.ts'
import { pixelsDark } from '../shared/palette.ts'
import { loadVideoFrame, prepareVideo, releaseVideo } from '../shared/video.ts'
import { canvasGenerator, fallbackGradient, shaderGenerator } from './generators.ts'
import type { GeneratorSource } from './generators.ts'

type FrameState = { frameDark: boolean | null; animatedImage?: true }
export type RenderState =
  | { state: 'idle' | 'loading' }
  | ({ state: 'ready' } & FrameState)
  | ({ state: 'fallback'; effect: 'mesh' | 'gradient' } & FrameState)
  | { state: 'unavailable'; reason: 'missing-local' | 'image' | 'video' | 'storage' }
export type BackdropScene = Pick<ThemeConfig, 'source' | 'placement' | 'videoPlacement' | 'opacity' | 'blur'>
type FrameRequest = { scene?: BackdropScene; frame?: HTMLCanvasElement; width?: number; height?: number }
const FRAME_EVENT = 'theme-background:sample-frame'
export function renderedFrame(doc: Document) {
  for (const layer of doc.querySelectorAll('.tb-web-layer, .tb-desktop-layer')) {
    const detail: FrameRequest = {}
    layer.dispatchEvent(new CustomEvent(FRAME_EVENT, { detail }))
    if (detail.scene) return detail
  }
  return undefined
}
export type Backdrop = {
  update(config: ThemeConfig): void
  setVisible(visible: boolean): void
  pause(): void
  resume(): void
  snapshot(): HTMLCanvasElement | undefined
  retry(): void
  pan(dx: number, dy: number): Placement | undefined
  dispose(): void
}

export function imageGeometry(w: number, h: number, iw: number, ih: number, p: Placement) {
  if (!(w > 0 && h > 0 && iw > 0 && ih > 0)) return undefined
  const scale = p.mode === 'fit' ? Math.min(w / iw, h / ih) : p.mode === 'fill' ? Math.max(w / iw, h / ih) : 1
  const dw = (p.mode === 'stretch' ? w : iw * scale) * p.zoom
  const dh = (p.mode === 'stretch' ? h : ih * scale) * p.zoom
  const tile = p.mode === 'tile'
  const spanX = tile ? dw : w - dw, spanY = tile ? dh : h - dh
  return { dw, dh, x: spanX * (p.panX - (tile ? 0.5 : 0)), y: spanY * (p.panY - (tile ? 0.5 : 0)), spanX, spanY }
}

type Geometry = NonNullable<ReturnType<typeof imageGeometry>>
function imageStrips(start: number, length: number, view: number, intrinsic: number, pad: number) {
  const result = [{ src: 0, size: intrinsic, dst: start, length }]
  const end = start + length
  if (pad && start <= 0 && end > 0 && start > -pad) result.push({ src: 0, size: 1, dst: -pad, length: start + pad })
  if (pad && end >= view && start < view && end < view + pad) result.push({ src: intrinsic - 1, size: 1, dst: end, length: view + pad - end })
  return result
}

function drawImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement | HTMLVideoElement, iw: number, ih: number, g: Geometry, w: number, h: number, pad: number, tile: boolean) {
  const { x, y, dw, dh } = g
  if (tile) {
    const pattern = ctx.createPattern(image, 'repeat')
    if (!pattern) throw new Error('Cannot tile image')
    pattern.setTransform(new DOMMatrix([dw / iw, 0, 0, dh / ih, x, y]))
    ctx.fillStyle = pattern
    ctx.fillRect(-pad, -pad, w + 2 * pad, h + 2 * pad)
    return
  }
  ctx.drawImage(image, x, y, dw, dh)
  if (!pad) return
  const xs = imageStrips(x, dw, w, iw, pad), ys = imageStrips(y, dh, h, ih, pad)
  for (const a of xs) for (const b of ys) {
    if (a === xs[0] && b === ys[0]) continue
    ctx.drawImage(image, a.src, b.src, a.size, b.size, a.dst, b.dst, a.length, b.length)
  }
}

export function createBackdrop(container: HTMLElement, signal: AbortSignal,
  loadBlob: (id: string, kind: 'image' | 'video', mime?: string) => Promise<Blob | undefined>, onState: (state: RenderState) => void,
  { cors = false, baseColor, loadAsset }: { cors?: boolean; baseColor?: () => string; loadAsset?: (path: string) => Promise<string | undefined> } = {}): Backdrop {
  const doc = container.ownerDocument, win = doc.defaultView!
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)')
  let active = !signal.aborted, visible = true, paused = false, generation = 0, key: string | undefined, config: ThemeConfig | undefined
  let width = container.clientWidth, height = container.clientHeight, needsDraw = true
  let frame = 0, lastFrame = -Infinity, raf: number | undefined, animated = false
  let image: HTMLImageElement | undefined, video: HTMLVideoElement | undefined, url: string | undefined
  let imageReady = false, animatedImage = false, nativeImage: HTMLElement | undefined
  const edges: { clip: HTMLElement; image: HTMLImageElement }[] = []
  let videoReady = false, wantsPlayback = false, videoLoad: AbortController | undefined
  let node: HTMLElement | undefined, paint: (() => void) | undefined, dropGraphics: (() => void) | undefined
  let reported: RenderState | undefined, fallback: 'mesh' | 'gradient' | undefined
  let sampled = false, frameDark: boolean | null = null, lastStyleSig = ''
  const samePlacement = (a: Placement | undefined, b: Placement) =>
    !!a && a.mode === b.mode && a.zoom === b.zoom && a.panX === b.panX && a.panY === b.panY
  const alive = (id: number) => active && !signal.aborted && container.isConnected && id === generation
  function report(state: RenderState) {
    if (!active || JSON.stringify(reported) === JSON.stringify(state)) return
    reported = state
    onState(state)
  }
  function cancelFrame() { if (raf !== undefined) win.cancelAnimationFrame(raf); raf = undefined }
  function releaseMedia() {
    image?.removeAttribute('src')
    image = undefined
    imageReady = animatedImage = false
    videoLoad?.abort()
    videoLoad = undefined
    if (video) { releaseVideo(video); video.remove(); video = undefined }
    videoReady = wantsPlayback = false
    if (url !== undefined) { URL.revokeObjectURL(url); url = undefined }
  }
  function releaseGraphics() {
    cancelFrame()
    dropGraphics?.()
    dropGraphics = undefined
    paint = undefined
    if (nativeImage) {
      image?.remove()
      for (const edge of edges.splice(0)) edge.image.removeAttribute('src')
      nativeImage = undefined
    }
    node?.remove()
    node = undefined
    lastStyleSig = ''
    needsDraw = true
    animated = false
  }
  function reset() {
    generation++
    releaseGraphics()
    releaseMedia()
    fallback = undefined
    sampled = false
    frameDark = null
    needsDraw = true
    frame = 0
    lastFrame = -Infinity
  }
  function attach(el: HTMLElement) {
    node = el
    el.style.position = 'absolute'
    el.style.pointerEvents = 'none'
    container.append(el)
  }
  function styleNode() {
    if (!node || !config) return
    const bg = baseColor ? baseColor() : ''
    const isVideoNode = node === video
    const sig = `${bg}|${config.opacity}|${isVideoNode ? 'v' : `${config.blur}|${width}|${height}`}`
    if (sig === lastStyleSig) return
    lastStyleSig = sig
    if (baseColor) container.style.backgroundColor = bg
    node.style.opacity = String(config.opacity / 100)
    if (isVideoNode) return
    const pad = config.blur * 3
    node.style.inset = `${-pad}px`
    node.style.width = `${width + 2 * pad}px`
    node.style.height = `${height + 2 * pad}px`
    node.style.filter = config.blur ? `blur(${config.blur}px)` : ''
  }
  function sizeCanvas(canvas: HTMLCanvasElement, pad: number, photo: boolean) {
    const w = width + 2 * pad, h = height + 2 * pad
    const ratio = Math.min(photo ? Math.min(win.devicePixelRatio, 2) : 0.55 * Math.min(win.devicePixelRatio, 1.5), 2048 / Math.max(w, h))
    const bw = Math.max(1, Math.round(w * ratio)), bh = Math.max(1, Math.round(h * ratio))
    if (canvas.width !== bw) canvas.width = bw
    if (canvas.height !== bh) canvas.height = bh
    return { sx: bw / w, sy: bh / h }
  }
  function unavailable(reason: Extract<RenderState, { state: 'unavailable' }>['reason']) {
    reset()
    report({ state: 'unavailable', reason })
  }
  function targetPlacement() { return config!.source.kind === 'local-video' ? config!.videoPlacement : config!.placement }
  function setupRaster(decoded: HTMLImageElement | HTMLVideoElement, iw: number, ih: number, isVideo: boolean) {
    const canvas = doc.createElement('canvas'), ctx = canvas.getContext('2d')
    if (!ctx) { unavailable(isVideo ? 'video' : 'image'); return }
    attach(canvas)
    animated = isVideo
    paint = () => {
      const placement = targetPlacement(), pad = 3 * config!.blur
      const { sx, sy } = sizeCanvas(canvas, pad, true)
      ctx.setTransform(sx, 0, 0, sy, pad * sx, pad * sy)
      ctx.clearRect(-pad, -pad, width + 2 * pad, height + 2 * pad)
      drawImage(ctx, decoded, iw, ih, imageGeometry(width, height, iw, ih, placement)!, width, height, pad, placement.mode === 'tile')
    }
  }
  function setupNativeImage(decoded: HTMLImageElement) {
    const board = nativeImage = doc.createElement('div')
    board.style.overflow = 'hidden'
    decoded.alt = ''
    board.append(decoded)
    attach(board)
    function place(el: HTMLElement, x: number, y: number, w: number, h: number) {
      Object.assign(el.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, maxWidth: 'none', maxHeight: 'none' })
    }
    paint = () => {
      const iw = decoded.naturalWidth, ih = decoded.naturalHeight, pad = 3 * config!.blur
      const { x, y, dw, dh } = imageGeometry(width, height, iw, ih, targetPlacement())!
      place(decoded, x + pad, y + pad, dw, dh)
      const xs = imageStrips(x, dw, width, iw, pad), ys = imageStrips(y, dh, height, ih, pad)
      let index = 0
      // Clip stretched copies to the outer strips so the browser keeps animating the edge pixels with the image.
      for (const a of xs) for (const b of ys) {
        if (a === xs[0] && b === ys[0]) continue
        if (!edges[index]) {
          const clip = doc.createElement('div'), copy = doc.createElement('img')
          clip.style.overflow = 'hidden'
          copy.alt = ''
          copy.referrerPolicy = decoded.referrerPolicy
          copy.crossOrigin = decoded.crossOrigin
          copy.src = decoded.src
          clip.append(copy)
          board.append(clip)
          edges.push({ clip, image: copy })
        }
        const edge = edges[index++], sx = a.length / a.size, sy = b.length / b.size
        edge.clip.hidden = false
        place(edge.clip, a.dst + pad, b.dst + pad, a.length, b.length)
        place(edge.image, -a.src * sx, -b.src * sy, iw * sx, ih * sy)
      }
      for (; index < edges.length; index++) edges[index].clip.hidden = true
    }
  }
  function setupVideo(decoded: HTMLVideoElement) {
    const iw = decoded.videoWidth, ih = decoded.videoHeight
    if (videoComposite(config!)) {
      decoded.hidden = true
      if (!decoded.parentElement) container.append(decoded)
      setupRaster(decoded, iw, ih, true)
      return
    }
    decoded.style.objectFit = 'fill'
    attach(decoded)
    paint = () => {
      const { x, y, dw, dh } = imageGeometry(width, height, iw, ih, targetPlacement())!
      Object.assign(decoded.style, { left: `${x}px`, top: `${y}px`, width: `${dw}px`, height: `${dh}px` })
    }
  }
  const videoComposite = (next: ThemeConfig) => !!next.blur || next.videoPlacement.mode === 'tile'
  async function load(id: number, source: Extract<ThemeConfig['source'], { kind: 'preset' | 'url' | 'local-image' | 'local-video' }>) {
    let src: string
    const isVideo = source.kind === 'local-video'
    if (source.kind === 'preset') {
      try {
        const resolved = await loadAsset?.(PRESET_ASSET_PATH(source.id))
        if (!alive(id)) return
        if (!resolved) { unavailable('image'); return }
        animatedImage = ANIMATED_PRESETS.has(source.id)
        src = resolved
      } catch { if (alive(id)) unavailable('image'); return }
    } else if (source.kind !== 'url') {
      try {
        const blob = await loadBlob(source.id, isVideo ? 'video' : 'image', isVideo ? source.mime : undefined)
        if (!alive(id)) return
        if (!blob) { unavailable('missing-local'); return }
        animatedImage = !isVideo && blob.type === 'image/gif'
        src = url = URL.createObjectURL(blob)
      } catch { if (alive(id)) unavailable('storage'); return }
    } else {
      src = source.url
      // Remote images have no trusted MIME here, so let the browser display animated formats natively.
      animatedImage = true
    }
    try {
      if (isVideo) {
        const decoded = video = prepareVideo(doc), abort = videoLoad = new AbortController()
        decoded.loop = true
        decoded.setAttribute('aria-hidden', 'true')
        await loadVideoFrame(decoded, src, abort.signal)
        if (!alive(id)) return
        videoReady = true
        const events = { signal: abort.signal }
        decoded.addEventListener('error', () => { if (alive(id)) unavailable('video') }, events)
        decoded.addEventListener('playing', schedule, events)
        decoded.addEventListener('seeked', () => { needsDraw = true; refresh() }, events)
      } else {
        const decoded = image = doc.createElement('img')
        decoded.referrerPolicy = 'no-referrer'
        if (cors && source.kind === 'url') decoded.crossOrigin = 'anonymous'
        decoded.src = src
        await decoded.decode()
        if (!alive(id)) return
        if (!decoded.naturalWidth || !decoded.naturalHeight) { unavailable('image'); return }
        imageReady = true
      }
      refresh()
    } catch { if (alive(id)) unavailable(isVideo ? 'video' : 'image') }
  }
  function setupGenerator(source: GeneratorSource, skipShader = false) {
    let canvas = doc.createElement('canvas')
    if (source.kind === 'shader' && !skipShader) {
      const id = generation
      const downgrade = () => {
        if (!alive(id) || node !== canvas) return
        generation++
        releaseGraphics()
        sampled = false
        frameDark = null
        fallback = 'mesh'
        needsDraw = true
        setupGenerator(source, true)
        refresh()
      }
      const shader = shaderGenerator(canvas, source, downgrade)
      if (shader) {
        attach(canvas)
        dropGraphics = shader.dispose
        animated = source.speed > 0
        paint = () => {
          const pad = 3 * config!.blur
          sizeCanvas(canvas, pad, false)
          if (!shader.draw(width, height, pad, frame)) downgrade()
        }
        return
      }
      canvas = doc.createElement('canvas')
      fallback = 'mesh'
    }
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      const gradient = doc.createElement('div')
      gradient.style.backgroundImage = fallbackGradient(source.seed)
      attach(gradient)
      fallback = 'gradient'
      paint = () => {}
      return
    }
    const draw = canvasGenerator(ctx, source.kind === 'shader' ? { kind: 'mesh', seed: source.seed, scale: source.scale, intensity: 0.6 } : source)
    attach(canvas)
    animated = source.kind !== 'shader' || source.speed > 0
    paint = () => {
      const pad = 3 * config!.blur
      const { sx, sy } = sizeCanvas(canvas, pad, false)
      ctx.setTransform(sx, 0, 0, sy, pad * sx, pad * sy)
      draw(width, height, pad, frame)
    }
  }
  const drawable = () => active && container.isConnected && visible && width > 0 && height > 0 && doc.visibilityState !== 'hidden' && !!config?.opacity
  function copyFrame(limit: number, base?: string) {
    if (!node || !config) return undefined
    const frame = doc.createElement('canvas')
    const ratio = Math.min(1, limit / Math.max(width, height))
    frame.width = Math.max(1, Math.round(width * ratio))
    frame.height = Math.max(1, Math.round(height * ratio))
    const ctx = frame.getContext('2d', { willReadFrequently: true })
    if (!ctx) return undefined
    if (base) {
      ctx.fillStyle = base
      ctx.fillRect(0, 0, frame.width, frame.height)
      ctx.globalAlpha = config.opacity / 100
    }
    const media = node === video && videoReady ? video : node === nativeImage ? image : undefined
    if (media) {
      const iw = media === video ? video.videoWidth : image!.naturalWidth
      const ih = media === video ? video.videoHeight : image!.naturalHeight
      const placement = targetPlacement()
      ctx.setTransform(frame.width / width, 0, 0, frame.height / height, 0, 0)
      drawImage(ctx, media, iw, ih, imageGeometry(width, height, iw, ih, placement)!, width, height, 0, false)
    } else if (node.tagName === 'CANVAS') {
      const canvas = node as HTMLCanvasElement, pad = config.blur * 3
      const sx = canvas.width / (width + 2 * pad), sy = canvas.height / (height + 2 * pad)
      ctx.drawImage(canvas, pad * sx, pad * sy, width * sx, height * sy, 0, 0, frame.width, frame.height)
    } else return undefined
    return { frame, ctx }
  }
  function draw() {
    if (!paint) return
    const id = generation, drawn = node
    try { paint() } catch { if (alive(id)) unavailable(video ? 'video' : 'image'); return }
    if (!alive(id) || node !== drawn) return
    if (!sampled && baseColor) {
      sampled = true
      // WebGL's default drawing buffer is only readable in the same paint stack.
      try {
        const sample = copyFrame(32, container.style.backgroundColor)
        if (sample) frameDark = pixelsDark(sample.ctx.getImageData(0, 0, sample.frame.width, sample.frame.height).data)
      } catch { frameDark = null }
    }
    const frameState: FrameState = animatedImage ? { frameDark, animatedImage: true } : { frameDark }
    report(fallback ? { state: 'fallback', effect: fallback, ...frameState } : { state: 'ready', ...frameState })
  }
  const playing = () => drawable() && !paused && !motion.matches
  function syncVideo() {
    const next = !!(videoReady && playing())
    if (!video || wantsPlayback === next) return
    wantsPlayback = next
    video.autoplay = next
    if (next) void video.play().catch(() => {})
    else video.pause()
  }
  function tick(now: number) {
    raf = undefined
    if (!playing() || !animated) return
    if (now - lastFrame >= 1000 / 30) { lastFrame = now; frame++; draw() }
    schedule()
  }
  function schedule() {
    if (playing() && animated && (!video || !video.paused) && raf === undefined) raf = win.requestAnimationFrame(tick)
  }
  function refresh() {
    if (!active) return
    if (!container.isConnected) {
      if (key !== undefined) { key = undefined; reset(); report({ state: 'idle' }) }
      return
    }
    if (!drawable() || !config) {
      syncVideo()
      cancelFrame()
      if (node) { node.hidden = true; node.style.display = 'none' }
      if ((!width || !height) && node) { needsDraw = true; report({ state: 'loading' }) }
      return
    }
    const useNativeImage = animatedImage && playing() && targetPlacement().mode !== 'tile'
    if (image && node && !!nativeImage !== useNativeImage) releaseGraphics()
    if (!node && reported?.state !== 'unavailable') {
      const { source } = config
      if (image && imageReady) {
        if (useNativeImage) setupNativeImage(image)
        else setupRaster(image, image.naturalWidth, image.naturalHeight, false)
      }
      else if (video && videoReady) setupVideo(video)
      else if (source.kind === 'mesh' || source.kind === 'shader' || source.kind === 'pattern') setupGenerator(source, fallback === 'mesh')
    }
    if (node) {
      node.hidden = false
      node.style.display = ''
      styleNode()
      if (needsDraw) { needsDraw = false; draw() }
    }
    syncVideo()
    if (!playing()) cancelFrame()
    else schedule()
  }
  const observer = new ResizeObserver(([entry]) => {
    if (!active) return
    width = entry.contentRect.width
    height = entry.contentRect.height
    needsDraw = true
    refresh()
  })
  function motionChanged() {
    if (motion.matches) {
      frame = 0
      if (videoReady && video) { video.currentTime = 0 }
      needsDraw = true
    }
    refresh()
  }
  function snapshot() {
    if (!drawable() || !node || needsDraw) return undefined
    if (dropGraphics) paint?.()
    return copyFrame(640, baseColor ? container.style.backgroundColor : undefined)?.frame
  }
  function sampleRequest(event: Event) {
    const request = (event as CustomEvent<FrameRequest>).detail
    if (!request || !drawable() || !config || config.source.kind === 'none') return
    const { source, opacity, blur, placement, videoPlacement } = config
    request.scene = { source, opacity, blur, placement, videoPlacement }
    request.width = width
    request.height = height
    try { request.frame = snapshot() } catch { /* Page can try a scoped preview. */ }
  }
  function dispose() {
    if (!active) return
    report({ state: 'idle' })
    active = false
    observer.disconnect()
    motion.removeEventListener('change', motionChanged)
    doc.removeEventListener('visibilitychange', refresh)
    if (baseColor) container.removeEventListener(FRAME_EVENT, sampleRequest)
    signal.removeEventListener('abort', dispose)
    reset()
    if (baseColor) container.style.backgroundColor = ''
  }
  if (active) {
    observer.observe(container)
    motion.addEventListener('change', motionChanged)
    doc.addEventListener('visibilitychange', refresh)
    if (baseColor) container.addEventListener(FRAME_EVENT, sampleRequest)
    signal.addEventListener('abort', dispose, { once: true })
  }
  function update(next: ThemeConfig) {
    if (!active || !container.isConnected) { refresh(); return }
    if (config?.blur !== next.blur || !samePlacement(config?.placement, next.placement) ||
      !samePlacement(config?.videoPlacement, next.videoPlacement)) needsDraw = true
    if (video && config && videoComposite(config) !== videoComposite(next)) releaseGraphics()
    config = next
    const source = next.source, nextKey = JSON.stringify(source)
    if (key !== nextKey) {
      key = nextKey
      reset()
      if (source.kind === 'none' || source.kind === 'rotation') report({ state: 'idle' })
      else {
        report({ state: 'loading' })
        if (source.kind === 'preset' || source.kind === 'local-image' || source.kind === 'url' || source.kind === 'local-video') void load(generation, source)
      }
    }
    refresh()
  }
  return {
    update,
    setVisible(next) { if (active && next !== visible) { visible = next; refresh() } },
    pause() { if (active && !paused) { paused = true; refresh() } },
    resume() { if (active && paused) { paused = false; refresh() } },
    snapshot,
    retry() { if (config && active) { key = undefined; update(config) } },
    pan(dx, dy) {
      if ((!image && !videoReady) || !config) return undefined
      const p = targetPlacement(), g = imageGeometry(width, height, image?.naturalWidth ?? video!.videoWidth, image?.naturalHeight ?? video!.videoHeight, p)
      if (!g) return undefined
      return { ...p, panX: g.spanX ? clamp(p.panX + dx / g.spanX, 0, 1) : p.panX, panY: g.spanY ? clamp(p.panY + dy / g.spanY, 0, 1) : p.panY }
    },
    dispose,
  }
}
