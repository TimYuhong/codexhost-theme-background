import type { DesktopApi, Dispose } from '../host-api.ts'
import { DEFAULT } from '../shared/config.ts'
import type { ThemeConfig } from '../shared/config.ts'
import { createEffects } from '../shared/effects.ts'
import { createMediaStore } from '../shared/media-db.ts'
import { appearanceMarks, desktopHostScheme, nativeCanvas, reconcileMarks } from '../shared/palette.ts'
import { equal, openNotices, readSettings, watchFocus } from '../shared/sync.ts'
import { createBackdrop } from '../render/backdrop-layer.ts'
import type { Backdrop, RenderState } from '../render/backdrop-layer.ts'
import settingsCss from './settings-shadow.css'

declare const define: (extension: { activate(api: DesktopApi): Dispose }) => void
const ANCHOR = '[data-app-shell-frame], [data-app-shell-main-surface], [data-codexhost-settings-shell]'

function activate(api: DesktopApi): Dispose {
  if (api.signal.aborted) return () => {}
  const doc = document, root = doc.documentElement, win = doc.defaultView!
  const dark = win.matchMedia('(prefers-color-scheme: dark)')
  const forced = win.matchMedia('(forced-colors: active)')
  const reduced = win.matchMedia('(prefers-reduced-transparency: reduce)')
  const marks = new Set<string>(), media = createMediaStore()
  let active = true, queued = false, ready = false, retryMedia = false, seen = false
  let frameDark: boolean | null = null
  let config: ThemeConfig | undefined, snapshot: unknown, layer: HTMLElement | undefined, backdrop: Backdrop | undefined
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
      !!config?.respectReducedTransparency && reduced.matches, effects.fontReady, frameDark),
      name => api.dom.mark(root, name), name => api.dom.unmark(root, name))
    const settings = ['s-settings', 'tone', 'scheme-override', 'font', 'stroke'].some(name => marks.has(name))
    applySettingsSheet(settings ? doc.querySelector('[data-codexhost-settings-shell]')?.shadowRoot ?? undefined : undefined)
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
    const anchor = doc.querySelector(ANCHOR)
    if (!anchor || !layer?.isConnected) {
      backdrop?.dispose()
      layer?.remove()
      backdrop = layer = undefined
      ready = false
      frameDark = null
    }
    if (anchor && doc.body && !layer) {
      layer = doc.createElement('div')
      layer.className = 'tb-desktop-layer'
      layer.setAttribute('aria-hidden', 'true')
      api.dom.mount(layer, doc.body, 'prepend')
      backdrop = createBackdrop(layer, api.signal, media.backgroundBlob, stateChanged, { baseColor })
    }
    backdrop?.setVisible(!forced.matches)
    backdrop?.update(!forced.matches ? config ?? DEFAULT : DEFAULT)
    applyMarks()
  }
  const observer = new MutationObserver(records => {
    if (records.every(item => item.type === 'childList' && layer?.contains(item.target))) return
    if (!records.some(item => item.type === 'attributes' || !layer?.isConnected ||
      [...item.addedNodes, ...item.removedNodes].some(node => node instanceof Element && (node.matches(ANCHOR) || node.querySelector(ANCHOR))))) return
    if (queued) return
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
    backdrop?.dispose()
    layer?.remove()
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
