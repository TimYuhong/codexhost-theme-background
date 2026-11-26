import type { Dispose, Scheme, WebApi } from '../host-api.ts'
import { NATIVE_DEFAULT } from '../shared/config.ts'
import type { ThemeConfig } from '../shared/config.ts'
import { createEffects } from '../shared/effects.ts'
import { createMediaStore } from '../shared/media-db.ts'
import { appearanceMarks, nativeCanvas, reconcileMarks } from '../shared/palette.ts'
import { createOtterPet } from '../shared/otter-pet.ts'
import { openNotices, readSettings, watchFocus } from '../shared/sync.ts'
import { createBackdrop } from '../render/backdrop-layer.ts'
import type { Backdrop, RenderState } from '../render/backdrop-layer.ts'
import { createWindowChrome, DARK_ATTR, THEME_SOURCE } from './chrome.ts'

const APP = '[data-cx-region="app"]'
const COMPOSER = '[data-composer-card]'
const COMPOSER_SEAT = '[data-composer-seat]'
const PET_ANCHORS = [
  '[data-composer-seat] [data-testid="todo-panel"]',
  '[data-composer-seat] [data-queue-dock]',
  '[data-composer-top-bar]',
  COMPOSER,
] as const
const PET_WATCH = '[data-testid="todo-panel"], [data-queue-dock], [data-composer-top-bar], [data-composer-card]'
const PREVIEW = 'data-codexhost-wallpaper-previewing'
const WINDOWS_TITLEBAR = 'data-windows-titlebar'

