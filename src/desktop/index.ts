import type { DesktopApi, Dispose } from '../host-api.ts'
import { NATIVE_DEFAULT } from '../shared/config.ts'
import type { ThemeConfig } from '../shared/config.ts'
import { createEffects } from '../shared/effects.ts'
import { createMediaStore } from '../shared/media-db.ts'
import { appearanceMarks, desktopHostScheme, nativeCanvas, reconcileMarks } from '../shared/palette.ts'
import { createOtterPet } from '../shared/otter-pet.ts'
import { equal, openNotices, readSettings, watchFocus } from '../shared/sync.ts'
import { createBackdrop } from '../render/backdrop-layer.ts'
import type { Backdrop, RenderState } from '../render/backdrop-layer.ts'
import settingsCss from './settings-shadow.css'

declare const define: (extension: { activate(api: DesktopApi): Dispose }) => void
const ANCHOR = '[data-app-shell-frame], [data-app-shell-main-surface], [data-codexhost-settings-shell]'
const SETTINGS_SHELL = '[data-codexhost-settings-shell]'
const DESKTOP_COMPOSER = '[data-composer-surface-variant]'
const SKIP_SCAN_TAGS = new Set(['SPAN', 'CODE', 'PRE', 'P', 'LI', 'A', 'STRONG', 'EM', 'SVG', 'PATH', 'BR', 'TR', 'TD', 'TH', 'G', 'CIRCLE', 'RECT', 'LINE'])

