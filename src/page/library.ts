import { DEFAULT, MAX_ROTATION_ITEMS, VIDEO_MIMES } from '../shared/config.ts'
import type { ThemeConfig } from '../shared/config.ts'
import { createFontLoader, validateFont } from '../shared/font-loader.ts'
import type { FontState } from '../shared/font-loader.ts'
import { IMAGE_MIMES, validateImage, validateVideo, withMime } from '../shared/media-db.ts'
import type { MediaRecord, MediaStore, MediaSummary } from '../shared/media-db.ts'
import { uuid } from '../shared/sync.ts'
import type { Key } from './i18n.ts'
import { preserveFocus } from './ui.ts'
import type { Ui } from './ui.ts'

const KINDS = ['image', 'video', 'font'] as const
type Kind = typeof KINDS[number]
export type Ref = { id: string; kind: Kind; mime?: string }
const captions = { image: 'image', video: 'videos', font: 'fonts' } as const
const accepts = { image: '.jpg,.jpeg,.png,.webp,.gif,.avif,' + IMAGE_MIMES.join(','), video: '.mp4,.webm,' + VIDEO_MIMES.join(','), font: '.woff2,.woff,.ttf,.otf,.ttc,.otc' }
const errors: Record<string, Key> = { SizeError: 'sizeError', MimeError: 'mimeError', EncodingError: 'encodingError', CollectionError: 'fontCollection',
  QuotaExceededError: 'quota', BlockedError: 'blocked', ConstraintError: 'duplicate' }
