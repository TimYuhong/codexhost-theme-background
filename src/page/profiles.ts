import { clamp, exportConfig, FONT_PRESETS, HEX, importConfig, LAYOUTS, MAX_PROFILE_NAME, MAX_PROFILES, MAX_SETTINGS, NATIVE_DEFAULT, PATTERNS, PRESET_ASSET_PATH, profileOverrides, profileSnapshot, publicImageUrl, randomSeed, readAppearance, readSource, SCHEMES, SHADERS, SURFACES, VIDEO_MIMES } from '../shared/config.ts'
import type { Appearance, BuiltinBackdrop, FontPreset, Layout, Placement, Profile, Source, ThemeConfig, ThemeFont } from '../shared/config.ts'
import { validateFont } from '../shared/font-loader.ts'
import { IMAGE_MIMES, validateImage, validateVideo, withMime } from '../shared/media-db.ts'
import type { MediaRecord, MediaStore, MediaSummary } from '../shared/media-db.ts'
import { extractWallpaperColor, FONT_STACKS, hexToRgb, hslToHsv, hslToRgb, hsvToHsl, rgbToHex, rgbToHsl } from '../shared/palette.ts'
import { uuid } from '../shared/sync.ts'
import { loadVideoFrame, prepareVideo, releaseVideo } from '../shared/video.ts'
import type { Key } from './i18n.ts'
import { preserveFocus } from './ui.ts'
import type { Ui } from './ui.ts'

export type BuiltinTheme = {
  readonly name: BuiltinBackdrop
  readonly description: Key
  readonly accent: string
  readonly schemeOverride: 'light' | 'dark'
  readonly opacities: ThemeConfig['opacities']
  readonly blurs: ThemeConfig['blurs']
  readonly opacity: number
  readonly blur?: number
  readonly font: Exclude<FontPreset, 'system'>
}

const FONT_LABELS: Record<FontPreset, Key> = {
  system: 'fontSystem',
  modern: 'fontModern',
  clean: 'fontClean',
  editorial: 'fontEditorial',
  literary: 'fontLiterary',
  calligraphy: 'fontCalligraphy',
  tech: 'fontTech',
}

const EDITOR_SWATCHES = ['#6888d8', '#3da58a', '#e5a952', '#e07a6b', '#b5567c', '#8b73dc', '#4b9cd3', '#c87e42', '#709c5a', '#7c8594'] as const
const MEDIA_ERRORS: Record<string, Key> = {
  SizeError: 'sizeError',
  MimeError: 'mimeError',
  EncodingError: 'encodingError',
  CollectionError: 'fontCollection',
  QuotaExceededError: 'quota',
  BlockedError: 'blocked',
  ConstraintError: 'duplicate',
}
const ACCEPT = {
  image: '.jpg,.jpeg,.png,.webp,.gif,.avif,' + IMAGE_MIMES.join(','),
  video: '.mp4,.webm,' + VIDEO_MIMES.join(','),
  font: '.woff2,.woff,.ttf,.otf,.ttc,.otc',
} as const
const WHEEL_SIZE = 160, WHEEL_CENTER = WHEEL_SIZE / 2, WHEEL_OUTER = 74, WHEEL_INNER = 60, WHEEL_HALF = 40, TAU = Math.PI * 2
const FALLBACK_COLOR = '#6888d8'

