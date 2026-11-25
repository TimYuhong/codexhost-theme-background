import type { Dispose, PageApi } from '../host-api.ts'
import { DEFAULT, scheduledConfig, STROKE_COLORS, SURFACES } from '../shared/config.ts'
import type { ThemeConfig } from '../shared/config.ts'
import { createMediaStore } from '../shared/media-db.ts'
import { editSettings, openNotices, watchFocus } from '../shared/sync.ts'
import { backgroundPage } from './background.ts'
import { colorsPage } from './colors.ts'
import type { Key } from './i18n.ts'
import { mediaPage } from './library.ts'
import { profilesPage } from './profiles.ts'
import { pageUi } from './ui.ts'
import type { Ui } from './ui.ts'

const TABS = ['colors', 'interface', 'font', 'background', 'profiles'] as const
type Tab = typeof TABS[number]

export function mount(root: HTMLElement, api: PageApi): Dispose {
  if (api.signal.aborted) return () => {}
  const doc = root.ownerDocument, win = doc.defaultView!, lifetime = new AbortController(), { signal } = lifetime
  const page = doc.createElement('section')
  page.dataset.tbPage = ''
  root.append(page)
  let initialized = false, tab: Tab = 'colors'
  const system = win.matchMedia('(prefers-color-scheme: dark)')
  const systemScheme = () => system.matches ? 'dark' : 'light'
  const reduced = win.matchMedia('(prefers-reduced-transparency: reduce)')
  const content = doc.createElement('div')
  content.className = 'tb-shell'; page.append(content)
  const notices = openNotices(notice => {
    if (signal.aborted) return
    if (notice.type === 'settings-committed' || notice.type === 'settings-observed') void editor.read()
    if (notice.type === 'media-changed') {
      background.retry(notice.id); library.changed(notice.id); void library.refresh()
    }
    if (notice.type === 'rotation-changed') background.syncRotation(notice.poolId)
  })
  const editor = editSettings(api.storage, render, () => notices.send({ type: 'settings-committed' }))
  const current = () => editor.draft ?? DEFAULT
  const locked = () => editor.readOnly
  const commit = () => { void editor.flush() }
  const edit = (patch: Partial<ThemeConfig>) => editor.editMany(patch)
  const ui = pageUi(page, content, signal, api.locale, commit)
  const { make, text, on, button, label } = ui
  const sidebar = make('aside', content, 'tb-nav')
  const brand = make('div', sidebar, 'tb-brand')
  make('span', brand, 'tb-brand-icon').setAttribute('aria-hidden', 'true')
  text(make('strong', brand), 'title')
  const tabs = make('div', sidebar, 'tb-tabs')
  tabs.setAttribute('role', 'tablist'); label(tabs, 'title')
  const main = make('main', content, 'tb-main')
  const header = make('header', main, 'tb-header')
  const heading = make('div', header)
  const title = make('h2', heading)
  const subtitle = make('p', heading, 'tb-hint')
  const status = make('p', header, 'tb-status')
  status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true')
  const sync = make('div', main, 'tb-actions tb-sync')
  const retry = button(sync, 'retry', () => editor.status === 'read-error' ? void editor.read() : commit())
  const accept = button(sync, 'remote', () => void editor.resolve(false))
  const keep = button(sync, 'mine', () => void editor.resolve(true), 'tb-primary')
  const reducedNotice = make('div', main, 'tb-card tb-warn')
  reducedNotice.setAttribute('role', 'alert')
  text(make('p', reducedNotice), 'reducedActive')
  button(reducedNotice, 'reducedUnlock', () => { edit({ respectReducedTransparency: false }); commit() }, 'tb-primary')
  reducedNotice.hidden = true
  const scheduledNotice = make('div', main, 'tb-card tb-schedule-notice')
  const scheduleLabel = make('p', scheduledNotice)
  scheduleLabel.setAttribute('aria-live', 'polite')
  const pauseSchedule = button(scheduledNotice, 'pauseSchedule', () => {
    edit({ schedule: { ...current().schedule, enabled: false } })
    commit()
  })
  scheduledNotice.hidden = true
  const panels = Object.fromEntries(TABS.map(key => {
    const node = make('section', main, 'tb-panel')
    node.id = `${ui.prefix}-${key}`; node.setAttribute('role', 'tabpanel')
    node.setAttribute('aria-labelledby', `${node.id}-tab`); node.dataset.tbTab = key
    return [key, node]
  })) as Record<Tab, HTMLElement>
  const tabButtons = TABS.map((key, i) => {
    const node = make('button', tabs)
    node.type = 'button'; node.id = `${panels[key].id}-tab`; node.dataset.tbNav = key
    node.setAttribute('role', 'tab'); node.setAttribute('aria-controls', panels[key].id)
    make('span', node, 'tb-tab-icon').setAttribute('aria-hidden', 'true')
    text(make('span', node), key)
    on(node, 'click', () => switchTab(key))
    on(node, 'keydown', event => {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 :
        event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (i + 1) % TABS.length :
          event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1
      if (next < 0) return
      event.preventDefault(); switchTab(TABS[next]); tabButtons[next].focus()
    })
    return node
  })
  const responsive = new ResizeObserver(([entry]) => {
    const axis = entry.contentRect.width < 735 ? 'horizontal' : 'vertical'
    page.dataset.tbAxis = axis
    tabs.setAttribute('aria-orientation', axis)
  })
  responsive.observe(page)
  const message = make('div', page, 'tb-toast')
  message.hidden = true; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite')
  let toastTimer: number | undefined
  function toast(key: Key) {
    if (signal.aborted) return
    text(message, key); message.hidden = false
    win.clearTimeout(toastTimer)
    toastTimer = win.setTimeout(() => { message.hidden = true }, 3600)
  }
  const media = createMediaStore()
  const library = mediaPage(ui, panels.font, panels.background, signal, media, current, edit, editor.flush, locked, (id, op) => {
    notices.send({ type: 'media-changed', id, op }); background.retry(id); library.changed(id)
  }, render, toast)
  const background = backgroundPage(ui, panels.background, signal, media, library, current, edit, commit, locked,
    poolId => notices.send({ type: 'rotation-changed', poolId }), toast,
    () => scheduledConfig(editor.confirmed ?? current(), systemScheme()).config)
  const colors = colorsPage(ui, panels.colors, patch => edit({ ...patch, activeProfile: null }), locked, commit, background.capture, toast)
  const surfaces = interfacePage(ui, panels.interface, signal, current, edit, commit, locked, toast)
  const profiles = profilesPage(ui, panels.profiles, signal, current, edit, editor.flush, toast, locked)
  function switchTab(next: Tab) {
    if (tab === next) return
    commit(); tab = next
    if (tab === 'background' || tab === 'font') void library.refresh()
    render()
  }
  function render() {
    if (!initialized || signal.aborted) return
    const draft = current(), readOnly = locked()
    TABS.forEach((key, i) => {
      const active = key === tab
      panels[key].hidden = !active; tabButtons[i].tabIndex = active ? 0 : -1
      tabButtons[i].setAttribute('aria-selected', String(active))
    })
    if (title.dataset.tbText !== tab) { text(title, tab); text(subtitle, `${tab}Hint` as Key) }
    const dirty = ['unsaved', 'saving'].includes(editor.status)
    const error = ['failed', 'read-error', 'version', 'format', 'changed', 'conflict'].includes(editor.status)
    if (status.dataset.tbText !== editor.status) text(status, editor.status)
    status.dataset.tbStatus = error ? 'error' : dirty ? 'pending' : 'ready'
    retry.hidden = !['failed', 'read-error'].includes(editor.status)
    keep.hidden = accept.hidden = !editor.hasConflicts || readOnly
    sync.hidden = retry.hidden && keep.hidden
    reducedNotice.hidden = !(draft.respectReducedTransparency && reduced.matches)
    const profile = editor.confirmed && !readOnly ? scheduledConfig(editor.confirmed, systemScheme()).profile : undefined
    scheduledNotice.hidden = !profile
    pauseSchedule.disabled = !draft.schedule.enabled
    const description = profile ? ui.t('scheduledNotice').replace('{name}', profile.name) : ''
    if (scheduleLabel.textContent !== description) scheduleLabel.textContent = description
    colors(draft, readOnly); surfaces(draft, readOnly); profiles(draft, readOnly)
    library.render(draft, readOnly); background.render(draft, readOnly, tab === 'background')
  }
  const offLocale = api.onLocaleChange(locale => { ui.localize(locale); render() })
  const offScheme = api.onColorSchemeChange(render)
  system.addEventListener('change', render, { signal })
  reduced.addEventListener('change', render, { signal })
  const offFocus = watchFocus(doc, () => {
    void editor.read()
    if (tab === 'font' || tab === 'background') { void library.refresh(); background.syncRotation(current().rotation.poolId) }
    render()
  })
  const scheduleTimer = win.setInterval(() => {
    if (doc.visibilityState === 'visible' && editor.confirmed?.schedule.enabled) render()
  }, 30000)
  function dispose() {
    if (signal.aborted) return
    lifetime.abort()
    api.signal.removeEventListener('abort', dispose)
    responsive.disconnect()
    editor.dispose(); notices.close(); media.close()
    offLocale(); offScheme(); offFocus()
    win.clearTimeout(toastTimer); win.clearInterval(scheduleTimer)
    page.remove()
  }
  api.signal.addEventListener('abort', dispose, { once: true })
  initialized = true; render(); void editor.read()
  return dispose
}

