import type { Scheme } from '../host-api.ts'

export const LAYOUTS = ['fit', 'fill', 'stretch', 'tile', 'center'] as const
export const SURFACES = ['bg', 'sidebar', 'card', 'input', 'settings'] as const
export const SCHEMES = ['auto', 'light', 'dark'] as const
export const STROKE_COLORS = ['auto', 'gray', 'black', 'white', 'theme', 'custom'] as const
export const SHADERS = ['aurora', 'nebula', 'noise', 'starfield'] as const
export const PATTERNS = ['dots', 'waves', 'poly', 'rain', 'contour', 'meta'] as const
export const VIDEO_MIMES = ['video/mp4', 'video/webm'] as const
export const FONT_MIMES = ['font/woff2', 'font/woff', 'font/ttf', 'font/otf'] as const
export const FONT_PRESETS = ['system', 'modern', 'clean', 'editorial', 'literary', 'calligraphy', 'tech'] as const
export const BUILTIN_BACKDROPS = ['default', 'forest', 'minimal', 'glass'] as const
export const ANIMATED_PRESETS: ReadonlySet<BuiltinBackdrop> = new Set(['default'])
export const ROTATION_MODES = ['shuffle', 'order'] as const
export const ROTATION_INTERVALS = ['reload', 'hourly', 'daily', 'weekly'] as const
export const MAX_ROTATION_ITEMS = 30, MAX_PROFILES = 20, MAX_PROFILE_NAME = 64
export const MAX_SETTINGS = 1024 * 1024

export type Layout = typeof LAYOUTS[number]
export type Surface = typeof SURFACES[number]
export type FontPreset = typeof FONT_PRESETS[number]
export type BuiltinBackdrop = typeof BUILTIN_BACKDROPS[number]
export const PRESET_ASSET_PATH = (id: BuiltinBackdrop) => `assets/presets/${id}.webp`
export type Placement = { mode: Layout; zoom: number; panX: number; panY: number }
export type Stroke = { width: number; color: typeof STROKE_COLORS[number]; customColor: string }
export type Source =
  | { kind: 'none' }
  | { kind: 'preset'; id: BuiltinBackdrop }
  | { kind: 'url'; url: string }
  | { kind: 'local-image'; id: string }
  | { kind: 'local-video'; id: string; mime: typeof VIDEO_MIMES[number] }
  | { kind: 'rotation'; poolId: string }
  | { kind: 'mesh'; seed: number; scale: number; intensity: number }
  | { kind: 'shader'; preset: typeof SHADERS[number]; seed: number; scale: number; speed: number }
  | { kind: 'pattern'; preset: typeof PATTERNS[number]; seed: number; scale: number; density: number }
export type Appearance = {
  accent: string | null
  schemeOverride: typeof SCHEMES[number]
  opacities: Record<Surface, number>
  blurs: Record<Surface, number>
  strokes: Record<Surface, Stroke>
  opacity: number
  blur: number
}
export type ThemeFont = { enabled: boolean; mediaId: string | null; mime: typeof FONT_MIMES[number] | null; preset?: Exclude<FontPreset, 'system'> }
export type Rotation = {
  poolId: string; mode: typeof ROTATION_MODES[number]; interval: typeof ROTATION_INTERVALS[number]; items: string[]
}
type ProfileMedia = { source: Source; placement: Placement; videoPlacement: Placement; font: ThemeFont }
export type Profile = { id: string; name: string; createdAt: number; appearance: Appearance } & Partial<ProfileMedia>
export type ThemeConfig = Appearance & ProfileMedia & {
  schemaVersion: 2
  respectReducedTransparency: boolean
  regenerateOnReload: boolean
  rotation: Rotation
  profiles: Profile[]
  activeProfile: string | null
  schedule: { enabled: boolean; mode: 'time' | 'system'; dayStart: string; nightStart: string; dayProfile: string | null; nightProfile: string | null }
}
export type ConfigRead =
  | { state: 'ready'; config: ThemeConfig }
  | { state: 'read-only'; reason: 'version' | 'format'; profile?: string }