const size = (n: number) => n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${Math.max(1, Math.ceil(n / 1024))} KiB`

export function mediaPage(ui: Ui, fontPanel: HTMLElement, bgPanel: HTMLElement, signal: AbortSignal, store: MediaStore,
  config: () => ThemeConfig, edit: (patch: Partial<ThemeConfig>) => void, commit: () => Promise<boolean>, locked: () => boolean,
  changed: (id: string, op: 'put' | 'delete') => void, repaint: () => void, toast: (key: Key) => void) {
  const { make, on, text, button, check, card } = ui
  const details = make('details', bgPanel, 'tb-card tb-library')
  text(make('summary', details), 'localMedia')
  text(make('p', details, 'tb-hint'), 'localHint')
  const missing = make('div', details, 'tb-list')
  const list = make('div', details, 'tb-list')
  const footer = make('div', details, 'tb-actions')
  const clear = button(footer, 'clear', () => void run(async () => {
    if (!await ui.confirm('clear', 'clearPrompt') || signal.aborted) return
    const removed = await store.clear()
    if (signal.aborted) return
    for (const id of removed) changed(id, 'delete')
    await refresh(); toast('mediaDeleted')
  }))
  button(footer, 'retry', () => void refresh())
  const fonts = make('fieldset', fontPanel, 'tb-card')
  const fontStatus = make('p', fonts, 'tb-hint')
  fontStatus.setAttribute('aria-live', 'polite')
  const enabled = check(fonts, 'fontEnable', enabled => edit({ font: { ...config().font, enabled }, activeProfile: null }))
  const actions = make('div', fonts, 'tb-actions')
  const unlink = button(actions, 'fontRemove', () => { edit({ font: DEFAULT.font, activeProfile: null }); void commit() })
  const fontLink = button(actions, 'associate', () => {
    const { mediaId, mime } = config().font
    if (mediaId && mime) choose('font', 'link', { kind: 'font', id: mediaId, mime })
  })
  const preview = card(fontPanel, 'fontPreview', 'tb-font-preview')
  const sample = make('div', preview, 'tb-typography')
  text(make('strong', sample), 'headlineSample'); text(make('p', sample), 'bodySample')
  make('code', make('pre', preview)).textContent = 'const canvas = new Theme();\ncanvas.makeItYours();'
  const picker = make('div', bgPanel)
  picker.hidden = true
  const files = Object.fromEntries([...KINDS, 'pool'].map(kind => {
    const file = make('input', picker)
    file.type = 'file'; file.accept = accepts[kind === 'pool' ? 'image' : kind as Kind]
    file.multiple = kind === 'pool'; file.dataset.tbUpload = kind
    return [kind, file]
  })) as Record<Kind | 'pool', HTMLInputElement>
  let busy = false, loaded = false, ticket = 0, rows: MediaSummary[] = [], listKey = '', fontState: FontState = 'idle'
  let pending: { kind: Kind | 'pool'; intent: 'use' | 'pool' | 'link'; ref?: Ref } | undefined
  const family = ui.prefix.replaceAll('-', '')
  const font = createFontLoader(ui.doc, signal, id => store.get(id), state => { fontState = state; drawFont(config()) }, family)
  const uploadButtons: HTMLButtonElement[] = []
  upload(fonts, 'font', 'fontUpload', 'fontRules')
  function upload(parent: HTMLElement, kind: Kind | 'pool', title: Key, hint: Key) {
    const stage = make('div', parent, 'tb-upload')
    const file = button(stage, title, () => choose(kind, kind === 'pool' ? 'pool' : 'use'))
    uploadButtons.push(file)
    text(make('small', stage), hint)
    on(stage, 'dragover', event => {
      if (locked() || busy || !event.dataTransfer?.types.includes('Files')) return
      event.preventDefault(); stage.setAttribute('data-tb-dragging', '')
    })
    on(stage, 'dragleave', event => { if (!stage.contains(event.relatedTarget as Node | null)) stage.removeAttribute('data-tb-dragging') })
    on(stage, 'drop', event => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault(); stage.removeAttribute('data-tb-dragging')
      if (!locked() && !busy) void receive([...event.dataTransfer.files], { kind, intent: kind === 'pool' ? 'pool' : 'use' })
    })
    return stage
  }
  function choose(kind: Kind | 'pool', intent: 'use' | 'pool' | 'link', ref?: Ref) {
    if (locked() || busy) return
    pending = { kind, intent, ref }
    files[kind].value = ''; files[kind].click()
  }
  for (const file of Object.values(files)) on(file, 'change', () => {
    const picked = [...file.files ?? []], job = pending ?? { kind: file.dataset.tbUpload as Kind | 'pool', intent: file.multiple ? 'pool' : 'use' }
    pending = undefined; file.value = ''
    if (picked.length) void receive(picked, job)
  })
  function apply(row: MediaSummary) {
    if (signal.aborted || locked()) return
    if (row.kind === 'font') edit({ font: { enabled: true, mediaId: row.id, mime: row.mime as ThemeConfig['font']['mime'] }, activeProfile: null })
    else if (row.kind === 'video') edit({ source: { kind: 'local-video', id: row.id, mime: row.mime as typeof VIDEO_MIMES[number] }, respectReducedTransparency: false, activeProfile: null })
    else edit({ source: { kind: 'local-image', id: row.id }, respectReducedTransparency: false, activeProfile: null })
    void commit()
  }
  async function receive(picked: File[], job: NonNullable<typeof pending>) {
    if (locked()) return
    await run(async () => {
      const kind = job.kind === 'pool' ? 'image' : job.kind
      const free = Math.max(0, MAX_ROTATION_ITEMS - config().rotation.items.length)
      const batch = picked.slice(0, job.intent === 'pool' ? free : 1)
      if (!batch.length) { toast('poolFull'); return }
      const stored: MediaRecord[] = []
      let failure: unknown
      for (const file of batch) {
        try {
          signal.throwIfAborted()
          const mime = kind === 'font' ? await validateFont(file, ui.doc, signal) : kind === 'video' ? await validateVideo(file, ui.doc, signal) :
            await validateImage(file, ui.doc, signal)
          if (job.ref?.mime && job.ref.mime !== mime) throw new DOMException('Reference MIME does not match', 'MimeError')
          const item = { id: job.ref?.id ?? uuid(), kind, mime, name: file.name.slice(0, 240), size: file.size, createdAt: Date.now(), blob: withMime(file, mime) }
          await store.put(item)
          if (signal.aborted) return
          stored.push(item)
          changed(item.id, 'put')
        } catch (error) { failure ??= error }
      }
      if (signal.aborted) return
      if (stored.length && !locked()) {
        if (job.intent === 'use') apply(stored[0])
        else if (job.intent === 'pool') {
          const pool = config().rotation
          edit({ rotation: { ...pool, items: [...pool.items, ...stored.map(item => item.id)].slice(0, MAX_ROTATION_ITEMS) },
            source: { kind: 'rotation', poolId: pool.poolId }, respectReducedTransparency: false, activeProfile: null })
          void commit()
        }
      }
      await refresh()
      if (failure) throw failure
      toast(job.intent === 'pool' && picked.length > free ? 'poolFull' : 'mediaSaved')
    })
  }
  async function run(job: () => Promise<void>) {
    if (busy || signal.aborted) return
    busy = true; repaint()
    try { await job() } catch (error) {
      if (!signal.aborted) toast(error instanceof DOMException ? errors[error.name] ?? 'storageError' : 'storageError')
    } finally { if (!signal.aborted) { busy = false; repaint() } }
  }
  async function refresh() {
    const now = ++ticket
    try {
      const local = (await Promise.all(KINDS.map(kind => store.list(kind)))).flat()
      if (signal.aborted || now !== ticket) return
      loaded = true; rows = local; repaint()
    } catch { if (!signal.aborted && now === ticket) toast('storageError') }
  }
  on(details, 'toggle', () => { if (details.open) void refresh() })
  const references = (config: ThemeConfig): Ref[] => {
    const refs: Ref[] = []
    for (const { source, font } of [config, ...config.profiles]) {
      if (source?.kind === 'local-image') refs.push({ id: source.id, kind: 'image' })
      if (source?.kind === 'local-video') refs.push({ id: source.id, kind: 'video', mime: source.mime })
      if (font?.mediaId) refs.push({ id: font.mediaId, kind: 'font', mime: font.mime ?? undefined })
    }
    refs.push(...config.rotation.items.map(id => ({ id, kind: 'image' as const })))
    return [...new Map(refs.map(ref => [`${ref.kind}:${ref.id}:${ref.mime ?? ''}`, ref])).values()]
  }
  function drawFont(config: ThemeConfig) {
    const { mediaId, enabled: useFont } = config.font
    const row = rows.find(item => item.id === mediaId)
    const absent = fontState === 'missing' || !!mediaId && loaded && !row
    const status = { idle: 'fontIdle', loading: 'fontLoading', ready: 'fontReady', missing: 'missing', error: 'fontError' } as const
    fontStatus.textContent = [row?.name, ui.t(absent ? 'missing' : status[fontState])].filter(Boolean).join(' · ')
    enabled.checked = useFont
    enabled.disabled = !mediaId || busy
    fontLink.hidden = !absent
    fontLink.disabled = busy
    unlink.disabled = !mediaId || busy
    sample.style.fontFamily = fontState === 'ready' ? `${family}, system-ui, sans-serif` : ''
  }
  function rowButton(parent: HTMLElement, ref: Ref, key: Key, run: () => void, disabled = false) {
    const node = button(parent, key, run)
    node.dataset.tbFocus = `${ref.id}-${key}`
    node.disabled = disabled
  }
  function drawLibrary(current: ThemeConfig) {
    const refs = references(current)
    const key = JSON.stringify([rows, refs, busy, locked(), loaded])
    if (key === listKey) return
    listKey = key
    const absent = loaded ? refs.filter(ref => !rows.some(row => row.id === ref.id && row.kind === ref.kind && (!ref.mime || ref.mime === row.mime))) : []
    preserveFocus(missing, () => {
      missing.replaceChildren()
      for (const ref of absent) {
        const row = make('div', missing, 'tb-list-row')
        const name = make('div', row)
        text(make('strong', name), 'missing'); make('small', name, 'tb-code').textContent = ref.id
        rowButton(row, ref, 'associate', () => choose(ref.kind, 'link', ref), busy || locked())
      }
    })
    preserveFocus(list, () => {
      list.replaceChildren()
      if (!rows.length && loaded) text(make('p', list, 'tb-hint'), 'empty')
      for (const kind of KINDS) {
        const matches = rows.filter(row => row.kind === kind)
        if (!matches.length) continue
        text(make('h4', list), captions[kind])
        for (const item of matches) {
          const row = make('div', list, 'tb-list-row')
          const info = make('div', row)
          make('strong', info).textContent = item.name
          make('small', info).textContent = `${item.mime} · ${size(item.size)}`
          const actions = make('div', row, 'tb-actions')
          const selected = current.font.mediaId === item.id || ('id' in current.source && current.source.id === item.id)
          rowButton(actions, item, selected ? 'selected' : 'apply', () => apply(item), busy || locked() || selected)
          rowButton(actions, item, 'libraryDelete', () => void run(async () => {
            if (!await ui.confirm('libraryDelete', 'deletePrompt') || signal.aborted) return
            await store.remove(item.id)
            if (!signal.aborted) { changed(item.id, 'delete'); await refresh(); toast('mediaDeleted') }
          }), busy)
        }
      }
    })
  }
  return {
    upload, choose, refresh, apply,
    link(ref: Ref) { choose(ref.kind, 'link', ref) },
    changed(id: string) { if (config().font.mediaId === id) font.retry() },
    get rows() { return rows },
    get loaded() { return loaded },
    render(config: ThemeConfig, readOnly: boolean) {
      fonts.disabled = readOnly
      drawFont(config)
      clear.disabled = busy || !rows.length
      for (const node of uploadButtons) node.disabled = busy || readOnly
      font.update(config.font)
      if (details.open) drawLibrary(config)
    },
    open() { details.open = true; void refresh(); details.scrollIntoView({ block: 'nearest' }) },
  }
}