function interfacePage(ui: Ui, panel: HTMLElement, signal: AbortSignal, current: () => ThemeConfig,
  edit: (patch: Partial<ThemeConfig>) => void, save: () => void, locked: () => boolean, toast: (key: Key) => void) {
  const { make, card, text, slider, check, select, on, input, button } = ui
  const fields = make('fieldset', panel, 'tb-interface')
  const grid = make('div', fields, 'tb-surface-grid')
  const controls = SURFACES.map(part => {
    const tile = card(grid, part, 'tb-surface-card')
    const alpha = slider(tile, 'surfaceOpacity', 0, 100, 5, value => edit({ opacities: { ...current().opacities, [part]: value }, respectReducedTransparency: false, activeProfile: null }))
    const frost = slider(tile, 'frost', 0, 40, 1, value => edit({ blurs: { ...current().blurs, [part]: value }, respectReducedTransparency: false, activeProfile: null }))
    const changeStroke = (patch: Partial<ThemeConfig['strokes'][typeof part]>) => edit({
      strokes: { ...current().strokes, [part]: { ...current().strokes[part], ...patch } }, activeProfile: null,
    })
    const width = slider(tile, 'stroke', 0, 4, 0.5, width => changeStroke({ width }))
    const colors = make('div', tile, 'tb-form-grid')
    const strokeColor = select(colors, 'strokeColor', STROKE_COLORS, { auto: 'strokeAuto' })
    const custom = input(colors, 'customColor', 'color')
    on(strokeColor, 'change', () => { changeStroke({ color: strokeColor.value as typeof STROKE_COLORS[number] }); save() })
    on(custom, 'input', () => changeStroke({ customColor: custom.value }))
    on(custom, 'change', save)
    return { alpha, frost, width, strokeColor, custom }
  })
  const policy = card(fields)
  const respect = check(policy, 'reduced', value => edit({ respectReducedTransparency: value }))
  text(make('p', policy, 'tb-hint'), 'reducedHint')
  button(policy, 'restoreInterface', async () => {
    if (!await ui.confirm('restoreInterface', 'resetPrompt') || signal.aborted || locked()) return
    edit({ opacities: DEFAULT.opacities, blurs: DEFAULT.blurs, strokes: DEFAULT.strokes,
      respectReducedTransparency: DEFAULT.respectReducedTransparency, activeProfile: null })
    save(); toast('restored')
  })
  return (draft: ThemeConfig, readOnly: boolean) => {
    fields.disabled = readOnly; respect.checked = draft.respectReducedTransparency
    SURFACES.forEach((part, i) => {
      const { alpha, frost, width, strokeColor, custom } = controls[i], stroke = draft.strokes[part]
      alpha.set(draft.opacities[part]); frost.set(draft.blurs[part]); width.set(stroke.width)
      strokeColor.value = stroke.color
      custom.value = stroke.customColor; custom.parentElement!.hidden = stroke.color !== 'custom'
    })
  }
}
