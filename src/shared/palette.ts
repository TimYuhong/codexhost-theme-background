import type { Scheme } from '../host-api.ts'
import { clamp, SURFACES } from './config.ts'
import type { Appearance, Surface } from './config.ts'

const bases = {
  light: { canvas: '#ffffff', surface: '#f5f6f8', sidebar: '#eef0f3', text: '#191b20', muted: '#424a58', border: '#c7cbd2', hover: '#e7e9ee' },
  dark: { canvas: '#202124', surface: '#292b2f', sidebar: '#24262a', text: '#f1f2f4', muted: '#c4c9d3', border: '#525762', hover: '#353941' },
}
export const nativeCanvas = (scheme: Scheme) => bases[scheme].canvas
export function desktopHostScheme(root: HTMLElement, osDark: boolean): Scheme {
  const theme = root.dataset.theme
  if (theme === 'dark' || theme === 'light') return theme
  if (root.classList.contains('dark')) return 'dark'
  if (root.classList.contains('light')) return 'light'
  // The extension sets color-scheme below <html>, so this reads the Host's own style.
  const native = root.ownerDocument.defaultView?.getComputedStyle(root).colorScheme.trim()
  return native === 'dark' || native === 'light' ? native : osDark ? 'dark' : 'light'
}
export type SemanticPalette = (typeof bases)[Scheme] & { accent: string; onAccent: string }
export type { Scheme } from '../host-api.ts'
export const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number]
export const rgbToHex = (rgb: number[]) => '#' + rgb.map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('')
function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(value => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
export function paletteFor(hex: string, scheme: Scheme): SemanticPalette {
  const base = bases[scheme], original = hexToRgb(hex), text = hexToRgb(base.text)
  let accent = hex
  for (let step = 0; step <= 20; step++) {
    accent = rgbToHex(original.map((value, i) => value + (text[i] - value) * step / 20))
    if (contrast(accent, base.canvas) >= 4.5 && contrast(accent, base.surface) >= 4.5) break
  }
  return { ...base, accent, onAccent: contrast(accent, '#000000') >= contrast(accent, '#ffffff') ? '#000000' : '#ffffff' }
}
export function hsvToHsl(h: number, s: number, v: number): [number, number, number] {
  const l = v * (1 - s / 2)
  return [h, l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l]
}
export function hslToHsv(h: number, s: number, l: number): [number, number, number] {
  const v = l + s * Math.min(l, 1 - l)
  return [h, v === 0 ? 0 : 2 * (1 - l / v), v]
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + (((h % 360) + 360) % 360) / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [channel(0), channel(8), channel(4)]
}
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, d / (1 - Math.abs(2 * l - 1)), l]
}
function samples(frame: CanvasImageSource, side: number, doc: Document) {
  const canvas = doc.createElement('canvas')
  canvas.width = canvas.height = side
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined
  ctx.drawImage(frame, 0, 0, side, side)
  return ctx.getImageData(0, 0, side, side).data
}
const rec709 = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
export function pixelsDark(pixels: Uint8ClampedArray): boolean | null {
  let sum = 0, weight = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    weight += a
    sum += a * rec709(pixels[i], pixels[i + 1], pixels[i + 2])
  }
  return weight ? sum / weight < 0.5 : null
}
export function analyzeFrameDark(frame: CanvasImageSource, doc = document): boolean | null {
  const pixels = samples(frame, 32, doc)
  return pixels ? pixelsDark(pixels) : null
}
export function extractWallpaperColor(frame: CanvasImageSource, doc = document): string | null {
  const pixels = samples(frame, 64, doc)
  if (!pixels) return null
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  let totalR = 0, totalG = 0, totalB = 0, count = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]]
    count++; totalR += r; totalG += g; totalB += b
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    if (max < 31 || max > 247 || (max - min) / max < 0.08) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b
    buckets.set(key, bucket)
  }
  let best = 0, result: string | null = null
  for (const { r, g, b, count } of buckets.values()) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const score = count * (0.5 + (max - min) / max)
    if (score > best) { best = score; result = rgbToHex([r / count, g / count, b / count]) }
  }
  return result ?? (count ? rgbToHex([totalR / count, totalG / count, totalB / count]) : null)
}
const digits = ['rh', 'rl', 'gh', 'gl', 'bh', 'bl']
export function colorMarks(palette: SemanticPalette) {
  return [...digits.map((tag, index) => tag + palette.accent[index + 1]),
    palette.onAccent === '#ffffff' ? 'ink-light' : 'ink-dark', 'palette']
}
export function appearanceMarks(config: Appearance | undefined, hostScheme: Scheme, backdrop: boolean, solid: boolean, font = false, backdropDark?: boolean | null) {
  if (!config) return []
  const names: string[] = []
  const scheme = config.schemeOverride !== 'auto' ? config.schemeOverride :
    backdrop && typeof backdropDark === 'boolean' ? (backdropDark ? 'dark' : 'light') : hostScheme
  if (config.schemeOverride !== 'auto' || scheme !== hostScheme) names.push('scheme-override', 'tone')
  if (config.accent !== null) names.push(...colorMarks(paletteFor(config.accent, scheme)), 'tone')
  if (backdrop) names.push('backdrop')
  if (font) names.push('font')
  for (const part of SURFACES) {
    const opacity = config.opacities[part], blur = config.blurs[part], stroke = config.strokes[part]
    if (backdrop) {
      names.push(`s-${part}`, `p-${part}-${solid ? 100 : opacity}`)
      if (blur && !solid) names.push(`b-${part}-${blur}`)
    }
    if (stroke.width) {
      names.push('stroke', `w-${part}-${stroke.width * 2}`, `c-${part}-${stroke.color}`)
      if (stroke.color === 'custom') names.push(...digits.map((digit, i) => `${part}-${digit}${stroke.customColor[i + 1]}`))
    }
  }
  if (names.length) names.push(scheme)
  return [...new Set(names)]
}
export function reconcileMarks(previous: Set<string>, names: string[], add: (name: string) => void, remove: (name: string) => void) {
  const next = new Set(names)
  for (const name of previous) if (!next.has(name)) { remove(name); previous.delete(name) }
  for (const name of next) if (!previous.has(name)) { add(name); previous.add(name) }
}
export function markerCss(target: 'desktop' | 'web'): string {
  const prefix = target === 'desktop' ? 'data-cx-theme-background' : 'data-cx-ext-theme-background'
  const selector = (name: string) => `[${prefix}-${name}]`
  const rules = []
  const rgb = (base: string) => `rgb(${['r', 'g', 'b'].map(c => `calc(var(--tb-${base}${c}h) + var(--tb-${base}${c}l))`).join(' ')})`
  const strokeDigits = (part?: Surface) => {
    const base = part ? `${part}-` : ''
    for (const tag of digits) for (let n = 0; n < 16; n++) {
      rules.push(`${selector(base + tag + n.toString(16))}{--tb-${base}${tag}:${tag.endsWith('h') ? 16 * n : n}}`)
    }
  }
  strokeDigits()
  for (const part of SURFACES) {
    for (let opacity = 0; opacity <= 100; opacity += 5) rules.push(`${selector(`p-${part}-${opacity}`)}{--tb-p-${part}:${opacity}%}`)
    for (let blur = 1; blur <= 40; blur++) rules.push(`${selector(`b-${part}-${blur}`)}{--tb-b-${part}:blur(${blur}px)}`)
    for (let width = 1; width <= 8; width++) rules.push(`${selector(`w-${part}-${width}`)}{--tb-w-${part}:${width / 2}px}`)
    const strokeColors = { auto: 'var(--tb-canvas)', gray: '#808080', black: '#000000', white: '#ffffff', theme: 'var(--tb-accent,AccentColor)', custom: rgb(`${part}-`) }
    for (const [name, color] of Object.entries(strokeColors)) rules.push(`${selector(`c-${part}-${name}`)}{--tb-c-${part}:${color}}`)
    strokeDigits(part)
  }
  for (const scheme of ['light', 'dark'] as const) {
    rules.push(`${selector(scheme)}{--tb-scheme:${scheme};${Object.entries(bases[scheme]).map(([key, value]) => `--tb-${key}:${value}`).join(';')}}`)
  }
  rules.push(`${selector('ink-light')}{--tb-on-accent:#ffffff}`, `${selector('ink-dark')}{--tb-on-accent:#000000}`)
  rules.push(`${selector('palette')}{--tb-accent:${rgb('')}}`)
  return rules.join('\n') + '\n'
}
