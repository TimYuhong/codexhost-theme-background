import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DEFAULT, FONT_PRESETS, NATIVE_DEFAULT, PRESET_ASSET_PATH, readAppearance, SURFACES } from '../src/shared/config.ts'
import { builtIn, presetPatch } from '../src/page/profiles.ts'
import { analyzeFrameDark, appearanceMarks, colorMarks, contrast, desktopHostScheme, extractWallpaperColor, FONT_STACKS, hexToRgb, hslToHsv, hslToRgb, hsvToHsl, markerCss, paletteFor, reconcileMarks, rgbToHex, rgbToHsl } from '../src/shared/palette.ts'
import { createWindowChrome, DARK_ATTR, THEME_SOURCE, titlebarTone } from '../src/web/chrome.ts'

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
      assert.match(base, /--dsw-alias-border-l1:\s*color-mix\(in srgb, var\(--tb-border\) 50%, transparent\)/)
      assert.match(base, /\[data-selection-answer\]\s*:not\(pre\)\s*>\s*code\s*\{\s*border-color:\s*transparent;/)
      assert.match(base, /\[data-cx-ext-theme-background-palette\]\[data-cx-ext-theme-background-dark\]/)
      assert.match(base, /section\[data-turn-changes\]\s*>\s*div:first-child\s*>\s*button/)
      assert.match(base, /section\[data-turn-changes\]\s*\[data-path-label\]\s*>\s*span\s*>\s*:not\(:last-child\)/)
      assert.match(base, /\[data-lulu-changes\]\s*\.lulu-disclosure\[aria-expanded="true"\]/)
      assert.match(base, /\.lulu-running-changes\s+strong/)
      assert.match(base, /--dsw-alias-file-diff-added-marker:/)
      assert.match(base, /--dsw-alias-file-diff-deleted-marker:/)
      assert.match(base, /\[data-composer-card\]:focus-within/)
      assert.match(base, /\[data-cx-region="sidebar"\][^\{]*\[aria-current="page"\]/)
      assert.match(base, /\[data-thread-branch\]:not\(\[data-thread-branch\] \[data-thread-branch\]\):has\(> \[role="group"\]:not\(\[hidden\]\)\)/)
      assert.match(base, /svg\[data-codexhost-mark="otter"\]\s*>\s*circle/)
      assert.match(base, /svg\[data-codexhost-wordmark="codexhost"\]\s*\[data-codexhost-word="host"\]\s*rect/)
      assert.match(base, /\[data-shortcut-modal="settings"\]\s*\*\s*\{\s*color-scheme:\s*var\(--tb-scheme\)\s*!important/)
      assert.match(base, /\[data-cx-region="app"\]::before/)
      assert.match(base, /html\[data-windows-titlebar\][^\{]*> span\[style\*="--dsw-specific-sidebar-fill"\]/)
      assert.match(base, /html:has\(> body\[data-cx-ext-theme-background-scheme-override\]\[data-cx-ext-theme-background-dark\]\)/)
      assert.match(base, /\[data-phase="hero"\][^\{]*\[data-conversation-scroll\]\s*>\s*\[data-composer-seat\]/)
      assert.match(base, /\[data-composer-seat\]/)
      assert.match(base, /\[data-variant="think"\]\[data-expanded\]\s*>\s*\[data-open\]/)
      assert.match(base, /\[data-variant="think"\]\[data-expanded\]\s*>\s*\[data-open\]\s*>\s*\[data-disclosure-row\][^\{]*\{[^}]*height:\s*auto/)
      assert.match(base, /\[data-sidebar-right-panel\]\[data-sidebar-right-open\]\s*\{\s*background:\s*transparent/)
      assert.match(base, /\[data-composer-card\]\s*>\s*\.tb-otter-pet/)
      assert.match(base, /@keyframes tb-otter-breathe/)
      assert.match(base, /@keyframes tb-otter-blink/)
      assert.match(base, /@keyframes tb-otter-pat/)
      assert.match(base, /@keyframes tb-otter-idle/)
      assert.match(base, /@keyframes tb-otter-hop/)
    }
    if (target === 'desktop') {
      const shadow = readFileSync('src/desktop/settings-shadow.css', 'utf8')
      assert.match(base, /\[data-cx-theme-background-palette\]\[data-cx-theme-background-dark\]/)
      assert.match(base, /--app-color-background-surface:/)
      assert.match(base, /--codex-theme-accent-color:\s*var\(--tb-accent\)/)
      assert.match(base, /nav\[data-app-navigation-rail\]\s*:is\(\[aria-current="page"\]/)
      assert.match(base, /\[data-cx-sidebar-thread-tree-root-expanded\]/)
      assert.match(base, /\[data-composer-surface-variant\]:focus-within/)
      assert.match(base, /\[data-composer-surface-variant\]:has\(>\s*\.tb-otter-pet\),\s*\[data-composer-rail\]\[data-composer-rail-placement="above"\]:has\(>\s*\.tb-otter-pet\)\s*\{[^}]*overflow:\s*visible\s*!important/)
      assert.match(base, /\[data-composer-rail\]\[data-composer-rail-placement="above"\]:has\(>\s*\.tb-otter-pet\)\s*>\s*\[data-composer-rail-item\]:first-child[^\{]*\{[^}]*border-start-start-radius:/)
      assert.match(base, /\[data-composer-surface-variant\]\s*>\s*\.tb-otter-pet,\s*\[data-composer-rail\]\[data-composer-rail-placement="above"\]\s*>\s*\.tb-otter-pet\s*\{[^}]*z-index:\s*1[2-9]/)
      assert.match(base, /\[data-codexhost-mark="otter-colored"\]/)
      assert.match(base, /\[data-codexhost-mark="ch-navigation"\]/)
      assert.match(base, /--composer-layout-surface-background:/)
      assert.match(base, /--color-text-primary-solid:/)
      assert.match(base, /--color-token-title-bar-active-foreground:\s*var\(--tb-text\)/)
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
    for (const preset of FONT_PRESETS) {
      if (preset !== 'system') assert.ok(css.includes(`[${prefix}-font-${preset}]{--tb-font-stack:${FONT_STACKS[preset]}}`))
    }
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
  update(appearanceMarks(NATIVE_DEFAULT, 'light', true, true))
  assert.ok(!dom.has('palette') && !dom.has('dark') && !dom.has('font') && !dom.has('b-bg-12') && !dom.has('input-rh2'))
  for (const part of SURFACES) assert.ok(dom.has(`p-${part}-100`))
  update(appearanceMarks(NATIVE_DEFAULT, 'dark', false, false))
  assert.equal(dom.size, 0)
})

test('auto takes only an available wallpaper boolean; explicit values and native fallback win', () => {
  for (const host of ['light', 'dark'] as const) for (const dark of [true, false, null, undefined]) {
    const expected = typeof dark === 'boolean' ? dark ? 'dark' : 'light' : host
    const marks = appearanceMarks(NATIVE_DEFAULT, host, true, false, false, dark)
    assert.equal(marks.at(-1), expected)
    assert.equal(marks.includes('tone'), expected !== host)
    assert.equal(marks.includes('scheme-override'), expected !== host)
    const explicit = appearanceMarks({ ...NATIVE_DEFAULT, schemeOverride: 'dark' }, host, true, false, false, dark)
    assert.equal(explicit.at(-1), 'dark')
    assert.ok(explicit.includes('scheme-override'))
  }
  const changed = { ...NATIVE_DEFAULT, opacities: { ...NATIVE_DEFAULT.opacities, bg: 0 }, blurs: { ...NATIVE_DEFAULT.blurs, bg: 40 },
    strokes: { ...NATIVE_DEFAULT.strokes, bg: { width: 1, color: 'white', customColor: '#ffffff' } as const } }
  assert.deepEqual(appearanceMarks(changed, 'light', false, false, false, true), ['stroke', 'w-bg-2', 'c-bg-white', 'light'])
  assert.deepEqual(appearanceMarks(NATIVE_DEFAULT, 'light', false, false, false, null, 'editorial'), ['font', 'font-editorial', 'light'])
  assert.deepEqual(appearanceMarks(NATIVE_DEFAULT, 'light', false, false, true, null, 'editorial'), ['font', 'light'], 'local font wins over preset font')
  assert.deepEqual(appearanceMarks(undefined, 'light', false, false, true, true, 'editorial'), [], 'forced colors clears even outline and font')
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
test('all four built-in bundles ship public assets/ WebPs, complete palette/font settings, hue-separated accents, and WCAG AA primary buttons; fresh defaults keep WCAG AA on worst-case wallpapers', () => {
  const wallpaperHues: Record<string, number> = {
    default: 215, forest: 101, minimal: 208, glass: 192,
  }
  const hueDist = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360
    return Math.min(d, 360 - d)
  }
  assert.equal(builtIn.length, 4)
  assert.deepEqual(builtIn.map(item => item.name), ['default', 'forest', 'minimal', 'glass'])
  assert.equal(DEFAULT.accent, null, 'fresh enable keeps native host accent until the user picks a theme')
  assert.deepEqual(DEFAULT.source, { kind: 'none' }, 'fresh enable does not force a built-in wallpaper')
  assert.equal(DEFAULT.schemeOverride, 'auto')
  assert.deepEqual(appearanceMarks(DEFAULT, 'dark', false, false), [])
  assert.deepEqual(appearanceMarks(DEFAULT, 'light', false, false), [])
  for (const preset of builtIn) {
    const patch = presetPatch(preset)
    const assetPath = PRESET_ASSET_PATH(preset.name)
    assert.ok(assetPath.startsWith('assets/'), `${assetPath} must sit under assets/ for CodexHost public static asset serving`)
    const bytes = readFileSync(assetPath)
    assert.ok(bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP', `${assetPath} must be valid WebP`)
    assert.ok(!bytes.includes(Buffer.from('ANIM')), `${assetPath} must stay a static WebP for smooth frame pacing`)
    assert.ok(bytes.length <= 512 * 1024, `${assetPath} must stay within 512 KiB`)
    assert.deepEqual(patch.source, { kind: 'preset', id: preset.name })
    assert.equal(patch.font?.preset, preset.font)
    assert.ok(preset.accent && (preset.schemeOverride === 'light' || preset.schemeOverride === 'dark'))
    const colors = paletteFor(preset.accent, preset.schemeOverride)
    assert.equal(colors.accent, preset.accent, `${preset.name} accent already satisfies contrast without shifting`)
    const [accentHue] = rgbToHsl(...hexToRgb(colors.accent))
    assert.ok(hueDist(accentHue, wallpaperHues[preset.name]) >= 60,
      `${preset.name} accent hue ${accentHue.toFixed(1)} must stay separated from wallpaper hue ${wallpaperHues[preset.name]}`)
    for (const background of [colors.accent, mix(colors.accent, colors.text, 0.87), mix(colors.accent, colors.text, 0.76)]) {
      assert.ok(contrast(colors.onAccent, background) >= 4.5, `${preset.name} ${preset.schemeOverride} primary button`)
    }
    assert.ok(preset.opacities.bg <= 35 && preset.opacities.sidebar <= 15 && preset.blurs.bg === 0 && preset.blurs.sidebar === 0 && preset.blurs.card === 0 && preset.blurs.input === 0,
      `${preset.name} keeps crisp transparent canvas/sidebar and zero-blur cards/composer`)
    assert.ok(preset.opacities.card >= 50 && preset.opacities.input >= 80 && preset.opacities.settings >= 90,
      `${preset.name} keeps translucent cards, composer and settings readable`)
  }
  const fresh = { ...NATIVE_DEFAULT, name: 'native host fallback' }
  const appearance = readAppearance(fresh)
  for (const host of ['light', 'dark'] as const) for (const wallpaper of [[0], [255], [0, 255]]) {
    const hostCanvas = paletteFor('#000000', host).canvas
    const pixels = wallpaper.map(value => mix(rgbToHex([value, value, value]), hostCanvas, appearance.opacity / 100))
    for (const dark of wallpaper.length === 2 ? [true, false] : [Number.parseInt(pixels[0].slice(1, 3), 16) < 128]) {
      const scheme = appearanceMarks(appearance, host, true, false, false, dark).at(-1) as 'light' | 'dark'
      const colors = paletteFor(appearance.accent ?? '#000000', scheme)
      for (const pixel of pixels) for (const part of SURFACES) {
        const under = part === 'bg' || part === 'settings' ? colors.canvas : part === 'sidebar' ? colors.sidebar : colors.surface
        const surface = mix(under, pixel, appearance.opacities[part] / 100)
        for (const color of [colors.text, colors.muted]) {
          assert.ok(contrast(color, surface) >= 4.5, `${fresh.name} ${scheme} ${part} ${color} on ${surface}`)
        }
      }
      for (const background of [colors.text, mix(colors.text, colors.canvas, 0.87), mix(colors.text, colors.text, 0.76)]) {
        assert.ok(contrast(colors.canvas, background) >= 4.5, `${fresh.name} ${scheme} primary button`)
      }
    }
  }
})

test('accent-tinted canvas, sidebar, surface and hover keep WCAG AA even for extreme accents', () => {
  const tints = {
    dark: { canvas: ['#111318', 0.03], sidebar: ['#14171d', 0.04], surface: ['#161920', 0.04], hover: ['#20242d', 0.08] },
    light: { canvas: ['#ffffff', 0.02], sidebar: ['#f6f7f9', 0.03], surface: ['#f9fafc', 0.03], hover: ['#eceff4', 0.07] },
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
      const diffMarkers = scheme === 'light' ? ['#15653b', '#a42834'] : ['#8de6a8', '#ff9ea5']
      for (const marker of diffMarkers) {
        assert.ok(contrast(marker, toned.surface) >= 4.5, `${scheme} ${hex} diff marker ${marker}`)
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

test('Web window chrome syncs theme-color, data-ds-theme-source, and Windows titlebar probe without clobbering Host state', () => {
  assert.ok(contrast('#f1f2f4', titlebarTone('#5c9eff', 'dark')) >= 10)
  assert.ok(contrast('#191b20', titlebarTone('#b23262', 'light')) >= 10)

  type FakeEl = {
    tag: string
    name?: string
    content?: string
    textContent: string
    attrs: Map<string, string>
    styleMap: Map<string, string>
    children: FakeEl[]
    parent: FakeEl | null
    readonly isConnected: boolean
    style: { getPropertyValue(k: string): string; setProperty(k: string, v: string): void; removeProperty(k: string): void }
    getAttribute(k: string): string | null
    setAttribute(k: string, v: string): void
    removeAttribute(k: string): void
    hasAttribute(k: string): boolean
    appendChild(child: FakeEl): FakeEl
    insertBefore(child: FakeEl, ref: FakeEl | null): FakeEl
    querySelector(sel: string): FakeEl | null
    remove(): void
  }
  const makeEl = (tag: string): FakeEl => {
    const attrs = new Map<string, string>(), styleMap = new Map<string, string>(), children: FakeEl[] = []
    const el: FakeEl = {
      tag, textContent: '', attrs, styleMap, children, parent: null,
      get isConnected() { return this.parent !== null || this.tag === 'html' },
      style: {
        getPropertyValue: k => styleMap.get(k) ?? '',
        setProperty: (k, v) => { styleMap.set(k, v) },
        removeProperty: k => { styleMap.delete(k) },
      },
      getAttribute: k => attrs.get(k) ?? null,
      setAttribute: (k, v) => { attrs.set(k, v) },
      removeAttribute: k => { attrs.delete(k) },
      hasAttribute: k => attrs.has(k),
      appendChild(child) { child.remove(); child.parent = this; children.push(child); return child },
      insertBefore(child, ref) {
        child.remove(); child.parent = this
        const idx = ref ? children.indexOf(ref) : -1
        if (idx >= 0) children.splice(idx, 0, child); else children.push(child)
        return child
      },
      querySelector(sel) {
        if (sel === 'meta[name="theme-color"]') return children.find(c => c.tag === 'meta' && c.name === 'theme-color') ?? null
        return null
      },
      remove() {
        if (!this.parent) return
        const idx = this.parent.children.indexOf(this)
        if (idx >= 0) this.parent.children.splice(idx, 1)
        this.parent = null
      },
    }
    return el
  }

  const root = makeEl('html'), head = makeEl('head'), body = makeEl('body')
  root.appendChild(head); root.appendChild(body)
  root.setAttribute(THEME_SOURCE, 'system')
  root.setAttribute('data-windows-titlebar', '')
  const hostMeta = makeEl('meta'); hostMeta.name = 'theme-color'; hostMeta.content = '#ffffff'
  head.appendChild(hostMeta)

  const doc = { documentElement: root, head, body, createElement: (tag: string) => makeEl(tag) } as unknown as Document
  const chrome = createWindowChrome(doc)

  // Light Host + Dark theme override: syncs data-ds-dark-theme, theme-color, data-ds-theme-source, and wakes WCO probe
  chrome.update({ active: true, effective: 'dark', hostScheme: 'light', accent: '#e5a952', allowThemeSource: true })
  assert.equal(body.getAttribute(DARK_ATTR), 'tb')
  assert.equal(chrome.ownsDarkAttr('tb'), true)
  assert.equal(root.getAttribute(THEME_SOURCE), 'dark')
  assert.equal(chrome.ownsThemeSource('dark'), true)
  assert.equal(head.children[0].getAttribute('data-tb-theme-color'), '')
  assert.equal(head.children[0].content, titlebarTone('#e5a952', 'dark'))
  assert.equal(body.style.getPropertyValue('--tb-chrome-scheme'), 'dark')
  const wco = head.children.find(c => c.hasAttribute('data-tb-wco-sync'))
  assert.ok(wco && wco.textContent.includes('dark|'))

  // System-schedule mode must not hijack data-ds-theme-source, while still syncing body dark attribute
  chrome.update({ active: true, effective: 'dark', hostScheme: 'light', accent: '#e5a952', allowThemeSource: false })
  assert.equal(body.getAttribute(DARK_ATTR), 'tb')
  assert.equal(root.getAttribute(THEME_SOURCE), 'system')
  assert.equal(chrome.ownsThemeSource('system'), false)

  // Re-apply override, then Host itself switches to dark: stopping override must NOT revert Host back to light/'system'
  chrome.update({ active: true, effective: 'dark', hostScheme: 'light', accent: '#e5a952', allowThemeSource: true })
  assert.equal(root.getAttribute(THEME_SOURCE), 'dark')
  body.setAttribute(DARK_ATTR, '')
  chrome.noteHostDark('dark')
  chrome.update({ active: true, effective: 'dark', hostScheme: 'dark', accent: '#e5a952', allowThemeSource: true })
  assert.equal(body.getAttribute(DARK_ATTR), '')
  assert.equal(root.getAttribute(THEME_SOURCE), 'dark')

  // Host is dark ('dark'), override to light ('light') removes data-ds-dark-theme, then dispose restores Host's dark state cleanly
  chrome.update({ active: true, effective: 'light', hostScheme: 'dark', accent: '#ae5436', allowThemeSource: true })
  assert.equal(body.getAttribute(DARK_ATTR), null)
  assert.equal(chrome.ownsDarkAttr(null), true)
  assert.equal(root.getAttribute(THEME_SOURCE), 'light')
  chrome.dispose('dark')
  assert.equal(body.getAttribute(DARK_ATTR), '')
  assert.equal(root.getAttribute(THEME_SOURCE), 'dark')
  assert.equal(body.style.getPropertyValue('--tb-chrome-scheme'), '')
  assert.deepEqual(head.children, [hostMeta])
})