function surfaces<T>(make: (surface: Surface) => T): Record<Surface, T> {
  return { bg: make('bg'), sidebar: make('sidebar'), card: make('card'), input: make('input'), settings: make('settings') }
}
const placement: Placement = { mode: 'fill', zoom: 1, panX: 0.5, panY: 0.5 }
const V1_OPACITIES = { bg: 75, sidebar: 75, card: 100, input: 100, settings: 75 }
export const NATIVE_DEFAULT: ThemeConfig = {
  schemaVersion: 2, accent: null, schemeOverride: 'auto', respectReducedTransparency: false,
  opacities: { bg: 85, sidebar: 90, card: 85, input: 85, settings: 90 },
  blurs: surfaces(() => 0), strokes: surfaces(() => ({ width: 0, color: 'auto', customColor: '#808080' })),
  source: { kind: 'none' }, regenerateOnReload: false, placement, videoPlacement: { ...placement }, opacity: 85, blur: 0,
  font: { enabled: false, mediaId: null, mime: null },
  rotation: { poolId: '1bb75e22-89fb-462b-8dd5-e45da014da9e', mode: 'shuffle', interval: 'reload', items: [] },
  profiles: [], activeProfile: null,
  schedule: { enabled: false, mode: 'time', dayStart: '07:00', nightStart: '19:00', dayProfile: null, nightProfile: null },
}
export const DEFAULT: ThemeConfig = {
  ...NATIVE_DEFAULT,
  accent: '#00ef07',
  schemeOverride: 'dark',
  opacities: { bg: 25, sidebar: 0, card: 50, input: 85, settings: 90 },
  blurs: { bg: 0, sidebar: 0, card: 0, input: 0, settings: 18 },
  source: { kind: 'preset', id: 'default' },
  opacity: 100,
  font: { enabled: false, mediaId: null, mime: null, preset: 'modern' },
}

