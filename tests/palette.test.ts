import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DEFAULT, readAppearance, SURFACES } from '../src/shared/config.ts'
import { builtIn } from '../src/page/profiles.ts'
import { analyzeFrameDark, appearanceMarks, colorMarks, contrast, desktopHostScheme, extractWallpaperColor, hexToRgb, hslToHsv, hslToRgb, hsvToHsl, markerCss, paletteFor, reconcileMarks, rgbToHex, rgbToHsl } from '../src/shared/palette.ts'

test('semantic palettes produce a deterministic and readable accent in both schemes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const hex of ['#ffffff', '#000000', '#888888', '#ff0000', '#468abc', '#cccccc']) {
      const palette = paletteFor(hex, scheme)
      assert.deepEqual(paletteFor(hex, scheme), palette)
      assert.ok(contrast(palette.accent, palette.canvas) >= 4.5, `${scheme} ${hex} canvas`)
      assert.ok(contrast(palette.accent, palette.surface) >= 4.5, `${scheme} ${hex} surface`)
      assert.ok(contrast(palette.accent, palette.onAccent) >= 4.5, `${scheme} ${hex} on accent`)
    }
  }
})
test('CSS reconstructs all 24 accent bits with distinct complete prefixes', () => {
  const palette = paletteFor('#468abc', 'dark')
  const tags = colorMarks(palette).slice(0, 6)
  for (const [target, prefix] of [['desktop', 'data-cx-theme-background'], ['web', 'data-cx-ext-theme-background']] as const) {
    const css = markerCss(target)
    const rules = Array.from(css.matchAll(/\[([^\]]+)\]\{([^}]+)\}/g))
    const base = readFileSync(`src/${target}/${target}.css`, 'utf8')
    assert.ok(Buffer.byteLength(css) + Buffer.byteLength(base) <= 256 * 1024)
    if (target === 'web') {
      const rule = /body\[data-cx-ext-theme-background-palette\]\s*\{([^}]+)\}/.exec(base)?.[1] ?? ''
      assert.match(rule, /--dsw-alias-button-primary-fill:\s*var\(--tb-accent\)/)
      assert.match(rule, /--dsw-alias-button-info-fill:\s*var\(--tb-accent\)/)
      assert.match(rule, /--dsw-alias-label-primary-foreground:\s*var\(--tb-on-accent\)/)
      assert.match(rule, /--dsw-specific-sidebar-nav-item-active:/)
      assert.match(rule, /--dsw-alias-scrollbar-bg-l2:/)
      assert.doesNotMatch(rule, /--dsh-codexhost-mark-accent/)
      assert.match(base, /\[data-cx-ext-theme-background-palette\]\[data-cx-ext-theme-background-dark\]/)
      assert.match(base, /section\[data-turn-changes\]\s*>\s*div:first-child\s*>\s*button/)
      assert.match(base, /\[data-composer-card\]:focus-within/)
      assert.match(base, /\[data-cx-region="sidebar"\][^\{]*\[aria-current="page"\]/)
      assert.match(base, /\[data-thread-branch\]:not\(\[data-thread-branch\] \[data-thread-branch\]\):has\(> \[role="group"\]:not\(\[hidden\]\)\)/)
      assert.match(base, /svg\[data-codexhost-mark="otter"\]\s*>\s*circle/)
      assert.match(base, /svg\[data-codexhost-wordmark="codexhost"\]\s*\[data-codexhost-word="host"\]\s*rect/)
      assert.match(base, /\[data-shortcut-modal="settings"\]\s*\*\s*\{\s*color-scheme:\s*var\(--tb-scheme\)\s*!important/)
      assert.match(base, /\[data-cx-region="app"\]::before/)
      assert.match(base, /\[data-composer-seat\]/)
    }
    if (target === 'desktop') {
      const shadow = readFileSync('src/desktop/settings-shadow.css', 'utf8')
      assert.match(base, /\[data-cx-theme-background-palette\]\[data-cx-theme-background-dark\]/)
      assert.match(base, /--app-color-background-surface:/)
      assert.match(base, /--codex-theme-accent-color:\s*var\(--tb-accent\)/)
      assert.match(base, /nav\[data-app-navigation-rail\]\s*:is\(\[aria-current="page"\]/)
      assert.match(base, /\[data-cx-sidebar-thread-tree-root-expanded\]/)
      assert.match(base, /\[data-composer-surface-variant\]:focus-within/)
      assert.match(base, /\[data-codexhost-mark="otter-colored"\]/)
      assert.match(base, /\[data-codexhost-mark="ch-navigation"\]/)
      assert.match(base, /--composer-layout-surface-background:/)
      assert.match(base, /--color-text-primary-solid:/)
      assert.match(base, /--font-ui-family:/)
      assert.match(shadow, /\.settings-nav-button\[aria-current="page"\]/)
      assert.match(shadow, /--cx-page-accent:\s*var\(--tb-accent\)/)
    }
    for (const [, name] of rules) {
      assert.ok(name.startsWith(`${prefix}-`))
      assert.match(name.slice(prefix.length + 1), /^[a-z][a-z0-9-]{0,31}$/)
      assert.match(name.slice(prefix.length + 1), /^[a-z0-9][a-z0-9-]{0,63}$/)
    }
    const parts = tags.map(tag => Number(new RegExp(`\\[${prefix}-${tag}\\]\\{--tb-${tag.slice(0, 2)}:(\\d+)`).exec(css)?.[1]))
    assert.equal('#' + [parts[0] + parts[1], parts[2] + parts[3], parts[4] + parts[5]].map(x => x.toString(16).padStart(2, '0')).join(''), palette.accent)
    for (const part of SURFACES) {
      assert.ok(css.includes(`--tb-p-${part}:0%`) && css.includes(`--tb-p-${part}:100%`))
      assert.ok(css.includes(`--tb-b-${part}:blur(40px)`) && !css.includes(`--tb-b-${part}:blur(0px)`))
      assert.ok(css.includes(`--tb-w-${part}:0.5px`) && css.includes(`--tb-w-${part}:4px`))
    }
    assert.ok(css.includes(`--tb-sidebar:${palette.sidebar}`))
  }
})
test('reconciliation removes stale bits, plate, scheme and palette markers', () => {
  const state = new Set<string>(), dom = new Set<string>()
  const update = (names: string[]) => {
    reconcileMarks(state, names, name => { assert.ok(!dom.has(name)); dom.add(name) }, name => { assert.ok(dom.delete(name)) })
    assert.deepEqual(dom, new Set(names))
  }
  const config = { ...DEFAULT, accent: '#468abc', schemeOverride: 'dark', opacities: { ...DEFAULT.opacities, bg: 0 },
    blurs: { ...DEFAULT.blurs, bg: 12 }, strokes: { ...DEFAULT.strokes, input: { width: 0.5, color: 'custom', customColor: '#2c407a' } } } as const
  update(appearanceMarks(config, 'light', true, false, true))
  for (const mark of ['p-bg-0', 'palette', 'dark', 'font', 'b-bg-12', 'w-input-1', 'c-input-custom', 'input-rh2']) assert.ok(dom.has(mark))
  update(appearanceMarks(DEFAULT, 'light', true, true))
  assert.ok(!dom.has('palette') && !dom.has('dark') && !dom.has('font') && !dom.has('b-bg-12') && !dom.has('input-rh2'))
  for (const part of SURFACES) assert.ok(dom.has(`p-${part}-100`))
  update(appearanceMarks(DEFAULT, 'dark', false, false))
  assert.equal(dom.size, 0)
})