type EditorBgTab = 'local' | 'url' | 'video' | 'dynamic' | 'none'
const BG_TABS: readonly { id: EditorBgTab; key: Key }[] = [
  { id: 'local', key: 'editorBgLocal' },
  { id: 'url', key: 'editorBgUrl' },
  { id: 'video', key: 'editorBgVideo' },
  { id: 'dynamic', key: 'editorBgDynamic' },
  { id: 'none', key: 'none' },
]
const DYNAMIC_KINDS = ['mesh', 'shader', 'pattern'] as const
const colorFromHsv = (h: number, s: number, v: number) => rgbToHex(hslToRgb(...hsvToHsl(h, s, v)))
const formatBytes = (n: number) => n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${Math.max(1, Math.ceil(n / 1024))} KiB`

export const builtIn: readonly BuiltinTheme[] = [
  {
    name: 'default', description: 'defaultDesc', accent: '#00ef07', schemeOverride: 'dark',
    opacities: { bg: 25, sidebar: 0, card: 50, input: 85, settings: 90 },
    blurs: { bg: 0, sidebar: 0, card: 0, input: 0, settings: 18 },
    opacity: 100, font: 'modern',
  },
  {
    name: 'forest', description: 'forestDesc', accent: '#e5a952', schemeOverride: 'dark',
    opacities: { bg: 25, sidebar: 0, card: 70, input: 85, settings: 90 },
    blurs: { bg: 0, sidebar: 0, card: 0, input: 0, settings: 18 },
    opacity: 100, font: 'modern',
  },
  {
    name: 'minimal', description: 'minimalDesc', accent: '#a85d26', schemeOverride: 'light',
    opacities: { bg: 35, sidebar: 15, card: 75, input: 85, settings: 90 },
    blurs: { bg: 0, sidebar: 0, card: 0, input: 0, settings: 18 },
    opacity: 100, font: 'editorial',
  },
  {
    name: 'glass', description: 'glassDesc', accent: '#9e4260', schemeOverride: 'light',
    opacities: { bg: 30, sidebar: 15, card: 70, input: 80, settings: 90 },
    blurs: { bg: 0, sidebar: 0, card: 0, input: 0, settings: 18 },
    opacity: 100, font: 'clean',
  },
] as const

export function presetPatch(preset: BuiltinTheme, currentFont: ThemeConfig['font'] = NATIVE_DEFAULT.font): Partial<ThemeConfig> {
  return {
    ...readAppearance(preset),
    source: { kind: 'preset', id: preset.name },
    placement: { ...NATIVE_DEFAULT.placement },
    font: { enabled: false, mediaId: currentFont.mediaId, mime: currentFont.mime, preset: preset.font },
    respectReducedTransparency: false,
    activeProfile: null,
  }
}

export type CustomProfileDraft = {
  name: string
  appearance: Appearance
  source: Source
  placement: Placement
  videoPlacement: Placement
  font: ThemeFont
}

export function blankCustomDraft(): CustomProfileDraft {
  return {
    name: '',
    appearance: readAppearance({
      accent: null,
      schemeOverride: 'auto',
      opacities: { bg: 25, sidebar: 0, card: 70, input: 85, settings: 90 },
      blurs: { bg: 0, sidebar: 0, card: 0, input: 0, settings: 18 },
      opacity: 100,
      blur: 0,
    }),
    source: { kind: 'none' },
    placement: { ...NATIVE_DEFAULT.placement },
    videoPlacement: { ...NATIVE_DEFAULT.videoPlacement },
    font: { ...NATIVE_DEFAULT.font },
  }
}

export function upsertCustomProfile(profiles: readonly Profile[], draft: CustomProfileDraft, existingId?: string, now = Date.now()): { profiles: Profile[]; profile: Profile } | null {
  const name = draft.name.trim().slice(0, MAX_PROFILE_NAME)
  if (!name) return null
  const current = existingId ? profiles.find(item => item.id === existingId) : undefined
  if (!current && profiles.length >= MAX_PROFILES) return null
  const profile: Profile = {
    id: current?.id ?? uuid(),
    name,
    createdAt: current?.createdAt ?? now,
    appearance: readAppearance(draft.appearance),
    source: structuredClone(draft.source),
    placement: structuredClone(draft.placement),
    videoPlacement: structuredClone(draft.videoPlacement),
    font: structuredClone(draft.font),
  }
  const next = current ? profiles.map(item => item.id === current.id ? profile : item) : [...profiles, profile]
  return { profiles: next, profile }
}

function matchesPreset(config: ThemeConfig, preset: BuiltinTheme) {
  return !config.activeProfile &&
    config.source.kind === 'preset' && config.source.id === preset.name &&
    config.accent === preset.accent && config.schemeOverride === preset.schemeOverride &&
    !config.font.enabled && config.font.preset === preset.font
}

function sourceLabelKey(source: Source): Key {
  switch (source.kind) {
    case 'none': return 'none'
    case 'preset': return 'preset'
    case 'url': return 'editorBgUrl'
    case 'local-image': return 'editorBgLocal'
    case 'local-video': return 'editorBgVideo'
    case 'mesh': return 'mesh'
    case 'shader': return 'shader'
    case 'pattern': return 'pattern'
    case 'rotation': return 'rotation'
  }
}

function fontLabelKey(font?: ThemeFont): Key {
  if (!font) return 'fontSystem'
  if (font.enabled && font.mediaId) return 'fontLocalTag'
  return FONT_LABELS[font.preset ?? 'system']
}

function previewBaseColor(source: Source | undefined, scheme: Appearance['schemeOverride']): string {
  if (source?.kind === 'preset') {
    const map: Record<BuiltinBackdrop, string> = { default: '#18294a', forest: '#1f3c2d', minimal: '#7c8d9c', glass: '#b8cbed' }
    return map[source.id]
  }
  return scheme === 'light' ? '#dce3ee' : '#1b2029'
}

function effectTagFor(source: Source | undefined): string {
  if (!source) return ''
  if (source.kind === 'mesh') return 'mesh'
  if (source.kind === 'shader' || source.kind === 'pattern') return source.preset
  return ''
}

function tabForSource(source: Source): EditorBgTab {
  switch (source.kind) {
    case 'local-image': return 'local'
    case 'url': return 'url'
    case 'local-video': return 'video'
    case 'mesh':
    case 'shader':
    case 'pattern': return 'dynamic'
    case 'none': return 'local'
    default: return 'local'
  }
}

function objectFitFor(mode: Layout): string {
  if (mode === 'fit') return 'contain'
  if (mode === 'stretch') return 'fill'
  return 'cover'
}

export function profilesPage(ui: Ui, panel: HTMLElement, signal: AbortSignal, current: () => ThemeConfig, edit: (changes: Partial<ThemeConfig>) => void,
  commit: () => Promise<boolean>, toast: (key: Key) => void, isLocked: () => boolean,
  assetUrl: (path: string) => Promise<string | undefined> = async () => undefined,
  media?: MediaStore, onMediaChanged?: (id: string, op: 'put' | 'delete') => void,
  thumbUrl: (path: string) => Promise<string | undefined> = assetUrl) {
  const { make, card, text, button, on, check, select, input, value, label } = ui

  // ── 1. Built-in 4 curated theme suites (one-click only, no customizing) ─────
  const presets = make('fieldset', panel, 'tb-card')
  const presetHeader = make('div', presets, 'tb-preset-header')
  const presetTitle = make('div', presetHeader)
  text(make('h3', presetTitle), 'presets')
  text(make('p', presetTitle, 'tb-hint'), 'presetsHint')
  const restoreHost = button(presetHeader, 'restoreHost', async () => {
    const font = current().font
    edit({
      ...readAppearance(NATIVE_DEFAULT),
      source: NATIVE_DEFAULT.source,
      placement: { ...NATIVE_DEFAULT.placement },
      font: { enabled: false, mediaId: font.mediaId, mime: font.mime },
      respectReducedTransparency: NATIVE_DEFAULT.respectReducedTransparency,
      activeProfile: null,
    })
    if (await commit()) toast('restored')
  })
  const gallery = make('div', presets, 'tb-presets')
  const tiles: { preset: BuiltinTheme; tile: HTMLElement; apply: HTMLButtonElement; photo: HTMLImageElement }[] = []
  for (const preset of builtIn) {
    const tile = make('div', gallery, `tb-preset tb-preset-${preset.name}`)
    tile.dataset.tbScheme = preset.schemeOverride
    tile.style.setProperty('--tb-preset-accent', preset.accent)
    const swatch = make('div', tile, 'tb-preset-art')
    const photo = make('img', swatch, 'tb-preset-img')
    photo.alt = ''
    photo.hidden = true
    photo.loading = 'lazy'
    photo.decoding = 'async'
    const mini = make('div', swatch, 'tb-preset-mini')
    mini.setAttribute('aria-hidden', 'true')
    make('span', mini, 'tb-mini-side')
    const miniMain = make('div', mini, 'tb-mini-main')
    make('span', miniMain, 'tb-mini-bar')
    make('span', miniMain, 'tb-mini-line')
    const badge = text(make('span', swatch, 'tb-preset-badge'), preset.schemeOverride)
    badge.dataset.tbScheme = preset.schemeOverride
    const head = make('div', tile, 'tb-preset-head')
    make('span', head, 'tb-preset-dot').setAttribute('aria-hidden', 'true')
    text(make('strong', head), preset.name)
    const meta = make('div', tile, 'tb-preset-tags')
    text(make('span', meta, 'tb-preset-tag'), 'preset')
    const fontChip = text(make('span', meta, 'tb-preset-tag tb-preset-font'), FONT_LABELS[preset.font])
    fontChip.style.fontFamily = FONT_STACKS[preset.font]
    text(make('small', tile), preset.description)
    const use = button(tile, 'apply', async () => {
      edit(presetPatch(preset, current().font))
      if (await commit()) toast('presetApplied')
    })
    use.dataset.tbPreset = preset.name
    tiles.push({ preset, tile, apply: use, photo })
  }
  let builtinThumbsLoaded = false
  function loadBuiltinThumbs() {
    if (builtinThumbsLoaded) return
    builtinThumbsLoaded = true
    for (const { preset, photo } of tiles) {
      void thumbUrl(PRESET_ASSET_PATH(preset.name)).then(url => {
        if (!url || signal.aborted || !photo.isConnected) return
        photo.src = url
        photo.hidden = false
      })
    }
  }

  // ── 2. Independent Custom Themes Gallery ────────────────────────────────────
  const profiles = make('fieldset', panel, 'tb-card')
  const customHeader = make('div', profiles, 'tb-preset-header')
  const customTitle = make('div', customHeader)
  text(make('h3', customTitle), 'customProfiles')
  text(make('p', customTitle, 'tb-hint'), 'customProfilesHint')
  const customHeaderActions = make('div', customHeader, 'tb-actions')
  const saveCurrentBtn = button(customHeaderActions, 'saveCurrentAsProfile', () => {
    void openEditor({ name: '', ...profileSnapshot(current()) })
  })
  saveCurrentBtn.dataset.tbSaveCurrentProfile = ''
  const createBtn = button(customHeaderActions, 'newProfile', () => void openEditor(blankCustomDraft()), 'tb-primary')
  const list = make('div', profiles, 'tb-presets tb-custom-presets')

  // ── 3. Schedule & Config Import/Export ──────────────────────────────────────
  const schedule = make('fieldset', panel, 'tb-card')
  text(make('h3', schedule), 'schedule')
  const enabled = check(schedule, 'scheduleEnable', enabled => changeSchedule({ enabled }))
  const options = make('div', schedule, 'tb-form-grid')
  const mode = select(options, 'scheduleMode', ['time', 'system'])
  const day = input(options, 'dayStart', 'time'), night = input(options, 'nightStart', 'time')
  const dayProfile = select(options, 'dayProfile', []), nightProfile = select(options, 'nightProfile', [])
  on(mode, 'change', () => { changeSchedule({ mode: mode.value === 'system' ? 'system' : 'time' }); void commit() })
  for (const [control, key] of [[day, 'dayStart'], [night, 'nightStart'], [dayProfile, 'dayProfile'], [nightProfile, 'nightProfile']] as const) on(control, 'change', () => {
    if (control.type === 'time' && !control.value) value(control as HTMLInputElement, current().schedule[key] ?? '')
    else { changeSchedule({ [key]: control.value || null }); void commit() }
  })
  const transfer = card(panel, 'config')
  text(make('p', transfer, 'tb-hint'), 'configHint')
  const actions = make('div', transfer, 'tb-actions')
  const download = button(actions, 'export', downloadConfig)
  const upload = button(actions, 'import', () => { jsonFile.value = ''; jsonFile.click() })
  const textTransfer = button(actions, 'jsonText', () => void transferText())
  const importError = make('p', transfer, 'tb-error')
  importError.setAttribute('role', 'alert')
  const jsonFile = make('input', transfer)
  jsonFile.type = 'file'; jsonFile.accept = 'application/json,.json'; jsonFile.hidden = true; jsonFile.dataset.tbUpload = 'config'
  const downloads = new Map<string, ReturnType<typeof setTimeout>>()
  let listKey = ''
  let cardThumbs: AbortController | undefined
  signal.addEventListener('abort', () => {
    cardThumbs?.abort()
    for (const url of downloads.keys()) releaseDownload(url)
  }, { once: true })

  function onRelease(life: AbortSignal, fn: () => void) {
    let done = false
    const run = () => {
      if (done) return
      done = true
      life.removeEventListener('abort', run)
      signal.removeEventListener('abort', run)
      fn()
    }
    if (life.aborted || signal.aborted) { run(); return }
    life.addEventListener('abort', run, { once: true })
    signal.addEventListener('abort', run, { once: true })
  }

  function attachThumb(photo: HTMLImageElement, videoNode: HTMLVideoElement | null, art: HTMLElement, source: Source | undefined, life: AbortSignal) {
    photo.hidden = true
    photo.removeAttribute('src')
    photo.onerror = null
    if (videoNode) {
      videoNode.hidden = true
      releaseVideo(videoNode)
    }
    const effect = effectTagFor(source)
    if (effect) art.dataset.tbEffect = effect
    else delete art.dataset.tbEffect
    if (!source) return
    if (source.kind === 'preset') {
      const resolvePreset = videoNode ? assetUrl : thumbUrl
      void resolvePreset(PRESET_ASSET_PATH(source.id)).then(url => {
        if (!url || life.aborted || signal.aborted || !photo.isConnected) return
        photo.src = url
        photo.hidden = false
      })
    } else if (source.kind === 'url') {
      photo.referrerPolicy = 'no-referrer'
      photo.onerror = () => { photo.hidden = true }
      photo.src = source.url
      photo.hidden = false
    } else if (source.kind === 'local-image' && media) {
      void media.backgroundBlob(source.id, 'image').then(blob => {
        if (!blob || life.aborted || signal.aborted || !photo.isConnected) return
        const url = URL.createObjectURL(blob)
        onRelease(life, () => { photo.removeAttribute('src'); URL.revokeObjectURL(url) })
        photo.src = url
        photo.hidden = false
      }).catch(() => {})
    } else if (source.kind === 'rotation' && media) {
      const firstId = current().rotation.items[0]
      if (firstId) {
        void media.backgroundBlob(firstId, 'image').then(blob => {
          if (!blob || life.aborted || signal.aborted || !photo.isConnected) return
          const url = URL.createObjectURL(blob)
          onRelease(life, () => { photo.removeAttribute('src'); URL.revokeObjectURL(url) })
          photo.src = url
          photo.hidden = false
        }).catch(() => {})
      }
    } else if (source.kind === 'local-video' && media) {
      void media.backgroundBlob(source.id, 'video', source.mime).then(async blob => {
        if (!blob || life.aborted || signal.aborted) return
        if (videoNode) {
          if (!videoNode.isConnected) return
          const url = URL.createObjectURL(blob)
          onRelease(life, () => { releaseVideo(videoNode); URL.revokeObjectURL(url) })
          const reducedMotion = !!ui.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          videoNode.muted = videoNode.defaultMuted = videoNode.loop = videoNode.playsInline = true
          videoNode.autoplay = !reducedMotion
          videoNode.src = url
          videoNode.hidden = false
          if (!reducedMotion) void videoNode.play().catch(() => {})
          return
        }
        if (!photo.isConnected) return
        const video = prepareVideo(ui.doc), url = URL.createObjectURL(blob)
        const abort = AbortSignal.any([life, signal])
        try {
          await loadVideoFrame(video, url, abort)
          if (abort.aborted || !photo.isConnected || !video.videoWidth || !video.videoHeight) return
          const canvas = ui.doc.createElement('canvas')
          const ratio = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight))
          canvas.width = Math.max(1, Math.round(video.videoWidth * ratio))
          canvas.height = Math.max(1, Math.round(video.videoHeight * ratio))
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const poster = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.85))
          if (!poster || abort.aborted || !photo.isConnected) return
          const posterUrl = URL.createObjectURL(poster)
          onRelease(life, () => { photo.removeAttribute('src'); URL.revokeObjectURL(posterUrl) })
          photo.src = posterUrl
          photo.hidden = false
        } catch { /* Keep fallback gradient if frame capture fails. */ }
        finally { releaseVideo(video); URL.revokeObjectURL(url) }
      }).catch(() => {})
    }
  }

  function releaseDownload(url: string) {
    clearTimeout(downloads.get(url))
    downloads.delete(url)
    URL.revokeObjectURL(url)
  }
  function downloadConfig() {
    const url = URL.createObjectURL(new Blob([exportConfig(current())], { type: 'application/json' }))
    downloads.set(url, setTimeout(() => releaseDownload(url), 60000))
    const anchor = make('a', transfer)
    anchor.hidden = true; anchor.href = url; anchor.download = 'theme-background-config.json'
    try { anchor.click() } finally { anchor.remove() }
  }
  function parse(text: string, error: HTMLElement) {
    const result = importConfig(text)
    if (result.state === 'ready') { error.textContent = ''; return result.config }
    error.textContent = result.profile ? ui.t('invalidProfile').replace('{name}', result.profile) : ui.t('invalidImport')
    return undefined
  }
  async function confirmImport(config: ThemeConfig) {
    if (isLocked() || signal.aborted || !await ui.confirm('import', 'importPrompt') || isLocked() || signal.aborted) return
    edit(config)
    if (await commit()) toast('importReady')
  }
  async function transferText() {
    if (signal.aborted || isLocked()) return
    let config: ThemeConfig | undefined
    const accepted = await ui.dialog('jsonText', (dialog, finish) => {
      text(make('p', dialog, 'tb-hint'), 'jsonTextHint')
      const field = make('textarea', dialog, 'tb-code tb-json')
      field.value = exportConfig(current()); field.spellcheck = false; field.rows = 10
      label(field, 'jsonText')
      const error = make('p', dialog, 'tb-error')
      error.setAttribute('role', 'alert')
      const tools = make('div', dialog, 'tb-actions')
      const selectAll = () => { field.focus(); field.select() }
      button(tools, 'copyJson', async () => {
        try { await field.ownerDocument.defaultView!.navigator.clipboard.writeText(field.value); if (field.isConnected) text(error, 'copiedJson') }
        catch { if (field.isConnected) { selectAll(); text(error, 'copyManually') } }
      })
      button(tools, 'selectAll', selectAll)
      button(tools, 'import', () => {
        delete error.dataset.tbText
        config = parse(field.value, error)
        if (config) finish(true)
      }, 'tb-primary')
      button(tools, 'close', () => finish(false))
      return field
    })
    if (accepted && config) await confirmImport(config)
  }
  on(jsonFile, 'change', async () => {
    const file = jsonFile.files?.[0]
    if (!file || isLocked()) return
    try {
      const json = file.size <= MAX_SETTINGS ? await file.text() : ''
      if (signal.aborted || isLocked()) return
      const config = parse(json, importError)
      if (config) await confirmImport(config)
    } catch { if (!signal.aborted) text(importError, 'invalidImport') }
  })
  function changeSchedule(patch: Partial<ThemeConfig['schedule']>) { edit({ schedule: { ...current().schedule, ...patch } }) }

  async function duplicateProfile(profile: Profile) {
    if (isLocked() || signal.aborted) return
    if (current().profiles.length >= MAX_PROFILES) { toast('profileFull'); return }
    const base = current()
    const saved = upsertCustomProfile(base.profiles, {
      name: `${profile.name.slice(0, 55)} ${ui.t('copySuffix')}`,
      appearance: readAppearance(profile.appearance),
      source: profile.source ? structuredClone(profile.source) : structuredClone(base.source),
      placement: profile.placement ? structuredClone(profile.placement) : structuredClone(base.placement),
      videoPlacement: profile.videoPlacement ? structuredClone(profile.videoPlacement) : structuredClone(base.videoPlacement),
      font: profile.font ? structuredClone(profile.font) : structuredClone(base.font),
    })
    if (!saved) return
    edit({ profiles: saved.profiles })
    if (await commit()) toast('done')
  }

  async function extractAccentFromSource(source: Source, life: AbortSignal): Promise<{ color: string } | { error: 'sampleCors' | 'sampleError' }> {
    const decodeImageUrl = async (url: string, cors: boolean) => {
      const img = ui.doc.createElement('img')
      if (cors) img.crossOrigin = 'anonymous'
      img.referrerPolicy = 'no-referrer'
      const detach = () => img.removeAttribute('src')
      life.addEventListener('abort', detach, { once: true })
      try {
        img.src = url
        await img.decode()
        life.throwIfAborted()
        return extractWallpaperColor(img, ui.doc)
      } finally {
        life.removeEventListener('abort', detach)
        detach()
      }
    }
    try {
      if (source.kind === 'local-image' && media) {
        const blob = await media.backgroundBlob(source.id, 'image')
        if (!blob || life.aborted) return { error: 'sampleError' }
        const url = URL.createObjectURL(blob)
        try {
          const color = await decodeImageUrl(url, false)
          return color ? { color } : { error: 'sampleError' }
        } finally { URL.revokeObjectURL(url) }
      }
      if (source.kind === 'local-video' && media) {
        const blob = await media.backgroundBlob(source.id, 'video', source.mime)
        if (!blob || life.aborted) return { error: 'sampleError' }
        const video = prepareVideo(ui.doc), url = URL.createObjectURL(blob)
        try {
          await loadVideoFrame(video, url, life)
          life.throwIfAborted()
          const color = extractWallpaperColor(video, ui.doc)
          return color ? { color } : { error: 'sampleError' }
        } finally { releaseVideo(video); URL.revokeObjectURL(url) }
      }
      if (source.kind === 'url') {
        try {
          const color = await decodeImageUrl(source.url, true)
          return color ? { color } : { error: 'sampleError' }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'SecurityError') return { error: 'sampleCors' }
          return { error: 'sampleCors' }
        }
      }
      if (source.kind === 'preset') {
        const url = await assetUrl(PRESET_ASSET_PATH(source.id))
        if (!url || life.aborted) return { error: 'sampleError' }
        const color = await decodeImageUrl(url, false)
        return color ? { color } : { error: 'sampleError' }
      }
    } catch { return { error: 'sampleError' } }
    return { error: 'sampleError' }
  }

  async function openEditor(initial: CustomProfileDraft, existingId?: string) {
    if (signal.aborted || isLocked()) return
    if (!existingId && current().profiles.length >= MAX_PROFILES) { toast('profileFull'); return }
    const draft: CustomProfileDraft = structuredClone(initial)
    let bgTab: EditorBgTab = existingId && draft.source.kind === 'none' ? 'none' : tabForSource(draft.source)
    let applyAfterSave = true
    const dialogLife = new AbortController()
    const opSignal = AbortSignal.any([signal, dialogLife.signal])
    let previewLife: AbortController | undefined
    let imageGridLife: AbortController | undefined

    const accepted = await ui.dialog(existingId ? 'editProfileTitle' : 'createProfileTitle', (dialog, finish) => {
      dialog.classList.add('tb-editor-dialog')
      const body = make('div', dialog, 'tb-editor-body')

      // ── Live preview banner ────────────────────────────────────────────────
      const preview = make('div', body, 'tb-preset-art tb-editor-preview')
      const previewImg = make('img', preview, 'tb-preset-img')
      previewImg.alt = ''; previewImg.hidden = true
      const previewVideo = make('video', preview, 'tb-preset-img')
      previewVideo.hidden = true; previewVideo.muted = previewVideo.defaultMuted = true; previewVideo.playsInline = true; previewVideo.loop = true
      const mini = make('div', preview, 'tb-preset-mini')
      mini.setAttribute('aria-hidden', 'true')
      make('span', mini, 'tb-mini-side')
      const miniMain = make('div', mini, 'tb-mini-main')
      make('span', miniMain, 'tb-mini-bar')
      const miniLine = make('span', miniMain, 'tb-mini-line')
      const previewBadge = make('span', preview, 'tb-preset-badge')
      const previewTitle = make('span', preview, 'tb-editor-preview-name')

      // ── Theme Name ─────────────────────────────────────────────────────────
      const nameInput = input(body, 'profileName', 'text')
      nameInput.maxLength = MAX_PROFILE_NAME
      nameInput.value = draft.name
      nameInput.placeholder = ui.t('profileNamePlaceholder')
      const nameError = make('p', body, 'tb-error')
      nameError.setAttribute('role', 'alert')

      // ── Section 1: Independent Custom Wallpaper & Media Import ─────────────
      const bgSection = make('div', body, 'tb-editor-section')
      text(make('h4', bgSection), 'editorBackdrop')
      const bgTabGroup = make('div', bgSection, 'tb-segments')
      bgTabGroup.setAttribute('role', 'group')
      const bgTabButtons = BG_TABS.map(({ id, key }) => {
        const btn = button(bgTabGroup, key, () => {
          bgTab = id
          if (id === 'none') {
            draft.source = { kind: 'none' }
          } else if (id === 'dynamic' && !['mesh', 'shader', 'pattern'].includes(draft.source.kind)) {
            draft.source = { kind: 'shader', preset: 'aurora', seed: randomSeed(), scale: 1, speed: 0.35 }
          }
          bgError.textContent = ''
          syncEditor()
          if (id === 'local') void refreshLocalImages()
          if (id === 'video') void refreshLocalVideos()
        })
        btn.dataset.tbBgTab = id
        return { id, btn }
      })
      const legacyHint = make('p', bgSection, 'tb-hint')
      const bgError = make('p', bgSection, 'tb-error')
      bgError.setAttribute('role', 'alert')

      let mediaBusy = false
      let localImages: MediaSummary[] = []
      let localVideos: MediaSummary[] = []
      let localFonts: MediaSummary[] = []
      let imageListTicket = 0, videoListTicket = 0, fontListTicket = 0

      async function importLocalMedia(file: File, kind: 'image' | 'video' | 'font', errorTarget: HTMLElement) {
        if (!media || mediaBusy || opSignal.aborted) return
        mediaBusy = true
        errorTarget.textContent = ''
        syncBusy()
        try {
          opSignal.throwIfAborted()
          const mime = kind === 'font'
            ? await validateFont(file, ui.doc, opSignal)
            : kind === 'video'
              ? await validateVideo(file, ui.doc, opSignal)
              : await validateImage(file, ui.doc, opSignal)
          const item: MediaRecord = {
            id: uuid(), kind, mime, name: file.name.slice(0, 240), size: file.size, createdAt: Date.now(), blob: withMime(file, mime),
          }
          await media.put(item)
          if (opSignal.aborted) return
          onMediaChanged?.(item.id, 'put')
          if (kind === 'image') {
            bgTab = 'local'
            draft.source = { kind: 'local-image', id: item.id }
            await refreshLocalImages()
          } else if (kind === 'video') {
            bgTab = 'video'
            draft.source = { kind: 'local-video', id: item.id, mime: mime as typeof VIDEO_MIMES[number] }
            await refreshLocalVideos()
          } else {
            draft.font = { enabled: true, mediaId: item.id, mime: mime as NonNullable<ThemeFont['mime']> }
            await refreshLocalFonts()
          }
          syncEditor()
        } catch (err) {
          if (!opSignal.aborted) {
            const key: Key = err instanceof DOMException ? MEDIA_ERRORS[err.name] ?? 'storageError' : 'storageError'
            text(errorTarget, key)
          }
        } finally {
          mediaBusy = false
          if (!opSignal.aborted) syncBusy()
        }
      }

      function makeUploadStage(parent: HTMLElement, kind: 'image' | 'video', titleKey: Key, hintKey: Key, errorTarget: HTMLElement) {
        const stage = make('div', parent, 'tb-upload tb-editor-upload')
        const fileInput = make('input', stage)
        fileInput.type = 'file'; fileInput.accept = ACCEPT[kind]; fileInput.hidden = true; fileInput.dataset.tbEditorUpload = kind
        const trigger = button(stage, titleKey, () => {
          if (mediaBusy || opSignal.aborted) return
          fileInput.value = ''; fileInput.click()
        }, 'tb-primary')
        text(make('small', stage), hintKey)
        fileInput.addEventListener('change', () => {
          const picked = fileInput.files?.[0]
          fileInput.value = ''
          if (picked) void importLocalMedia(picked, kind, errorTarget)
        })
        stage.addEventListener('dragover', event => {
          if (mediaBusy || !event.dataTransfer?.types.includes('Files')) return
          event.preventDefault(); stage.setAttribute('data-tb-dragging', '')
        })
        stage.addEventListener('dragleave', event => {
          if (!stage.contains(event.relatedTarget as Node | null)) stage.removeAttribute('data-tb-dragging')
        })
        stage.addEventListener('drop', event => {
          if (!event.dataTransfer?.types.includes('Files')) return
          event.preventDefault(); stage.removeAttribute('data-tb-dragging')
          const dropped = event.dataTransfer.files[0]
          if (dropped && !mediaBusy) void importLocalMedia(dropped, kind, errorTarget)
        })
        return { stage, trigger }
      }

      // 1a. Local Image panel
      const localPanel = make('div', bgSection, 'tb-compact')
      const localImageUpload = makeUploadStage(localPanel, 'image', 'editorUploadImage', 'imageRules', bgError)
      const savedImagesTitle = text(make('p', localPanel, 'tb-hint'), 'editorSavedImages')
      savedImagesTitle.hidden = true
      const localImageGrid = make('div', localPanel, 'tb-editor-media-grid')
      localImageGrid.hidden = true

      async function refreshLocalImages() {
        if (!media || opSignal.aborted) return
        const ticket = ++imageListTicket
        try {
          const rows = await media.list('image')
          if (opSignal.aborted || ticket !== imageListTicket) return
          localImages = rows
          renderLocalImageGrid()
        } catch { /* Media library unavailable; upload error will surface if attempted. */ }
      }

      function renderLocalImageGrid() {
        imageGridLife?.abort()
        const gridLife = (imageGridLife = new AbortController()).signal
        localImageGrid.replaceChildren()
        savedImagesTitle.hidden = !localImages.length
        localImageGrid.hidden = !localImages.length
        if (!localImages.length) return
        for (const row of localImages) {
          const btn = make('button', localImageGrid, 'tb-editor-bg-tile')
          btn.type = 'button'
          btn.dataset.tbLocalImage = row.id
          const img = make('img', btn); img.alt = ''; img.hidden = true; img.loading = 'lazy'; img.decoding = 'async'
          if (media) {
            void media.backgroundBlob(row.id, 'image').then(blob => {
              if (!blob || gridLife.aborted || opSignal.aborted || !img.isConnected) return
              const url = URL.createObjectURL(blob)
              onRelease(gridLife, () => { img.removeAttribute('src'); URL.revokeObjectURL(url) })
              img.src = url; img.hidden = false
            }).catch(() => {})
          }
          const caption = make('span', btn)
          caption.textContent = row.name
          btn.setAttribute('aria-pressed', String(draft.source.kind === 'local-image' && draft.source.id === row.id))
          btn.addEventListener('click', () => {
            draft.source = { kind: 'local-image', id: row.id }
            syncEditor()
          })
        }
      }

      // 1b. HTTPS Image URL panel
      const urlPanel = make('div', bgSection, 'tb-compact')
      const urlRow = make('div', urlPanel, 'tb-editor-url-row')
      const urlField = make('input', urlRow)
      urlField.type = 'url'; urlField.maxLength = 2048; urlField.autocomplete = 'off'
      urlField.placeholder = 'https://example.com/wallpaper.jpg'
      label(urlField, 'address')
      if (draft.source.kind === 'url') urlField.value = draft.source.url
      const applyUrlBtn = button(urlRow, 'apply', () => applyEditorUrl(), 'tb-primary')
      text(make('p', urlPanel, 'tb-hint'), 'urlHint')
      function applyEditorUrl() {
        const valid = publicImageUrl(urlField.value.trim())
        if (!valid) {
          text(bgError, 'urlInvalid')
          urlField.setAttribute('aria-invalid', 'true')
          return
        }
        bgError.textContent = ''
        urlField.removeAttribute('aria-invalid')
        draft.source = { kind: 'url', url: valid }
        syncEditor()
      }
      urlField.addEventListener('input', () => { bgError.textContent = ''; urlField.removeAttribute('aria-invalid') })
      urlField.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyEditorUrl() } })

      // 1c. Local Video panel
      const videoPanel = make('div', bgSection, 'tb-compact')
      const localVideoUpload = makeUploadStage(videoPanel, 'video', 'editorUploadVideo', 'videoRules', bgError)
      const savedVideosTitle = text(make('p', videoPanel, 'tb-hint'), 'editorSavedVideos')
      savedVideosTitle.hidden = true
      const localVideoList = make('div', videoPanel, 'tb-segments')
      localVideoList.hidden = true

      async function refreshLocalVideos() {
        if (!media || opSignal.aborted) return
        const ticket = ++videoListTicket
        try {
          const rows = await media.list('video')
          if (opSignal.aborted || ticket !== videoListTicket) return
          localVideos = rows
          renderLocalVideoList()
        } catch { /* Ignore */ }
      }

      function renderLocalVideoList() {
        localVideoList.replaceChildren()
        savedVideosTitle.hidden = !localVideos.length
        localVideoList.hidden = !localVideos.length
        if (!localVideos.length) return
        for (const row of localVideos) {
          const btn = make('button', localVideoList)
          btn.type = 'button'
          btn.textContent = `${row.name} (${formatBytes(row.size)})`
          btn.dataset.tbLocalVideo = row.id
          btn.setAttribute('aria-pressed', String(draft.source.kind === 'local-video' && draft.source.id === row.id))
          btn.addEventListener('click', () => {
            draft.source = { kind: 'local-video', id: row.id, mime: row.mime as typeof VIDEO_MIMES[number] }
            syncEditor()
          })
        }
      }

      // 1d. Dynamic Backdrop panel (Mesh / Shader / Pattern)
      const dynamicPanel = make('div', bgSection, 'tb-compact')
      const dynamicTop = make('div', dynamicPanel, 'tb-actions')
      const dynamicKindButtons = DYNAMIC_KINDS.map(kind => {
        const btn = button(dynamicTop, kind, () => {
          if (draft.source.kind !== kind) draft.source = readSource({ kind, seed: randomSeed() })
          syncEditor()
        })
        return { kind, btn }
      })
      button(dynamicTop, 'random', () => {
        if ('seed' in draft.source) {
          draft.source = readSource({ ...draft.source, seed: randomSeed() })
          syncEditor()
        }
      })
      const shaderGrid = make('div', dynamicPanel, 'tb-effects')
      const shaderButtons = SHADERS.map(preset => {
        const btn = button(shaderGrid, preset, () => {
          const seed = 'seed' in draft.source ? draft.source.seed : randomSeed()
          draft.source = readSource({ kind: 'shader', preset, seed })
          syncEditor()
        })
        btn.dataset.tbChoice = preset
        return { preset, btn }
      })
      const patternGrid = make('div', dynamicPanel, 'tb-effects')
      const patternButtons = PATTERNS.map(preset => {
        const btn = button(patternGrid, preset, () => {
          const seed = 'seed' in draft.source ? draft.source.seed : randomSeed()
          draft.source = readSource({ kind: 'pattern', preset, seed })
          syncEditor()
        })
        btn.dataset.tbChoice = preset
        return { preset, btn }
      })

      // 1e. Framing & opacity/blur (shown whenever source != none)
      const layoutRow = make('div', bgSection, 'tb-editor-layout-row')
      text(make('span', layoutRow, 'tb-hint'), 'layout')
      const layoutGroup = make('div', layoutRow, 'tb-segments')
      layoutGroup.setAttribute('role', 'group')
      const layoutButtons = LAYOUTS.map(mode => {
        const btn = button(layoutGroup, mode, () => {
          if (draft.source.kind === 'local-video') draft.videoPlacement.mode = mode
          else draft.placement.mode = mode
          syncEditor()
        })
        return { mode, btn }
      })
      const wpControls = make('div', bgSection, 'tb-editor-inline-grid')
      const wpOpacity = makeNumberField(wpControls, 'opacity', 0, 100, 5, v => { draft.appearance.opacity = v; syncEditor() })
      const wpBlur = makeNumberField(wpControls, 'blur', 0, 60, 1, v => { draft.appearance.blur = v; syncEditor() })

      // ── Section 2: Full Independent Color & Scheme Studio ──────────────────
      const colorSection = make('div', body, 'tb-editor-section')
      text(make('h4', colorSection), 'scheme')
      const schemeGroup = make('div', colorSection, 'tb-segments')
      schemeGroup.setAttribute('role', 'group')
      const schemeButtons = SCHEMES.map(value => {
        const btn = button(schemeGroup, value, () => { draft.appearance.schemeOverride = value; syncEditor() })
        return { value, btn }
      })

      text(make('h4', colorSection), 'editorAccent')
      const colorStudio = make('div', colorSection, 'tb-editor-color-studio')
      const wheelWrap = make('div', colorStudio, 'tb-editor-wheel-wrap')
      const wheel = make('canvas', wheelWrap, 'tb-editor-wheel')
      wheel.width = wheel.height = WHEEL_SIZE * 2
      wheel.setAttribute('role', 'img'); label(wheel, 'wheel')
      const wheelCtx = wheel.getContext('2d')
      const ringCanvas = ui.doc.createElement('canvas')
      ringCanvas.width = ringCanvas.height = WHEEL_SIZE * 2
      const ringCtx = ringCanvas.getContext('2d')
      if (ringCtx) {
        ringCtx.scale(2, 2)
        ringCtx.lineWidth = WHEEL_OUTER - WHEEL_INNER
        for (let i = 0; i < 360; i++) {
          ringCtx.strokeStyle = `hsl(${i} 100% 50%)`
          ringCtx.beginPath()
          ringCtx.arc(WHEEL_CENTER, WHEEL_CENTER, (WHEEL_OUTER + WHEEL_INNER) / 2, i * TAU / 360, (i + 1.5) * TAU / 360)
          ringCtx.stroke()
        }
      }
      wheelCtx?.scale(2, 2)

      const colorRight = make('div', colorStudio, 'tb-editor-color-fields')
      const accentRow = make('div', colorRight, 'tb-editor-accent-row')
      const colorPicker = make('input', accentRow, 'tb-color-well')
      colorPicker.type = 'color'
      label(colorPicker, 'editorAccent')
      const hexInput = make('input', accentRow, 'tb-code tb-editor-hex')
      hexInput.type = 'text'; hexInput.maxLength = 7; hexInput.placeholder = '#6888D8'; hexInput.spellcheck = false
      label(hexInput, 'hex')
      const rgbInput = make('input', accentRow, 'tb-code tb-editor-rgb')
      rgbInput.type = 'text'; rgbInput.maxLength = 18; rgbInput.placeholder = '104, 136, 216'; rgbInput.spellcheck = false
      label(rgbInput, 'rgb')

      let hsv: [number, number, number] = hslToHsv(...rgbToHsl(...hexToRgb(draft.appearance.accent ?? FALLBACK_COLOR)))
      let lastAccent: string | null | undefined = draft.appearance.accent
      let wheelPointer: { id: number; zone: 'hue' | 'square' } | undefined

      const paintWheel = () => {
        if (!wheelCtx) return
        const [h, s, v] = hsv, x = WHEEL_CENTER - WHEEL_HALF, y = x
        wheelCtx.clearRect(0, 0, WHEEL_SIZE, WHEEL_SIZE)
        wheelCtx.drawImage(ringCanvas, 0, 0, WHEEL_SIZE, WHEEL_SIZE)
        const sat = wheelCtx.createLinearGradient(x, 0, x + 2 * WHEEL_HALF, 0)
        sat.addColorStop(0, '#fff'); sat.addColorStop(1, `hsl(${h} 100% 50%)`)
        wheelCtx.fillStyle = sat; wheelCtx.fillRect(x, y, 2 * WHEEL_HALF, 2 * WHEEL_HALF)
        const val = wheelCtx.createLinearGradient(0, y, 0, y + 2 * WHEEL_HALF)
        val.addColorStop(0, 'transparent'); val.addColorStop(1, '#000')
        wheelCtx.fillStyle = val; wheelCtx.fillRect(x, y, 2 * WHEEL_HALF, 2 * WHEEL_HALF)
        const drawDot = (dx: number, dy: number) => {
          wheelCtx.beginPath(); wheelCtx.arc(dx, dy, 4.5, 0, TAU)
          wheelCtx.strokeStyle = '#121218'; wheelCtx.lineWidth = 3.5; wheelCtx.stroke()
          wheelCtx.strokeStyle = '#fff'; wheelCtx.lineWidth = 1.8; wheelCtx.stroke()
        }
        const a = h * TAU / 360, r = (WHEEL_OUTER + WHEEL_INNER) / 2
        drawDot(WHEEL_CENTER + r * Math.cos(a), WHEEL_CENTER + r * Math.sin(a))
        drawDot(x + 2 * WHEEL_HALF * s, y + 2 * WHEEL_HALF * (1 - v))
      }
      const setHsv = (h: number, s: number, v: number) => {
        hsv = [h, s, v]
        const next = colorFromHsv(h, s, v)
        lastAccent = next
        draft.appearance.accent = next
        paintWheel()
        syncEditor()
      }
      const wheelCoords = (event: PointerEvent): [number, number] => {
        const box = wheel.getBoundingClientRect()
        return [(event.clientX - box.left) * WHEEL_SIZE / box.width - WHEEL_CENTER, (event.clientY - box.top) * WHEEL_SIZE / box.height - WHEEL_CENTER]
      }
      const dragWheel = (x: number, y: number, zone: 'hue' | 'square') => {
        if (zone === 'hue') setHsv((Math.atan2(y, x) * 360 / TAU + 360) % 360, hsv[1], hsv[2])
        else setHsv(hsv[0], clamp((x + WHEEL_HALF) / (2 * WHEEL_HALF), 0, 1), clamp((WHEEL_HALF - y) / (2 * WHEEL_HALF), 0, 1))
      }
      wheel.addEventListener('pointerdown', event => {
        if (event.button !== 0 || wheelPointer) return
        const [x, y] = wheelCoords(event), r = Math.hypot(x, y)
        const zone = Math.abs(x) <= WHEEL_HALF + 4 && Math.abs(y) <= WHEEL_HALF + 4 ? 'square'
          : r >= WHEEL_INNER - 4 && r <= WHEEL_OUTER + 4 ? 'hue' : undefined
        if (!zone) return
        wheel.setPointerCapture(event.pointerId)
        wheelPointer = { id: event.pointerId, zone }
        dragWheel(x, y, zone)
      })
      wheel.addEventListener('pointermove', event => {
        if (wheelPointer?.id === event.pointerId) dragWheel(...wheelCoords(event), wheelPointer.zone)
      })
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        wheel.addEventListener(ev, event => { if (wheelPointer?.id === event.pointerId) wheelPointer = undefined })
      }

      const hsvRow = make('div', colorRight, 'tb-editor-hsv-grid')
      const hueField = makeNumberField(hsvRow, 'hue', 0, 360, 1, h => setHsv(h, hsv[1], hsv[2]))
      const satField = makeNumberField(hsvRow, 'saturation', 0, 100, 1, s => setHsv(hsv[0], s / 100, hsv[2]))
      const valField = makeNumberField(hsvRow, 'value', 0, 100, 1, v => setHsv(hsv[0], hsv[1], v / 100))

      const colorActions = make('div', colorRight, 'tb-actions')
      let extracting = false
      const extractBtn = button(colorActions, 'editorExtractColor', async () => {
        if (extracting || opSignal.aborted) return
        extracting = true
        colorError.textContent = ''
        syncEditor()
        try {
          const result = await extractAccentFromSource(draft.source, opSignal)
          if (opSignal.aborted) return
          if ('error' in result) text(colorError, result.error)
          else { draft.appearance.accent = result.color; syncEditor() }
        } finally {
          extracting = false
          if (!opSignal.aborted) syncEditor()
        }
      })
      const useCurrentColorBtn = button(colorActions, 'editorUseCurrentColor', () => {
        colorError.textContent = ''
        const live = current()
        draft.appearance.accent = live.accent
        draft.appearance.schemeOverride = live.schemeOverride
        syncEditor()
      })
      useCurrentColorBtn.dataset.tbUseCurrentColor = ''
      const clearAccent = button(colorActions, 'editorAccentAuto', () => {
        colorError.textContent = ''
        draft.appearance.accent = null
        syncEditor()
      })
      const colorError = make('p', colorRight, 'tb-error')
      colorError.setAttribute('role', 'alert')

      const swatchRow = make('div', colorSection, 'tb-swatches')
      const swatchButtons = EDITOR_SWATCHES.map(color => {
        const btn = make('button', swatchRow, 'tb-swatch-btn')
        btn.type = 'button'
        btn.style.setProperty('--tb-swatch', color)
        btn.setAttribute('aria-label', color)
        btn.addEventListener('click', () => { colorError.textContent = ''; draft.appearance.accent = color; syncEditor() })
        return { color, btn }
      })
      colorPicker.addEventListener('input', () => { colorError.textContent = ''; draft.appearance.accent = colorPicker.value.toLowerCase(); syncEditor() })
      hexInput.addEventListener('input', () => {
        const clean = hexInput.value.trim()
        if (HEX.test(clean)) { colorError.textContent = ''; draft.appearance.accent = clean.toLowerCase(); syncEditor() }
      })
      rgbInput.addEventListener('input', () => {
        const parts = rgbInput.value.trim().split(/[\s,]+/).map(Number)
        if (parts.length === 3 && parts.every(p => Number.isFinite(p) && p >= 0 && p <= 255)) {
          colorError.textContent = ''
          draft.appearance.accent = rgbToHex(parts)
          syncEditor()
        }
      })

      // ── Section 3: Typography (Built-in styles OR Upload Local Font) ───────
      const fontSection = make('div', body, 'tb-editor-section')
      text(make('h4', fontSection), 'font')
      const fontGrid = make('div', fontSection, 'tb-font-presets')
      const fontButtons = FONT_PRESETS.map(preset => {
        const btn = make('button', fontGrid, 'tb-font-chip')
        btn.type = 'button'
        const strong = text(make('strong', btn), FONT_LABELS[preset])
        if (preset !== 'system') strong.style.fontFamily = FONT_STACKS[preset]
        btn.addEventListener('click', () => {
          draft.font = preset === 'system'
            ? { enabled: false, mediaId: draft.font.mediaId, mime: draft.font.mime }
            : { enabled: false, mediaId: draft.font.mediaId, mime: draft.font.mime, preset }
          syncEditor()
        })
        return { preset, btn }
      })
      const localFontRow = make('div', fontSection, 'tb-editor-local-font')
      const fontFile = make('input', localFontRow)
      fontFile.type = 'file'; fontFile.accept = ACCEPT.font; fontFile.hidden = true; fontFile.dataset.tbEditorUpload = 'font'
      const uploadFontBtn = button(localFontRow, 'editorUploadFont', () => {
        if (mediaBusy || opSignal.aborted) return
        fontFile.value = ''; fontFile.click()
      })
      text(make('span', localFontRow, 'tb-hint'), 'editorFontLocalHint')
      fontFile.addEventListener('change', () => {
        const picked = fontFile.files?.[0]
        fontFile.value = ''
        if (picked) void importLocalMedia(picked, 'font', fontError)
      })
      const localFontList = make('div', fontSection, 'tb-segments')
      localFontList.hidden = true
      const fontError = make('p', fontSection, 'tb-error')
      fontError.setAttribute('role', 'alert')

      async function refreshLocalFonts() {
        if (!media || opSignal.aborted) return
        const ticket = ++fontListTicket
        try {
          const rows = await media.list('font')
          if (opSignal.aborted || ticket !== fontListTicket) return
          localFonts = rows
          renderLocalFontList()
        } catch { /* Ignore */ }
      }

      function renderLocalFontList() {
        localFontList.replaceChildren()
        localFontList.hidden = !localFonts.length
        for (const row of localFonts) {
          const btn = make('button', localFontList)
          btn.type = 'button'
          btn.textContent = `${row.name} (${formatBytes(row.size)})`
          btn.dataset.tbLocalFont = row.id
          btn.setAttribute('aria-pressed', String(draft.font.enabled && draft.font.mediaId === row.id))
          btn.addEventListener('click', () => {
            draft.font = { enabled: true, mediaId: row.id, mime: row.mime as NonNullable<ThemeFont['mime']> }
            syncEditor()
          })
        }
      }

      // ── Section 4: Five Surfaces (Opacity & Frost Blur) ────────────────────
      const surfaceSection = make('div', body, 'tb-editor-section')
      text(make('h4', surfaceSection), 'interface')
      const surfaceGrid = make('div', surfaceSection, 'tb-editor-surfaces')
      const surfaceControls = SURFACES.map(part => {
        const row = make('div', surfaceGrid, 'tb-editor-surface-row')
        text(make('strong', row), part)
        const op = makeNumberField(row, 'surfaceOpacity', 0, 100, 5, v => { draft.appearance.opacities[part] = v; syncEditor() })
        const bl = makeNumberField(row, 'frost', 0, 40, 1, v => { draft.appearance.blurs[part] = v })
        return { part, op, bl }
      })

      function makeNumberField(parent: HTMLElement, key: Key, lo: number, hi: number, step: number, onChange: (val: number) => void) {
        const wrap = make('label', parent, 'tb-editor-num')
        text(make('span', wrap), key)
        const range = make('input', wrap)
        range.type = 'range'; range.min = String(lo); range.max = String(hi); range.step = String(step)
        const num = make('input', wrap)
        num.type = 'number'; num.min = String(lo); num.max = String(hi); num.step = String(step)
        const applyNum = (raw: number) => {
          if (!Number.isFinite(raw)) return
          const snapped = clamp(Math.round((raw - lo) / step) * step + lo, lo, hi)
          range.value = String(snapped)
          num.value = String(snapped)
          onChange(snapped)
        }
        range.addEventListener('input', () => applyNum(range.valueAsNumber))
        num.addEventListener('input', () => applyNum(num.valueAsNumber))
        return { set(v: number) { range.value = String(v); num.value = String(v) } }
      }

      // ── Pinned Footer ──────────────────────────────────────────────────────
      const footer = make('div', dialog, 'tb-editor-footer')
      button(footer, 'cancel', () => finish(false))
      const rightActions = make('div', footer, 'tb-actions')
      const submit = (applyNow: boolean) => {
        draft.name = nameInput.value.trim().slice(0, MAX_PROFILE_NAME)
        if (!draft.name) {
          text(nameError, 'profileNameRequired')
          nameInput.setAttribute('aria-invalid', 'true')
          nameInput.focus()
          return
        }
        applyAfterSave = applyNow
        finish(true)
      }
      button(rightActions, 'saveOnly', () => submit(false))
      button(rightActions, 'saveAndApply', () => submit(true), 'tb-primary')

      nameInput.addEventListener('input', () => {
        draft.name = nameInput.value
        nameError.textContent = ''; nameInput.removeAttribute('aria-invalid')
        previewTitle.textContent = draft.name.trim() || ui.t('profileNamePlaceholder')
      })
      nameInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(true) } })

      function syncBusy() {
        localImageUpload.trigger.disabled = mediaBusy || !media
        localVideoUpload.trigger.disabled = mediaBusy || !media
        uploadFontBtn.disabled = mediaBusy || !media
      }

      let renderedPreviewSource = ''
      function syncEditor() {
        const accent = draft.appearance.accent
        const scheme = draft.appearance.schemeOverride
        const visualScheme = scheme === 'light' ? 'light' : 'dark'
        preview.dataset.tbScheme = visualScheme
        preview.style.setProperty('--tb-preset-accent', accent ?? 'var(--tb-accent)')
        preview.style.setProperty('--tb-preset-base', previewBaseColor(draft.source, scheme))
        text(previewBadge, scheme)
        previewBadge.dataset.tbScheme = visualScheme
        previewTitle.textContent = nameInput.value.trim() || ui.t('profileNamePlaceholder')
        const activeFont: FontPreset = draft.font.enabled ? 'system' : (draft.font.preset ?? 'system')
        previewTitle.style.fontFamily = activeFont === 'system' ? '' : FONT_STACKS[activeFont]
        miniLine.style.opacity = String(0.35 + (draft.appearance.opacities.card / 100) * 0.65)

        const place = draft.source.kind === 'local-video' ? draft.videoPlacement : draft.placement
        const mediaOpacity = String(draft.appearance.opacity / 100)
        const mediaBlur = draft.appearance.blur ? `blur(${Math.min(draft.appearance.blur * 0.35, 16).toFixed(1)}px)` : ''
        previewImg.style.opacity = mediaOpacity
        previewImg.style.filter = mediaBlur
        previewImg.style.objectFit = objectFitFor(place.mode)
        previewVideo.style.opacity = mediaOpacity
        previewVideo.style.filter = mediaBlur
        previewVideo.style.objectFit = objectFitFor(place.mode)

        const sourceKey = JSON.stringify(draft.source)
        if (sourceKey !== renderedPreviewSource) {
          renderedPreviewSource = sourceKey
          previewLife?.abort()
          previewLife = new AbortController()
          attachThumb(previewImg, previewVideo, preview, draft.source, previewLife.signal)
        }

        // Wallpaper tabs & visibility
        for (const item of bgTabButtons) item.btn.setAttribute('aria-pressed', String(bgTab === item.id))
        const legacy = draft.source.kind === 'preset' || draft.source.kind === 'rotation'
        legacyHint.hidden = !legacy
        if (legacy) legacyHint.textContent = ui.t('editorLegacySource').replace('{source}', ui.t(sourceLabelKey(draft.source)))
        localPanel.hidden = bgTab !== 'local'
        urlPanel.hidden = bgTab !== 'url'
        videoPanel.hidden = bgTab !== 'video'
        dynamicPanel.hidden = bgTab !== 'dynamic'
        if (bgTab === 'url' && !urlField.matches(':focus') && draft.source.kind === 'url') urlField.value = draft.source.url
        for (const item of dynamicKindButtons) item.btn.setAttribute('aria-pressed', String(draft.source.kind === item.kind))
        shaderGrid.hidden = draft.source.kind !== 'shader'
        patternGrid.hidden = draft.source.kind !== 'pattern'
        for (const item of shaderButtons) item.btn.setAttribute('aria-pressed', String(draft.source.kind === 'shader' && draft.source.preset === item.preset))
        for (const item of patternButtons) item.btn.setAttribute('aria-pressed', String(draft.source.kind === 'pattern' && draft.source.preset === item.preset))
        for (const btn of localImageGrid.querySelectorAll<HTMLButtonElement>('[data-tb-local-image]')) {
          btn.setAttribute('aria-pressed', String(draft.source.kind === 'local-image' && draft.source.id === btn.dataset.tbLocalImage))
        }
        for (const btn of localVideoList.querySelectorAll<HTMLButtonElement>('[data-tb-local-video]')) {
          btn.setAttribute('aria-pressed', String(draft.source.kind === 'local-video' && draft.source.id === btn.dataset.tbLocalVideo))
        }
        const photoLike = draft.source.kind === 'local-image' || draft.source.kind === 'url' || draft.source.kind === 'local-video'
        layoutRow.hidden = !photoLike
        for (const item of layoutButtons) item.btn.setAttribute('aria-pressed', String(place.mode === item.mode))
        wpControls.hidden = draft.source.kind === 'none'
        wpOpacity.set(draft.appearance.opacity)
        wpBlur.set(draft.appearance.blur)

        // Scheme & Color studio
        for (const item of schemeButtons) item.btn.setAttribute('aria-pressed', String(scheme === item.value))
        const effectiveHex = accent ?? FALLBACK_COLOR
        const channels = hexToRgb(effectiveHex)
        if (accent !== lastAccent) {
          lastAccent = accent
          hsv = hslToHsv(...rgbToHsl(...channels))
          paintWheel()
        }
        colorPicker.value = effectiveHex
        if (!hexInput.matches(':focus')) hexInput.value = accent ? accent.toUpperCase() : ''
        if (!rgbInput.matches(':focus')) rgbInput.value = accent ? channels.join(', ') : ''
        hueField.set(Math.round(hsv[0]))
        satField.set(Math.round(hsv[1] * 100))
        valField.set(Math.round(hsv[2] * 100))
        clearAccent.setAttribute('aria-pressed', String(accent === null))
        const canExtract = draft.source.kind === 'local-image' || draft.source.kind === 'url' || draft.source.kind === 'local-video' || draft.source.kind === 'preset'
        extractBtn.disabled = extracting || !canExtract
        for (const item of swatchButtons) item.btn.setAttribute('aria-pressed', String(accent === item.color))

        // Typography
        for (const item of fontButtons) item.btn.setAttribute('aria-pressed', String(!draft.font.enabled && (draft.font.preset ?? 'system') === item.preset))
        for (const btn of localFontList.querySelectorAll<HTMLButtonElement>('[data-tb-local-font]')) {
          btn.setAttribute('aria-pressed', String(draft.font.enabled && draft.font.mediaId === btn.dataset.tbLocalFont))
        }

        // Five surfaces
        for (const item of surfaceControls) {
          item.op.set(draft.appearance.opacities[item.part])
          item.bl.set(draft.appearance.blurs[item.part])
        }
        syncBusy()
      }

      paintWheel()
      syncEditor()
      if (bgTab === 'local') void refreshLocalImages()
      if (bgTab === 'video') void refreshLocalVideos()
      void refreshLocalFonts()
      return nameInput
    })
    dialogLife.abort()
    previewLife?.abort()
    imageGridLife?.abort()
    if (!accepted || signal.aborted || isLocked()) return
    const saved = upsertCustomProfile(current().profiles, draft, existingId)
    if (!saved) { toast('profileFull'); return }
    const patch: Partial<ThemeConfig> = {
      profiles: saved.profiles,
      ...(applyAfterSave ? { ...profileOverrides(saved.profile), activeProfile: saved.profile.id, respectReducedTransparency: false } : {}),
    }
    edit(patch)
    if (await commit()) toast(applyAfterSave ? 'presetApplied' : 'profileSaved')
  }

  async function remove(profile: Profile) {
    if (!await ui.confirm('remove', 'deleteProfile') || isLocked() || signal.aborted) return
    const config = current(), schedule = { ...config.schedule }
    if (schedule.dayProfile === profile.id) schedule.dayProfile = null
    if (schedule.nightProfile === profile.id) schedule.nightProfile = null
    edit({ profiles: config.profiles.filter(item => item.id !== profile.id), schedule,
      activeProfile: config.activeProfile === profile.id ? null : config.activeProfile })
    void commit()
  }

  function renderList(config: ThemeConfig) {
    cardThumbs?.abort()
    const thumbLife = (cardThumbs = new AbortController()).signal
    preserveFocus(list, () => {
      list.replaceChildren()
      for (const profile of config.profiles) {
        const scheme = profile.appearance.schemeOverride
        const accent = profile.appearance.accent
        const source = profile.source ?? config.source
        const font = profile.font ?? config.font
        const tile = make('div', list, 'tb-preset tb-custom-card')
        tile.dataset.tbProfile = profile.id
        tile.dataset.tbScheme = scheme === 'light' ? 'light' : 'dark'
        if (accent) tile.style.setProperty('--tb-preset-accent', accent)
        tile.style.setProperty('--tb-preset-base', previewBaseColor(source, scheme))

        const swatch = make('div', tile, 'tb-preset-art')
        const photo = make('img', swatch, 'tb-preset-img')
        photo.alt = ''; photo.hidden = true; photo.decoding = 'async'
        attachThumb(photo, null, swatch, source, thumbLife)
        const mini = make('div', swatch, 'tb-preset-mini')
        mini.setAttribute('aria-hidden', 'true')
        make('span', mini, 'tb-mini-side')
        const miniMain = make('div', mini, 'tb-mini-main')
        make('span', miniMain, 'tb-mini-bar')
        make('span', miniMain, 'tb-mini-line')
        const badge = text(make('span', swatch, 'tb-preset-badge'), scheme)
        badge.dataset.tbScheme = scheme === 'light' ? 'light' : 'dark'

        const head = make('div', tile, 'tb-preset-head')
        make('span', head, 'tb-preset-dot').setAttribute('aria-hidden', 'true')
        const titleNode = make('strong', head)
        titleNode.textContent = profile.name

        const meta = make('div', tile, 'tb-preset-tags')
        text(make('span', meta, 'tb-preset-tag'), sourceLabelKey(source))
        const fKey = fontLabelKey(font)
        const fontChip = text(make('span', meta, 'tb-preset-tag tb-preset-font'), fKey)
        if (!font.enabled && font.preset) fontChip.style.fontFamily = FONT_STACKS[font.preset]

        const op = profile.appearance.opacities
        const summary = make('small', tile)
        summary.dataset.tbSummary = `${op.bg}/${op.sidebar}/${op.card}`
        summary.textContent = `${ui.t('bg')} ${op.bg}% · ${ui.t('sidebar')} ${op.sidebar}% · ${ui.t('card')} ${op.card}%`

        const primaryRow = make('div', tile, 'tb-preset-foot')
        const applyBtn = button(primaryRow, 'apply', async () => {
          edit({ ...profileOverrides(profile), activeProfile: profile.id, respectReducedTransparency: false })
          if (await commit()) toast('presetApplied')
        })
        applyBtn.dataset.tbFocus = `${profile.id}-apply`
        const editBtn = button(primaryRow, 'editProfile', () => {
          const base = current()
          void openEditor({
            name: profile.name,
            appearance: readAppearance(profile.appearance),
            source: profile.source ? structuredClone(profile.source) : structuredClone(base.source),
            placement: profile.placement ? structuredClone(profile.placement) : structuredClone(base.placement),
            videoPlacement: profile.videoPlacement ? structuredClone(profile.videoPlacement) : structuredClone(base.videoPlacement),
            font: profile.font ? structuredClone(profile.font) : structuredClone(base.font),
          }, profile.id)
        })
        editBtn.dataset.tbFocus = `${profile.id}-edit`

        const utilRow = make('div', tile, 'tb-custom-utils')
        button(utilRow, 'copy', () => void duplicateProfile(profile)).dataset.tbFocus = `${profile.id}-copy`
        button(utilRow, 'remove', () => void remove(profile)).dataset.tbFocus = `${profile.id}-remove`
      }
      if (config.profiles.length < MAX_PROFILES) {
        const addCard = make('button', list, 'tb-preset tb-add-card')
        addCard.type = 'button'
        addCard.dataset.tbAddProfile = ''
        const plus = make('span', addCard, 'tb-add-plus')
        plus.textContent = '+'
        plus.setAttribute('aria-hidden', 'true')
        text(make('strong', addCard), 'createProfileCard')
        text(make('small', addCard), 'createProfileCardHint')
        addCard.addEventListener('click', () => {
          if (isLocked() || signal.aborted) return
          void openEditor(blankCustomDraft())
        })
      }
    })
    for (const select of [dayProfile, nightProfile]) {
      select.replaceChildren()
      text(make('option', select), 'baseAppearance').value = ''
      for (const profile of config.profiles) {
        const option = make('option', select)
        option.value = profile.id; option.textContent = profile.name
      }
    }
  }

  let lastVisible = false
  function render(config: ThemeConfig, readOnly: boolean, visible = true) {
    lastVisible = visible
    if (visible) {
      loadBuiltinThumbs()
      const key = JSON.stringify(config.profiles)
      if (key !== listKey) { listKey = key; renderList(config) }
    }
    for (const { preset, tile, apply } of tiles) {
      const active = matchesPreset(config, preset)
      tile.toggleAttribute('data-tb-current', active)
      apply.setAttribute('aria-pressed', String(active))
      const labelKey: Key = active ? 'presetActive' : 'apply'
      if (apply.dataset.tbText !== labelKey) text(apply, labelKey)
    }
    for (const cardNode of list.querySelectorAll<HTMLElement>('[data-tb-profile]')) {
      const active = cardNode.dataset.tbProfile === config.activeProfile
      cardNode.toggleAttribute('data-tb-current', active)
      const apply = cardNode.querySelector<HTMLButtonElement>('[data-tb-focus$="-apply"]')
      if (apply) {
        apply.setAttribute('aria-pressed', String(active))
        const labelKey: Key = active ? 'presetActive' : 'apply'
        if (apply.dataset.tbText !== labelKey) text(apply, labelKey)
      }
      const summary = cardNode.querySelector<HTMLElement>('[data-tb-summary]')
      if (summary?.dataset.tbSummary) {
        const [bg, sb, card] = summary.dataset.tbSummary.split('/')
        const nextText = `${ui.t('bg')} ${bg}% · ${ui.t('sidebar')} ${sb}% · ${ui.t('card')} ${card}%`
        if (summary.textContent !== nextText) summary.textContent = nextText
      }
    }
    createBtn.disabled = saveCurrentBtn.disabled = readOnly || config.profiles.length >= MAX_PROFILES
    presets.disabled = profiles.disabled = schedule.disabled = download.disabled = upload.disabled = textTransfer.disabled = restoreHost.disabled = readOnly
    enabled.checked = config.schedule.enabled
    mode.value = config.schedule.mode
    day.disabled = night.disabled = config.schedule.mode === 'system'
    value(day, config.schedule.dayStart); value(night, config.schedule.nightStart)
    dayProfile.value = config.schedule.dayProfile ?? ''; nightProfile.value = config.schedule.nightProfile ?? ''
  }
  return Object.assign(render, {
    retryMedia(id: string) {
      const affected = current().profiles.some(p =>
        (p.source?.kind === 'local-image' || p.source?.kind === 'local-video') && p.source.id === id)
      if (!affected) return
      listKey = ''
      if (lastVisible) render(current(), isLocked(), true)
    },
  })
}