export function activate(api: WebApi): Dispose {
  if (api.signal.aborted) return () => {}
  const doc = document, win = doc.defaultView!
  const forced = win.matchMedia('(forced-colors: active)')
  const reduced = win.matchMedia('(prefers-reduced-transparency: reduce)')
  const media = createMediaStore(), marks = new Set<string>(), chrome = createWindowChrome(doc)
  const pet = createOtterPet(doc, PET_ANCHORS, host => api.dom.mount(host, 'append'), COMPOSER)
  let active = true, queued = false, ready = false, retryMedia = false
  let frameDark: boolean | null = null
  let config: ThemeConfig | undefined, body = doc.body
  let hostScheme: Scheme = body?.hasAttribute(DARK_ATTR) ? 'dark' : 'light'
  let mount: ReturnType<WebApi['dom']['mount']>, backdrop: Backdrop | undefined
  const scheme = (): Scheme => hostScheme
  const baseColor = () => win.getComputedStyle(body).getPropertyValue(scheme() === 'dark' ?
    '--dsw-static-neutral-bluish-950' : '--dsw-static-neutral-bluish-00').trim() || nativeCanvas(scheme())
  function applyMarks() {
    if (!active || api.signal.aborted || !body) return
    const host = scheme()
    const cover = ready && !forced.matches && !body.hasAttribute(PREVIEW) && !!config?.opacity && !!mount?.container.isConnected
    const names = appearanceMarks(forced.matches ? undefined : config, host, cover,
      !!config?.respectReducedTransparency && reduced.matches, effects.fontReady, frameDark, config?.font.preset)
    if (cover) names.push('cover-native')
    reconcileMarks(marks, names, name => api.dom.mark(body, name), name => api.dom.unmark(body, name))
    const effective: Scheme = marks.has('dark') ? 'dark' : marks.has('light') ? 'light' : host
    chrome.update({
      active: !forced.matches && (marks.has('tone') || marks.has('backdrop')),
      effective,
      hostScheme: host,
      accent: config?.accent ?? null,
      allowThemeSource: !(config?.schedule.enabled && config.schedule.mode === 'system'),
    })
  }
  function stateChanged(result: RenderState) {
    ready = result.state === 'ready' || result.state === 'fallback'
    frameDark = 'frameDark' in result ? result.frameDark : null
    retryMedia = result.state === 'unavailable' && (result.reason === 'missing-local' || result.reason === 'storage')
    applyMarks()
  }
  function releaseMount() {
    backdrop?.dispose()
    mount?.dispose()
    mount = backdrop = undefined
    ready = false
    frameDark = null
  }
  const themeObserver = new MutationObserver(records => {
    const darkChanged = records.some(record => record.attributeName === DARK_ATTR)
    const previewChanged = records.some(record => record.attributeName === PREVIEW)
    if (darkChanged) {
      const attr = body?.getAttribute(DARK_ATTR) ?? null
      if (!chrome.ownsDarkAttr(attr)) {
        hostScheme = attr !== null ? 'dark' : 'light'
        chrome.noteHostDark(hostScheme)
        refresh()
        return
      }
    }
    if (previewChanged) refresh()
  })
  const rootObserver = new MutationObserver(records => {
    if (records.some(record => record.attributeName === WINDOWS_TITLEBAR ||
      (record.attributeName === THEME_SOURCE && !chrome.ownsThemeSource(doc.documentElement.getAttribute(THEME_SOURCE))))) {
      applyMarks()
    }
  })
  function watchBody() {
    themeObserver.disconnect()
    if (body) themeObserver.observe(body, { attributes: true, attributeFilter: [PREVIEW, DARK_ATTR] })
  }
  function refresh() {
    if (!active || api.signal.aborted) return
    if (doc.body !== body) {
      if (body) reconcileMarks(marks, [], () => {}, name => api.dom.unmark(body, name))
      body = doc.body
      hostScheme = body?.hasAttribute(DARK_ATTR) ? 'dark' : 'light'
      watchBody()
    }
    config = effects.effective()
    const app = doc.querySelector(APP)
    if (!mount?.container.isConnected || mount.container.parentElement !== app) releaseMount()
    if (!mount && app && body) {
      mount = api.dom.mount('app', 'prepend')
      if (mount) {
        mount.container.classList.add('tb-web-layer')
        mount.container.setAttribute('aria-hidden', 'true')
        backdrop = createBackdrop(mount.container, api.signal, media.backgroundBlob, stateChanged,
          { baseColor, loadAsset: async path => api.assets.url(path) })
      }
    }
    backdrop?.setVisible(!forced.matches && !body?.hasAttribute(PREVIEW))
    backdrop?.update(!forced.matches ? config ?? NATIVE_DEFAULT : NATIVE_DEFAULT)
    pet.sync(!forced.matches)
    applyMarks()
  }
  const structure = new MutationObserver(records => {
    const appHealthy = doc.body === body && !!mount?.container.isConnected && !!mount.container.parentElement?.matches(APP)
    if (appHealthy) {
      let sawDockOrComposer = !forced.matches && pet.hasLostHost()
      if (!sawDockOrComposer) {
        if (!pet.isHealthy()) {
          for (const record of records) {
            for (const list of [record.addedNodes, record.removedNodes]) {
              for (const node of list) {
                if (node.nodeType !== 1) continue
                const el = node as Element
                if (el.matches(PET_WATCH) || el.querySelector(PET_WATCH)) { sawDockOrComposer = true; break }
              }
              if (sawDockOrComposer) break
            }
            if (sawDockOrComposer) break
          }
        } else {
          for (const record of records) {
            if (record.target.nodeType === 1 && (record.target as Element).closest(COMPOSER_SEAT)) {
              for (const list of [record.addedNodes, record.removedNodes]) {
                for (const node of list) {
                  if (node.nodeType !== 1) continue
                  const el = node as Element
                  if (el.matches(PET_WATCH) || el.querySelector(PET_WATCH)) { sawDockOrComposer = true; break }
                }
                if (sawDockOrComposer) break
              }
            }
            if (sawDockOrComposer) break
          }
        }
      }
      if (!sawDockOrComposer) return
    } else if (doc.body === body && !mount && !records.some(record => {
      for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches(APP) || node.querySelector(APP))) return true
      }
      return false
    })) return
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; refresh() })
  })
  const notices = openNotices(notice => {
    if (notice.type === 'settings-committed' || notice.type === 'settings-observed') void reader.read()
    effects.notice(notice)
    const source = config?.source
    if (notice.type === 'media-changed' && (source?.kind === 'local-image' || source?.kind === 'local-video') && source.id === notice.id) backdrop?.retry()
  })
  const effects = createEffects(doc, api.signal, media, notices, refresh)
  const reader = readSettings(api.storage, result => {
    effects.adopt(result.state === 'ready' ? result.config : undefined)
    refresh()
  }, () => {})
  const offFocus = watchFocus(doc, () => {
    effects.focus()
    if (retryMedia && !forced.matches && !body?.hasAttribute(PREVIEW)) backdrop?.retry()
    refresh()
    void reader.read()
  })
  function dispose() {
    if (!active) return
    active = false
    api.signal.removeEventListener('abort', dispose)
    offFocus()
    structure.disconnect()
    themeObserver.disconnect()
    rootObserver.disconnect()
    for (const query of [forced, reduced]) query.removeEventListener('change', refresh)
    reader.dispose()
    effects.dispose()
    notices.close()
    pet.dispose()
    releaseMount()
    media.close()
    chrome.dispose(scheme())
    try { if (body) reconcileMarks(marks, [], () => {}, name => api.dom.unmark(body, name)) } catch { /* Host reclaims inactive marks. */ }
    marks.clear()
  }
  api.signal.addEventListener('abort', dispose, { once: true })
  structure.observe(doc, { childList: true, subtree: true })
  rootObserver.observe(doc.documentElement, { attributes: true, attributeFilter: [WINDOWS_TITLEBAR, THEME_SOURCE] })
  watchBody()
  for (const query of [forced, reduced]) query.addEventListener('change', refresh)
  refresh()
  void reader.read()
  return dispose
}