test('auto takes only an available wallpaper boolean; explicit values and native fallback win', () => {
  for (const host of ['light', 'dark'] as const) for (const dark of [true, false, null, undefined]) {
    const expected = typeof dark === 'boolean' ? dark ? 'dark' : 'light' : host
    const marks = appearanceMarks(DEFAULT, host, true, false, false, dark)
    assert.equal(marks.at(-1), expected)
    assert.equal(marks.includes('tone'), expected !== host)
    assert.equal(marks.includes('scheme-override'), expected !== host)
    const explicit = appearanceMarks({ ...DEFAULT, schemeOverride: 'dark' }, host, true, false, false, dark)
    assert.equal(explicit.at(-1), 'dark')
    assert.ok(explicit.includes('scheme-override'))
  }
  const changed = { ...DEFAULT, opacities: { ...DEFAULT.opacities, bg: 0 }, blurs: { ...DEFAULT.blurs, bg: 40 },
    strokes: { ...DEFAULT.strokes, bg: { width: 1, color: 'white', customColor: '#ffffff' } as const } }
  assert.deepEqual(appearanceMarks(changed, 'light', false, false, false, true), ['stroke', 'w-bg-2', 'c-bg-white', 'light'])
  assert.deepEqual(appearanceMarks(undefined, 'light', false, false, true, true), [], 'forced colors clears even outline and font')
})

test('Desktop host markers and native style win over an opposite OS preference', () => {
  const dataset: DOMStringMap = { theme: 'light' }, classes = new Set<string>()
  let colorScheme = 'light'
  const root = { dataset, classList: { contains: (value: string) => classes.has(value) },
    ownerDocument: { defaultView: { getComputedStyle: () => ({ colorScheme }) } } } as unknown as HTMLElement
  assert.equal(desktopHostScheme(root, true), 'light')
  delete dataset.theme; classes.add('dark')
  assert.equal(desktopHostScheme(root, false), 'dark')
  classes.clear()
  for (let pass = 0; pass < 10; pass++) {
    const host = desktopHostScheme(root, true)
    assert.equal(host, 'light')
    assert.ok(appearanceMarks(DEFAULT, host, true, false, false, true).includes('scheme-override'))
  }
  colorScheme = 'normal'
  assert.equal(desktopHostScheme(root, true), 'dark')
})