export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const fields = (value: unknown) => record(value) ? value : {}
export const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))
const bounded = (value: unknown, lo: number, hi: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback
const choice = <T extends string>(values: readonly T[], value: unknown, fallback: T) => values.find(item => item === value) ?? fallback
export const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const HEX = /^#[0-9a-f]{6}$/i
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const uuid = (v: unknown) => typeof v === 'string' && UUID4.test(v) ? v.toLowerCase() : null
const hex = (v: unknown) => typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null
const time = (v: unknown, fallback: string) => typeof v === 'string' && TIME.test(v) ? v : fallback
export const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647 + 1

export function publicImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048 || !URL.canParse(raw)) return null
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) return null
  return url.href
}
export function readSource(raw: unknown): Source {
  if (!record(raw)) return { kind: 'none' }
  const seed = Math.trunc(bounded(raw.seed, 1, 2147483647, 1729))
  const scale = bounded(raw.scale, 0.5, 2, 1)
  switch (raw.kind) {
    case 'preset': {
      const legacy = raw.id === 'moonlit' ? 'default' : raw.id
      const id = BUILTIN_BACKDROPS.find(value => value === legacy)
      return id ? { kind: 'preset', id } : { kind: 'none' }
    }
    case 'url': {
      const url = publicImageUrl(raw.url)
      return url ? { kind: 'url', url } : { kind: 'none' }
    }
    case 'local-image': {
      const id = uuid(raw.id)
      return id ? { kind: 'local-image', id } : { kind: 'none' }
    }
    case 'local-video': {
      const id = uuid(raw.id), mime = VIDEO_MIMES.find(value => value === raw.mime)
      return id && mime ? { kind: 'local-video', id, mime } : { kind: 'none' }
    }
    case 'rotation': {
      const poolId = uuid(raw.poolId)
      return poolId ? { kind: 'rotation', poolId } : { kind: 'none' }
    }
    case 'mesh': return { kind: 'mesh', seed, scale, intensity: bounded(raw.intensity, 0, 1, 0.65) }
    case 'shader': return { kind: 'shader', preset: choice(SHADERS, raw.preset, 'aurora'), seed, scale, speed: bounded(raw.speed, 0, 1, 0.35) }
    case 'pattern': return { kind: 'pattern', preset: choice(PATTERNS, raw.preset, 'dots'), seed, scale, density: bounded(raw.density, 0, 1, 0.5) }
    default: return { kind: 'none' }
  }
}
function readPlacement(raw: unknown): Placement {
  const p = fields(raw)
  return { mode: choice(LAYOUTS, p.mode, 'fill'), zoom: bounded(p.zoom, 0.25, 4, 1),
    panX: bounded(p.panX, 0, 1, 0.5), panY: bounded(p.panY, 0, 1, 0.5) }
}
const snapOpacity = (v: unknown, fallback: number) => Math.round(bounded(v, 0, 100, fallback) / 5) * 5
export function readAppearance(raw: unknown, legacy = false): Appearance {
  const a = fields(raw), o = fields(a.opacities), b = fields(a.blurs), s = fields(a.strokes)
  return {
    accent: hex(a.accent), schemeOverride: choice(SCHEMES, a.schemeOverride, 'auto'),
    opacities: surfaces(key => snapOpacity(legacy && key !== 'card' && key !== 'input' ? a.plate : o[key],
      (legacy ? V1_OPACITIES : NATIVE_DEFAULT.opacities)[key])),
    blurs: surfaces(key => Math.round(bounded(b[key], 0, 40, 0))),
    strokes: surfaces(key => {
      const stroke = fields(s[key])
      return { width: Math.round(bounded(stroke.width, 0, 4, 0) * 2) / 2,
        color: choice(STROKE_COLORS, stroke.color, 'auto'), customColor: hex(stroke.customColor) ?? '#808080' }
    }),
    opacity: Math.round(bounded(a.opacity, 0, 100, NATIVE_DEFAULT.opacity)), blur: Math.round(bounded(a.blur, 0, 60, 0)),
  }
}
function readFont(raw: unknown): ThemeFont {
  const font = fields(raw), mediaId = uuid(font.mediaId), mime = FONT_MIMES.find(value => value === font.mime)
  const preset = FONT_PRESETS.find(value => value === font.preset)
  const base: ThemeFont = mediaId && mime ? { enabled: font.enabled === true, mediaId, mime } : { ...NATIVE_DEFAULT.font }
  return preset && preset !== 'system' ? { ...base, preset } : base
}
function validFont(raw: unknown) {
  if (!record(raw) || typeof raw.enabled !== 'boolean') return false
  if (raw.preset !== undefined && !FONT_PRESETS.includes(raw.preset as FontPreset)) return false
  if (raw.mediaId == null && raw.mime == null) return !raw.enabled
  return !!readFont(raw).mediaId
}
function validSource(raw: unknown, source: Source, poolId: string) {
  if (!record(raw) || raw.kind !== source.kind) return false
  if (source.kind === 'preset') return raw.id === source.id || (raw.id === 'moonlit' && source.id === 'default')
  if (source.kind === 'rotation') return source.poolId === poolId
  if ('seed' in source) return Object.entries(source).every(([key, value]) => raw[key] === value)
  return true
}
export function normalizeConfig(raw: unknown): ConfigRead {
  if (raw === undefined) return { state: 'ready', config: structuredClone(DEFAULT) }
  if (!record(raw)) return { state: 'read-only', reason: 'format' }
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) return { state: 'read-only', reason: 'version' }
  const source = readSource(raw.source), rotation = fields(raw.rotation), schedule = fields(raw.schedule)
  const poolId = uuid(rotation.poolId) ?? (source.kind === 'rotation' ? source.poolId : DEFAULT.rotation.poolId)
  const items = new Set<string>()
  if (Array.isArray(rotation.items)) for (const item of rotation.items) {
    const id = uuid(item)
    if (id) items.add(id)
    if (items.size === MAX_ROTATION_ITEMS) break
  }
  const profiles: Profile[] = [], ids = new Set<string>()
  if (Array.isArray(raw.profiles)) for (const item of raw.profiles) {
    if (!record(item) || !record(item.appearance)) continue
    const id = uuid(item.id), name = typeof item.name === 'string' ? item.name.trim().slice(0, MAX_PROFILE_NAME) : ''
    if (!id || !name || ids.has(id)) continue
    ids.add(id)
    const profileSource = readSource(item.source)
    profiles.push({ id, name, createdAt: Math.trunc(bounded(item.createdAt, 0, 8.64e15, 0)), appearance: readAppearance(item.appearance),
      ...(validSource(item.source, profileSource, poolId) ? { source: profileSource } : {}),
      ...(record(item.placement) ? { placement: readPlacement(item.placement) } : {}),
      ...(record(item.videoPlacement) ? { videoPlacement: readPlacement(item.videoPlacement) } : {}),
      ...(validFont(item.font) ? { font: readFont(item.font) } : {}),
    })
    if (profiles.length === MAX_PROFILES) break
  }
  const profileId = (value: unknown) => { const id = uuid(value); return id && ids.has(id) ? id : null }
  return { state: 'ready', config: {
    schemaVersion: 2, ...readAppearance(raw, raw.schemaVersion === 1), respectReducedTransparency: raw.respectReducedTransparency === true,
    source: source.kind === 'rotation' && source.poolId !== poolId ? { kind: 'none' } : source,
    regenerateOnReload: raw.regenerateOnReload === true, placement: readPlacement(raw.placement), videoPlacement: readPlacement(raw.videoPlacement),
    font: readFont(raw.font),
    rotation: { poolId, mode: choice(ROTATION_MODES, rotation.mode, 'shuffle'),
      interval: choice(ROTATION_INTERVALS, rotation.interval, 'reload'), items: [...items] },
    profiles, activeProfile: profileId(raw.activeProfile),
    schedule: { enabled: schedule.enabled === true, mode: schedule.mode === 'system' ? 'system' : 'time',
      dayStart: time(schedule.dayStart, DEFAULT.schedule.dayStart), nightStart: time(schedule.nightStart, DEFAULT.schedule.nightStart),
      dayProfile: profileId(schedule.dayProfile), nightProfile: profileId(schedule.nightProfile) },
  } }
}