function activate(api: DesktopApi): Dispose {
  if (api.signal.aborted) return () => {}
  const doc = document, root = doc.documentElement, win = doc.defaultView!
  const dark = win.matchMedia('(prefers-color-scheme: dark)')
  const forced = win.matchMedia('(forced-colors: active)')
  const reduced = win.matchMedia('(prefers-reduced-transparency: reduce)')
  const marks = new Set<string>(), media = createMediaStore()
  const pet = createOtterPet(doc, DESKTOP_COMPOSER, host => {
    const container = doc.createElement('div')
    api.dom.mount(container, host, 'append')
    return { container, dispose() { container.remove() } }
  })
  let cachedAsset: { path: string; promise: Promise<string | undefined> } | undefined
  const loadAsset = (path: string) => {
    if (cachedAsset?.path === path) return cachedAsset.promise
    const promise = api.assets.readDataUrl(path).then(result => result.dataUrl).catch(() => {
      if (cachedAsset?.path === path) cachedAsset = undefined
      return undefined
    })
    cachedAsset = { path, promise }
    return promise
  }
  let active = true, queued = false, ready = false, retryMedia = false, seen = false
  let frameDark: boolean | null = null
  let config: ThemeConfig | undefined, snapshot: unknown, layer: HTMLElement | undefined, backdrop: Backdrop | undefined
  let anchorEl: Element | null = null, settingsShellEl: Element | null = null
  let settingsRoot: ShadowRoot | undefined, settingsStyle: CSSStyleSheet | undefined
  function applySettingsSheet(next: ShadowRoot | undefined) {
    if (settingsRoot === next) return
    if (settingsRoot) settingsRoot.adoptedStyleSheets = settingsRoot.adoptedStyleSheets.filter(sheet => sheet !== settingsStyle)
    settingsRoot = next
    if (next) {
      if (!settingsStyle) { settingsStyle = new CSSStyleSheet(); settingsStyle.replaceSync(settingsCss) }
      next.adoptedStyleSheets = [...next.adoptedStyleSheets, settingsStyle]
    }
  }
  const scheme = () => desktopHostScheme(root, dark.matches)
  function baseColor() {
    const native = win.getComputedStyle(root).getPropertyValue('--vscode-editor-background').trim()
    return /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(native) ? native : nativeCanvas(scheme())
  }
  function applyMarks() {
    if (!active || api.signal.aborted) return
    const visible = ready && !!layer?.isConnected && !!config?.opacity && !forced.matches
    reconcileMarks(marks, appearanceMarks(forced.matches ? undefined : config, scheme(), visible,
      !!config?.respectReducedTransparency && reduced.matches, effects.fontReady, frameDark, config?.font.preset),
      name => api.dom.mark(root, name), name => api.dom.unmark(root, name))
    const settings = ['s-settings', 'tone', 'scheme-override', 'font', 'stroke'].some(name => marks.has(name))
    settingsShellEl = settings ? doc.querySelector(SETTINGS_SHELL) : null
    applySettingsSheet(settingsShellEl?.shadowRoot ?? undefined)
  }
  function stateChanged(result: RenderState) {
    ready = result.state === 'ready' || result.state === 'fallback'
    frameDark = 'frameDark' in result ? result.frameDark : null
    retryMedia = result.state === 'unavailable' && (result.reason === 'missing-local' || result.reason === 'storage')
    applyMarks()
  }
  function refresh() {
    if (!active || api.signal.aborted) return
    config = effects.effective()
    anchorEl = doc.querySelector(ANCHOR)
    if (!anchorEl || !layer?.isConnected) {
      backdrop?.dispose()
      layer?.remove()
      backdrop = layer = undefined
      ready = false
      frameDark = null
    }
    if (anchorEl && doc.body && !layer) {
      layer = doc.createElement('div')
      layer.className = 'tb-desktop-layer'
      layer.setAttribute('aria-hidden', 'true')
      api.dom.mount(layer, doc.body, 'prepend')
      backdrop = createBackdrop(layer, api.signal, media.backgroundBlob, stateChanged, { baseColor, loadAsset })
    }
    backdrop?.setVisible(!forced.matches)
    backdrop?.update(!forced.matches ? config ?? NATIVE_DEFAULT : NATIVE_DEFAULT)
    pet.sync(!forced.matches)
    applyMarks()
  }
  const hasRelevantNode = (nodes: NodeList, selector: string) => {
    for (const node of nodes) {
      if (node.nodeType !== 1) continue
      const el = node as Element
      if (SKIP_SCAN_TAGS.has(el.tagName)) continue
      if (el.matches(selector) || el.querySelector(selector)) return true
    }
    return false
  }
  const observer = new MutationObserver(records => {
    let needsRefresh = false
    const layerAlive = !!layer?.isConnected && !!anchorEl?.isConnected
    const settingsLost = !!settingsShellEl && !settingsShellEl.isConnected
    const petLost = !forced.matches && pet.hasLostHost()
    const needPet = !forced.matches && !pet.isHealthy()
    if (!layerAlive || settingsLost || petLost) {
      for (const item of records) {
        if (item.type === 'attributes') { needsRefresh = true; break }
        if (layer?.contains(item.target)) continue
        if (!layer?.isConnected || settingsLost || petLost || hasRelevantNode(item.addedNodes, ANCHOR) || hasRelevantNode(item.removedNodes, ANCHOR)) {
          needsRefresh = true; break
        }
      }
    } else if (!settingsShellEl || needPet) {
      const watchSel = !settingsShellEl && needPet ? `${SETTINGS_SHELL}, ${DESKTOP_COMPOSER}` : !settingsShellEl ? SETTINGS_SHELL : DESKTOP_COMPOSER
      for (const item of records) {
        if (item.type === 'attributes') { needsRefresh = true; break }
        if (layer?.contains(item.target)) continue
        if (hasRelevantNode(item.addedNodes, watchSel)) {
          needsRefresh = true; break
        }
      }
    } else {
      for (const item of records) {
        if (item.type === 'attributes') { needsRefresh = true; break }
      }
    }
    if (!needsRefresh || queued) return
    queued = true
    queueMicrotask(() => { queued = false; refresh() })
  })
  const notices = openNotices(notice => {
    if (notice.type === 'settings-committed') void reader.read()
    effects.notice(notice)
    const source = config?.source
    if (notice.type === 'media-changed' && (source?.kind === 'local-image' || source?.kind === 'local-video') && source.id === notice.id) backdrop?.retry()
  })
  const effects = createEffects(doc, api.signal, media, notices, refresh)
  const reader = readSettings(api.storage, (result, independent) => {
    const changed = seen && !equal(snapshot, result)
    if (seen && !changed) return
    snapshot = result
    seen = true
    effects.adopt(result.state === 'ready' ? result.config : undefined)
    refresh()
    if (independent && changed) notices.send({ type: 'settings-observed' })
  }, () => {})
  const offFocus = watchFocus(doc, periodic => {
    if (!periodic) {
      effects.focus()
      if (retryMedia && !forced.matches) backdrop?.retry()
      refresh()
    }
    void reader.read(true)
  }, true)
  function dispose() {
    if (!active) return
    active = false
    api.signal.removeEventListener('abort', dispose)
    offFocus()
    observer.disconnect()
    for (const query of [dark, forced, reduced]) query.removeEventListener('change', refresh)
    reader.dispose()
    effects.dispose()
    notices.close()
    pet.dispose()
    backdrop?.dispose()
    layer?.remove()
    cachedAsset = undefined
    media.close()
    applySettingsSheet(undefined)
    try { reconcileMarks(marks, [], () => {}, name => api.dom.unmark(root, name)) } catch { /* Host reclaims inactive marks. */ }
    marks.clear()
  }
  api.signal.addEventListener('abort', dispose, { once: true })
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
  observer.observe(doc, { childList: true, subtree: true })
  for (const query of [dark, forced, reduced]) query.addEventListener('change', refresh)
  refresh()
  void reader.read()
  return dispose
}

define({ activate })