const mix = (front: string, back: string, opacity: number) => {
  const behind = hexToRgb(back)
  return rgbToHex(hexToRgb(front).map((channel, i) => channel * opacity + behind[i] * (1 - opacity)))
}
test('all six presets and fresh defaults keep WCAG AA on both halves of worst-case wallpapers', () => {
  for (const preset of [...builtIn, { ...DEFAULT, name: 'fresh installation' }]) {
    const appearance = readAppearance(preset)
    for (const host of ['light', 'dark'] as const) for (const wallpaper of [[0], [255], [0, 255]]) {
      const hostCanvas = paletteFor('#000000', host).canvas
      const pixels = wallpaper.map(value => mix(rgbToHex([value, value, value]), hostCanvas, appearance.opacity / 100))
      // A split frame can resolve to either scheme after cropping or blur, so cover both.
      for (const dark of wallpaper.length === 2 ? [true, false] : [Number.parseInt(pixels[0].slice(1, 3), 16) < 128]) {
        const scheme = appearanceMarks(appearance, host, true, false, false, dark).at(-1) as 'light' | 'dark'
        const colors = paletteFor(appearance.accent ?? '#000000', scheme)
        for (const pixel of pixels) for (const part of SURFACES) {
          const under = part === 'bg' || part === 'settings' ? colors.canvas : part === 'sidebar' ? colors.sidebar : colors.surface
          const surface = mix(under, pixel, appearance.opacities[part] / 100)
          for (const color of [colors.text, colors.muted]) {
            assert.ok(contrast(color, surface) >= 4.5, `${preset.name} ${scheme} ${part} ${color} on ${surface}`)
          }
        }
        const fill = appearance.accent ? colors.accent : colors.text, ink = appearance.accent ? colors.onAccent : colors.canvas
        for (const background of [fill, mix(fill, appearance.accent ? colors.text : colors.canvas, 0.87), mix(fill, colors.text, 0.76)]) {
          assert.ok(contrast(ink, background) >= 4.5, `${preset.name} ${scheme} primary button`)
        }
      }
    }
  }
})

test('accent-tinted canvas, sidebar, surface and hover keep WCAG AA even for extreme accents', () => {
  const tints = {
    dark: { canvas: ['#131519', 0.08], sidebar: ['#16191e', 0.11], surface: ['#171a20', 0.12], hover: ['#20242c', 0.18] },
    light: { canvas: ['#ffffff', 0.05], sidebar: ['#f5f7fa', 0.08], surface: ['#f8f9fb', 0.07], hover: ['#eef1f6', 0.13] },
  } as const
  for (const scheme of ['light', 'dark'] as const) {
    for (const hex of ['#ffffff', '#000000', '#22c55e', '#305f91', '#60114c', '#ffff00']) {
      const colors = paletteFor(hex, scheme), spec = tints[scheme]
      const toned = {
        canvas: mix(colors.accent, spec.canvas[0], spec.canvas[1]),
        sidebar: mix(colors.accent, spec.sidebar[0], spec.sidebar[1]),
        surface: mix(colors.accent, spec.surface[0], spec.surface[1]),
        hover: mix(colors.accent, spec.hover[0], spec.hover[1]),
      }
      for (const wp of ['#000000', '#ffffff']) {
        for (const [part, opacity] of [['canvas', 0.8], ['sidebar', 0.85], ['surface', 0.85]] as const) {
          const surface = mix(toned[part], wp, opacity)
          for (const ink of [colors.text, colors.muted]) {
            assert.ok(contrast(ink, surface) >= 4.5, `${scheme} ${hex} ${part} on ${wp}: ${contrast(ink, surface)}`)
          }
        }
      }
      for (const ink of [colors.text, colors.muted]) {
        assert.ok(contrast(ink, toned.hover) >= 4.5, `${scheme} ${hex} hover`)
      }
    }
  }
})

test('HSV and HSL round trip and image sampling ignores clear pixels', () => {
  const hsl = rgbToHsl(23, 113, 203)
  assert.equal(rgbToHex(hslToRgb(...hsl)), '#1771cb')
  assert.deepEqual(hslToRgb(...hsvToHsl(...hslToHsv(...hsl))), [23, 113, 203])
  let samples: number[] = []
  const doc = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(samples) }) }) }) } as unknown as Document
  const frame = {} as HTMLCanvasElement
  samples = [30, 110, 150, 255, 31, 111, 151, 255, 200, 200, 200, 0]
  assert.equal(extractWallpaperColor(frame, doc), '#1f6f97')
  assert.equal(analyzeFrameDark(frame, doc), true)
  samples = [255, 255, 255, 255, 0, 0, 0, 0]
  assert.equal(extractWallpaperColor(frame, doc), '#ffffff')
  assert.equal(analyzeFrameDark(frame, doc), false)
})
