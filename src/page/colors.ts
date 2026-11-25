import { clamp, HEX, SCHEMES } from '../shared/config.ts'
import type { Appearance } from '../shared/config.ts'
import { analyzeFrameDark, extractWallpaperColor, hexToRgb, hslToHsv, hslToRgb, hsvToHsl, rgbToHex, rgbToHsl } from '../shared/palette.ts'
import type { Ui } from './ui.ts'
import type { ColorSample } from './background.ts'
import type { Key } from './i18n.ts'

const FALLBACK = '#6879ed', SIZE = 256, CENTER = SIZE / 2, OUTER = 120, INNER = 97, HALF = 65
const TAU = Math.PI * 2
const colorOf = (h: number, s: number, v: number) => rgbToHex(hslToRgb(...hsvToHsl(h, s, v)))

export function colorsPage(ui: Ui, panel: HTMLElement, edit: (changes: Partial<Appearance>) => void,
  locked: () => boolean, save: () => void, frame: () => Promise<ColorSample>, toast: (key: Key) => void) {
  const { make, text, button, input, on, value, label, slider, choices } = ui
  const fields = make('fieldset', panel, 'tb-card tb-color-card')
  const graphics = make('div', fields, 'tb-color-graphics')
  const wheel = make('canvas', graphics, 'tb-wheel')
  wheel.width = wheel.height = SIZE * 2
  wheel.setAttribute('role', 'img'); label(wheel, 'wheel')
  const ctx = wheel.getContext('2d')
  const ring = make('canvas')
  ring.width = ring.height = SIZE * 2
  const ringCtx = ring.getContext('2d')
  if (ringCtx) {
    ringCtx.scale(2, 2)
    ringCtx.lineWidth = OUTER - INNER
    for (let i = 0; i < 360; i++) {
      ringCtx.strokeStyle = `hsl(${i} 100% 50%)`
      ringCtx.beginPath(); ringCtx.arc(CENTER, CENTER, (OUTER + INNER) / 2, i * TAU / 360, (i + 1.5) * TAU / 360); ringCtx.stroke()
    }
  }
  ctx?.scale(2, 2)
  const controls = make('div', fields, 'tb-color-controls')
  const sample = make('div', controls, 'tb-orb-row')
  make('div', sample, 'tb-orb').setAttribute('aria-hidden', 'true')
  const name = make('div', sample)
  text(make('strong', name), 'accentPreview')
  const colorCode = make('div', name, 'tb-code')
  const hex = input(controls, 'hex', 'text'), rgb = input(controls, 'rgb', 'text'), hsl = input(controls, 'hsl', 'text')
  for (const node of [hex, rgb, hsl]) { node.spellcheck = false; node.autocomplete = 'off'; node.maxLength = 48; node.classList.add('tb-code') }
  const invalid = text(make('p', controls, 'tb-error'), 'colorError')
  invalid.setAttribute('role', 'alert'); invalid.hidden = true
  const axes = [slider(controls, 'hue', 0, 360, 1, h => set(h, hsv[1], hsv[2])),
    slider(controls, 'saturation', 0, 100, 1, s => set(hsv[0], s / 100, hsv[2])),
    slider(controls, 'value', 0, 100, 1, v => set(hsv[0], hsv[1], v / 100))]
  const modes = choices(controls, 'scheme', SCHEMES, schemeOverride => { edit({ schemeOverride }); save() })
  text(make('p', controls, 'tb-hint'), 'autoHint')
  const actions = make('div', controls, 'tb-actions')
  const extract = button(actions, 'extract', () => void read(false), 'tb-primary')
  const pick = button(actions, 'eyedropper', () => void read(true))
  button(actions, 'restoreColor', () => { edit({ accent: null, schemeOverride: 'auto' }); save() })
  const status = make('p', controls, 'tb-hint')
  status.setAttribute('aria-live', 'polite')
  let hsv: [number, number, number] = [237, 0.5, 0.9], last: string | null | undefined, working = false
  let pointer: { id: number; zone: 'hue' | 'square' } | undefined
  function marker(x: number, y: number) {
    if (!ctx) return
    ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU)
    ctx.strokeStyle = '#121218'; ctx.lineWidth = 4; ctx.stroke()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
  }
  function paint() {
    if (!ctx) return
    const [h, s, v] = hsv, x = CENTER - HALF, y = x
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.drawImage(ring, 0, 0, SIZE, SIZE)
    const saturation = ctx.createLinearGradient(x, 0, x + 2 * HALF, 0)
    saturation.addColorStop(0, '#fff'); saturation.addColorStop(1, `hsl(${h} 100% 50%)`)
    ctx.fillStyle = saturation; ctx.fillRect(x, y, 2 * HALF, 2 * HALF)
    const brightness = ctx.createLinearGradient(0, y, 0, y + 2 * HALF)
    brightness.addColorStop(0, 'transparent'); brightness.addColorStop(1, '#000')
    ctx.fillStyle = brightness; ctx.fillRect(x, y, 2 * HALF, 2 * HALF)
    const a = h * TAU / 360, r = (OUTER + INNER) / 2
    marker(CENTER + r * Math.cos(a), CENTER + r * Math.sin(a))
    marker(x + 2 * HALF * s, y + 2 * HALF * (1 - v))
  }
  const coords = (event: PointerEvent) => {
    const bounds = wheel.getBoundingClientRect()
    return [(event.clientX - bounds.left) * SIZE / bounds.width - CENTER, (event.clientY - bounds.top) * SIZE / bounds.height - CENTER]
  }
  function drag(x: number, y: number, zone: 'hue' | 'square') {
    if (zone === 'hue') set((Math.atan2(y, x) * 360 / TAU + 360) % 360, hsv[1], hsv[2])
    else set(hsv[0], clamp((x + HALF) / (2 * HALF), 0, 1), clamp((HALF - y) / (2 * HALF), 0, 1))
  }
  on(wheel, 'pointerdown', event => {
    if (locked() || event.button !== 0 || pointer) return
    const [x, y] = coords(event), r = Math.hypot(x, y)
    const zone = Math.abs(x) <= HALF + 4 && Math.abs(y) <= HALF + 4 ? 'square' : r >= INNER - 4 && r <= OUTER + 4 ? 'hue' : undefined
    if (!zone) return
    wheel.setPointerCapture(event.pointerId)
    pointer = { id: event.pointerId, zone }; drag(x, y, zone)
  })
  on(wheel, 'pointermove', event => { if (!locked() && pointer?.id === event.pointerId) drag(...coords(event) as [number, number], pointer.zone) })
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) on(wheel, event, e => {
    if (pointer?.id === e.pointerId) { pointer = undefined; save() }
  })
  function set(h: number, s: number, v: number) {
    hsv = [h, s, v]
    last = colorOf(h, s, v)
    edit({ accent: last })
    paint()
  }
  function typed(node: HTMLInputElement) {
    const raw = node.value.trim(), parts = raw.split(/[\s,]+/).map(part => Number(part.replace(/%$/, '')))
    let next: string | undefined
    if (node === hex) next = HEX.test(raw) ? raw.toLowerCase() : undefined
    else if (parts.length === 3 && parts.every(Number.isFinite)) {
      if (node === rgb && parts.every(p => p >= 0 && p <= 255)) next = rgbToHex(parts)
      if (node === hsl && parts[0] >= 0 && parts[0] <= 360 && parts.slice(1).every(p => p >= 0 && p <= 100)) next = rgbToHex(hslToRgb(parts[0], parts[1] / 100, parts[2] / 100))
    }
    node.setAttribute('aria-invalid', String(!next))
    invalid.hidden = !!next
    if (next) edit({ accent: next })
  }
  for (const node of [hex, rgb, hsl]) {
    on(node, 'input', () => typed(node)); on(node, 'change', () => { typed(node); save() })
    on(node, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); typed(node); save() } })
  }
  async function read(eyedropper: boolean) {
    if (working || locked()) return
    working = true
    extract.setAttribute('aria-disabled', 'true'); pick.setAttribute('aria-disabled', 'true')
    text(status, 'sampling')
    try {
      const result = await frame()
      if (!panel.isConnected || panel.hidden || locked()) return
      if ('error' in result) { toast(result.error); return }
      const { frame: image, preview } = result
      if (eyedropper) {
        const color = await pickPixel(ui, image, preview)
        if (color && !locked()) { edit({ accent: color }); save() }
      } else {
        const color = extractWallpaperColor(image, ui.doc)
        if (!color) { toast('sampleError'); return }
        sample.dataset.tbFrame = analyzeFrameDark(image, ui.doc) === true ? 'dark' : 'light'
        edit({ accent: color }); save()
        if (preview) toast('samplePreview')
      }
    } catch { if (panel.isConnected && !panel.hidden) toast('sampleError') }
    finally {
      working = false
      extract.removeAttribute('aria-disabled'); pick.removeAttribute('aria-disabled')
      status.textContent = ''; delete status.dataset.tbText
    }
  }
  return (appearance: Appearance, readOnly: boolean) => {
    fields.disabled = readOnly
    const hexValue = appearance.accent ?? FALLBACK
    const channels = hexToRgb(hexValue), hslValue = rgbToHsl(...channels)
    if (appearance.accent !== last) { last = appearance.accent; hsv = hslToHsv(...hslValue); paint() }
    sample.style.setProperty('--tb-swatch', appearance.accent ?? 'var(--cx-page-accent)')
    colorCode.textContent = appearance.accent ?? ui.t('restoreColor')
    if (!hex.matches(':focus')) value(hex, hexValue.toUpperCase())
    if (!rgb.matches(':focus')) value(rgb, channels.join(', '))
    if (!hsl.matches(':focus')) value(hsl, `${Math.round(hslValue[0])}, ${Math.round(hslValue[1] * 100)}%, ${Math.round(hslValue[2] * 100)}%`)
    axes.forEach((axis, index) => axis.set(Math.round(hsv[index] * (index ? 100 : 1))))
    modes.set(appearance.schemeOverride)
  }
}

