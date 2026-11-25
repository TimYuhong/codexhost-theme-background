import type { Dispose, WebApi } from '../host-api.ts'
import { DEFAULT } from '../shared/config.ts'
import type { ThemeConfig } from '../shared/config.ts'
import { createEffects } from '../shared/effects.ts'
import { createMediaStore } from '../shared/media-db.ts'
import { appearanceMarks, nativeCanvas, reconcileMarks } from '../shared/palette.ts'
import { openNotices, readSettings, watchFocus } from '../shared/sync.ts'
import { createBackdrop } from '../render/backdrop-layer.ts'
import type { Backdrop, RenderState } from '../render/backdrop-layer.ts'

const APP = '[data-cx-region="app"]'
const PREVIEW = 'data-codexhost-wallpaper-previewing'
const DARK = 'data-ds-dark-theme'

export function activate(api: WebApi): Dispose {
  if (api.signal.aborted) return () => {}
  const doc = document, win = doc.defaultView!
  const forced = win.matchMedia('(forced-colors: active)')
  const reduced = win.matchMedia('(prefers-reduced-transparency: reduce)')
  const media = createMediaStore(), marks = new Set<string>()
  let active = true, queued = false, ready = false, retryMedia = false
  let frameDark: boolean | null = null
  let config: ThemeConfig | undefined, body = doc.body
  let mount: ReturnType<WebApi['dom']['mount']>, backdrop: Backdrop | undefined
  const scheme = () => body?.hasAttribute(DARK) ? 'dark' : 'light'
  const baseColor = () => win.getComputedStyle(body).getPropertyValue(scheme() === 'dark' ?
    '--dsw-static-neutral-bluish-950' : '--dsw-static-neutral-bluish-00').trim() || nativeCanvas(scheme())
  function applyMarks() {
    if (!active || api.signal.aborted || !body) return
    const cover = ready && !forced.matches && !body.hasAttribute(PREVIEW) && !!config?.opacity && !!mount?.container.isConnected
    const names = appearanceMarks(forced.matches ? undefined : config, scheme(), cover,
      !!config?.respectReducedTransparency && reduced.matches, effects.fontReady, frameDark)
    if (cover) names.push('cover-native')
    reconcileMarks(marks, names, name => api.dom.mark(body, name), name => api.dom.unmark(body, name))
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
  const themeObserver = new MutationObserver(() => refresh())
  function watchBody() {
    themeObserver.disconnect()
    if (body) themeObserver.observe(body, { attributes: true, attributeFilter: [PREVIEW, DARK] })
  }
  function refresh() {
    if (!active || api.signal.aborted) return
    if (doc.body !== body) {
      if (body) reconcileMarks(marks, [], () => {}, name => api.dom.unmark(body, name))
      body = doc.body
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
        backdrop = createBackdrop(mount.container, api.signal, media.backgroundBlob, stateChanged, { baseColor })
      }
    }
    backdrop?.setVisible(!forced.matches && !body?.hasAttribute(PREVIEW))
    backdrop?.update(!forced.matches ? config ?? DEFAULT : DEFAULT)
    applyMarks()
  }
  const structure = new MutationObserver(records => {
    if (doc.body === body && mount?.container.isConnected && !records.some(record =>
      [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(APP) || node.querySelector(APP))))) return
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
    for (const query of [forced, reduced]) query.removeEventListener('change', refresh)
    reader.dispose()
    effects.dispose()
    notices.close()
    releaseMount()
    media.close()
    try { if (body) reconcileMarks(marks, [], () => {}, name => api.dom.unmark(body, name)) } catch { /* Host reclaims inactive marks. */ }
    marks.clear()
  }
  api.signal.addEventListener('abort', dispose, { once: true })
  structure.observe(doc, { childList: true, subtree: true })
  watchBody()
  for (const query of [forced, reduced]) query.addEventListener('change', refresh)
  refresh()
  void reader.read()
  return dispose
}
