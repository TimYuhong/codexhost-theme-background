import { hexToRgb, paletteFor, rgbToHex } from '../shared/palette.ts'
import type { Scheme } from '../shared/palette.ts'

export const THEME_SOURCE = 'data-ds-theme-source'
export const DARK_ATTR = 'data-ds-dark-theme'
const DARK_SENTINEL = 'tb'

function mixHex(front: string, back: string, weight: number) {
  const f = hexToRgb(front), b = hexToRgb(back)
  return rgbToHex(f.map((channel, i) => channel * weight + b[i] * (1 - weight)))
}

export function titlebarTone(accent: string | null, scheme: Scheme): string {
  if (!accent) return scheme === 'dark' ? '#24262a' : '#eef0f3'
  const resolved = paletteFor(accent, scheme).accent
  return scheme === 'dark' ? mixHex(resolved, '#14171d', 0.04) : mixHex(resolved, '#f6f7f9', 0.03)
}

export type WindowChromeState = {
  active: boolean
  effective: Scheme
  hostScheme: Scheme
  accent: string | null
  allowThemeSource: boolean
}

export function createWindowChrome(doc: Document) {
  const root = doc.documentElement
  let meta: HTMLMetaElement | undefined
  let wcoSync: HTMLStyleElement | undefined
  let lastBody: HTMLElement | null = null
  let savedThemeSource: string | null = null
  let savedHostScheme: Scheme | undefined
  let appliedThemeSource: Scheme | undefined
  let darkOverridden = false
  let appliedDarkAttr: string | null = null
  let savedDarkBody: HTMLElement | null = null
  let savedDarkValue: string | null = null
  let lastSig = ''

  function restoreThemeSource(hostScheme?: Scheme) {
    if (appliedThemeSource === undefined) return
    const current = root.getAttribute(THEME_SOURCE)
    const hostUnchanged = hostScheme === undefined || hostScheme === savedHostScheme
    if (hostUnchanged && current === appliedThemeSource) {
      if (savedThemeSource === null) root.removeAttribute(THEME_SOURCE)
      else root.setAttribute(THEME_SOURCE, savedThemeSource)
    }
    appliedThemeSource = undefined
    savedHostScheme = undefined
    savedThemeSource = null
  }

  function restoreDarkAttr(hostScheme?: Scheme) {
    if (!darkOverridden) return
    const target = savedDarkBody
    if (target) {
      const current = target.getAttribute(DARK_ATTR)
      const shouldBeDark = hostScheme ? hostScheme === 'dark' : savedDarkValue !== null
      if (current === appliedDarkAttr) {
        if (shouldBeDark) target.setAttribute(DARK_ATTR, savedDarkValue ?? '')
        else target.removeAttribute(DARK_ATTR)
      }
    }
    darkOverridden = false
    appliedDarkAttr = null
    savedDarkBody = null
    savedDarkValue = null
  }

  function clearBodyVar() {
    lastBody?.style.removeProperty('--tb-chrome-scheme')
    lastBody = null
  }

  function update({ active, effective, hostScheme, accent, allowThemeSource }: WindowChromeState) {
    if (!active) {
      meta?.remove(); meta = undefined
      wcoSync?.remove(); wcoSync = undefined
      clearBodyVar()
      restoreDarkAttr(hostScheme)
      restoreThemeSource(hostScheme)
      lastSig = ''
      return
    }
    const color = titlebarTone(accent, effective)
    if (!meta) {
      meta = doc.createElement('meta')
      meta.name = 'theme-color'
      meta.setAttribute('data-tb-theme-color', '')
    }
    if (meta.content !== color) meta.content = color
    if (!meta.isConnected && doc.head) {
      const first = doc.head.querySelector('meta[name="theme-color"]')
      doc.head.insertBefore(meta, first)
    }

    const body = doc.body
    if (savedDarkBody && savedDarkBody !== body) restoreDarkAttr(hostScheme)
    if (body && effective !== hostScheme) {
      const want = effective === 'dark' ? DARK_SENTINEL : null
      if (!darkOverridden) {
        savedDarkBody = body
        savedDarkValue = body.getAttribute(DARK_ATTR)
        darkOverridden = true
      }
      appliedDarkAttr = want
      const current = body.getAttribute(DARK_ATTR)
      if (want === null) {
        if (current !== null) body.removeAttribute(DARK_ATTR)
      } else if (current !== want) {
        body.setAttribute(DARK_ATTR, want)
      }
    } else {
      restoreDarkAttr(hostScheme)
    }

    const shouldOverrideSource = allowThemeSource && effective !== hostScheme
    if (shouldOverrideSource) {
      const current = root.getAttribute(THEME_SOURCE)
      if (appliedThemeSource === undefined || hostScheme !== savedHostScheme || current !== appliedThemeSource) {
        savedThemeSource = current
        savedHostScheme = hostScheme
      }
      if (current !== effective) root.setAttribute(THEME_SOURCE, effective)
      appliedThemeSource = effective
    } else {
      restoreThemeSource(hostScheme)
    }

    if (lastBody && lastBody !== body) clearBodyVar()
    if (body) {
      lastBody = body
      if (body.style.getPropertyValue('--tb-chrome-scheme') !== effective) {
        body.style.setProperty('--tb-chrome-scheme', effective)
      }
    }

    const sig = `${effective}|${color}`
    if (root.hasAttribute('data-windows-titlebar') && doc.head) {
      if (!wcoSync) {
        wcoSync = doc.createElement('style')
        wcoSync.setAttribute('data-tb-wco-sync', '')
      }
      if (!wcoSync.isConnected) doc.head.appendChild(wcoSync)
      if (sig !== lastSig) wcoSync.textContent = `/* tb-chrome:${sig} */`
    } else if (wcoSync) {
      wcoSync.remove()
      wcoSync = undefined
    }
    lastSig = sig
  }

  function noteHostDark(hostScheme: Scheme) {
    if (!darkOverridden) return
    savedDarkValue = hostScheme === 'dark' ? '' : null
    darkOverridden = false
    appliedDarkAttr = null
    savedDarkBody = null
  }

  function dispose(hostScheme?: Scheme) {
    meta?.remove(); meta = undefined
    wcoSync?.remove(); wcoSync = undefined
    clearBodyVar()
    restoreDarkAttr(hostScheme)
    restoreThemeSource(hostScheme)
    lastSig = ''
  }

  return {
    update,
    dispose,
    noteHostDark,
    ownsDarkAttr: (value: string | null) => darkOverridden && value === appliedDarkAttr,
    ownsThemeSource: (value: string | null) => appliedThemeSource !== undefined && value === appliedThemeSource,
  }
}