async function pickPixel(ui: Ui, image: HTMLCanvasElement, preview: boolean) {
  const ctx = image.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined
  const { width, height } = image, { make, label, text, button } = ui
  let x = Math.floor(width / 2), y = Math.floor(height / 2), color: string | undefined
  const pixels = ctx.getImageData(0, 0, width, height).data
  await ui.dialog('eyedropper', (panel, finish) => {
    if (preview) text(make('p', panel, 'tb-hint'), 'samplePreview')
    text(make('p', panel, 'tb-hint'), 'sampleHint')
    const stage = make('div', panel, 'tb-pixel-stage')
    stage.append(image)
    image.tabIndex = 0; image.setAttribute('role', 'button'); label(image, 'pixel')
    const lens = make('canvas', stage, 'tb-lens'), lensCtx = lens.getContext('2d')
    lens.width = lens.height = 112
    const readout = make('output', panel, 'tb-code')
    function move(nextX: number, nextY: number) {
      x = clamp(Math.floor(nextX), 0, width - 1); y = clamp(Math.floor(nextY), 0, height - 1)
      const i = (y * width + x) * 4
      readout.value = rgbToHex([pixels[i], pixels[i + 1], pixels[i + 2]]).toUpperCase()
      if (!lensCtx) return
      lensCtx.clearRect(0, 0, 112, 112); lensCtx.imageSmoothingEnabled = false
      lensCtx.drawImage(image, x - 3, y - 3, 7, 7, 0, 0, 112, 112)
      lensCtx.strokeStyle = '#000'; lensCtx.lineWidth = 4; lensCtx.strokeRect(48, 48, 16, 16)
      lensCtx.strokeStyle = '#fff'; lensCtx.lineWidth = 2; lensCtx.strokeRect(48, 48, 16, 16)
    }
    function locate(event: MouseEvent) {
      const box = image.getBoundingClientRect()
      move((event.clientX - box.left) * width / box.width, (event.clientY - box.top) * height / box.height)
    }
    const choose = () => { color = readout.value.toLowerCase(); finish(true) }
    image.addEventListener('pointermove', locate)
    image.addEventListener('click', event => { locate(event); choose() })
    image.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); return }
      const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
      if (offset) { event.preventDefault(); move(x + offset[0], y + offset[1]) }
    })
    const actions = make('div', panel, 'tb-actions')
    button(actions, 'cancel', () => finish(false)); button(actions, 'apply', choose, 'tb-primary')
    move(x, y)
    return image
  })
  return color
}