export function scheduledProfile(config: ThemeConfig, system: Scheme, now = new Date()) {
  const s = config.schedule
  if (!s.enabled) return undefined
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3))
  const day = minutes(s.dayStart), night = minutes(s.nightStart)
  const clock = now.getHours() * 60 + now.getMinutes()
  const daytime = s.mode === 'system' ? system === 'light' :
    day === night || (day < night ? clock >= day && clock < night : clock >= day || clock < night)
  return config.profiles.find(profile => profile.id === (daytime ? s.dayProfile : s.nightProfile))
}
export function profileSnapshot(config: ThemeConfig): Pick<Profile, 'appearance'> & ProfileMedia {
  const { source, placement, videoPlacement, font } = config
  return structuredClone({ appearance: readAppearance(config), source, placement, videoPlacement, font })
}
export function profileOverrides(profile: Profile): Appearance & Partial<ProfileMedia> {
  const { appearance, source, placement, videoPlacement, font } = profile
  return { ...appearance, ...(source && { source }), ...(placement && { placement }), ...(videoPlacement && { videoPlacement }), ...(font && { font }) }
}
export function scheduledConfig(base: ThemeConfig, system: Scheme, now?: Date) {
  const profile = scheduledProfile(base, system, now)
  return { config: profile ? { ...base, ...profileOverrides(profile) } : base, profile }
}
export function exportConfig(config: ThemeConfig) { return JSON.stringify(config, null, 2) + '\n' }
export function importConfig(json: string): ConfigRead {
  if (new TextEncoder().encode(json).length > MAX_SETTINGS) return { state: 'read-only', reason: 'format' }
  try {
    const raw: unknown = JSON.parse(json)
    if (!record(raw)) return { state: 'read-only', reason: 'format' }
    const result = normalizeConfig(raw)
    if (result.state !== 'ready') return result
    const { config } = result
    if (!record(raw.source) || config.source.kind !== raw.source.kind ||
      (raw.schemaVersion === 2 && (!record(raw.opacities) || !validFont(raw.font) || !uuid(fields(raw.rotation).poolId) || !Array.isArray(raw.profiles))) ||
      (record(raw.font) && raw.font.mediaId != null && !config.font.mediaId)) return { state: 'read-only', reason: 'format' }
    if (Array.isArray(raw.profiles)) for (const [index, item] of raw.profiles.entries()) {
      if (!record(item) || !record(item.appearance) || !uuid(item.id) || typeof item.name !== 'string' || !item.name.trim() ||
          (Object.hasOwn(item, 'source') && !validSource(item.source, readSource(item.source), config.rotation.poolId)) ||
          (Object.hasOwn(item, 'font') && !validFont(item.font)) ||
          (Object.hasOwn(item, 'placement') && !record(item.placement)) || (Object.hasOwn(item, 'videoPlacement') && !record(item.videoPlacement))) {
        const name = record(item) && typeof item.name === 'string' ? item.name.trim().slice(0, MAX_PROFILE_NAME) : ''
        return { state: 'read-only', reason: 'format', profile: name || `#${index + 1}` }
      }
    }
    return result
  } catch { return { state: 'read-only', reason: 'format' } }
}
