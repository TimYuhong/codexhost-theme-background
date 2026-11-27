import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_BACKDROPS, DEFAULT, exportConfig, FONT_PRESETS, importConfig, MAX_PROFILES, MAX_ROTATION_ITEMS, MAX_SETTINGS, NATIVE_DEFAULT, normalizeConfig, PATTERNS, profileOverrides, profileSnapshot, scheduledConfig, SHADERS, scheduledProfile } from '../src/shared/config.ts'
import type { Source } from '../src/shared/config.ts'
import { readAppearance } from '../src/shared/config.ts'
import { blankCustomDraft, upsertCustomProfile } from '../src/page/profiles.ts'

const read = (raw: unknown) => {
  const result = normalizeConfig(raw)
  assert.equal(result.state, 'ready')
  return result.config
}
const uuid = (n: number) => `039d48ec-5920-4c84-ba7d-${String(n).padStart(12, '0')}`

test('fresh defaults are independent, v1 reads migrate, and future versions remain read-only', () => {
  const first = read(undefined), second = read(undefined)
  assert.deepEqual(first, DEFAULT)
  assert.deepEqual(first.source, { kind: 'none' })
  assert.equal(first.accent, null)
  assert.equal(first.schemeOverride, 'auto')
  first.placement.zoom = 2
  first.strokes.bg.width = 2
  first.rotation.items.push(uuid(0))
  assert.deepEqual(second, DEFAULT)
  const v1 = { schemaVersion: 1, plate: 11, accent: '#ABCDEF', placement: { zoom: 2 } }
  assert.deepEqual(read(v1), { ...NATIVE_DEFAULT, accent: '#abcdef', opacities: { bg: 10, sidebar: 10, card: 100, input: 100, settings: 10 },
    placement: { ...NATIVE_DEFAULT.placement, zoom: 2 } })
  assert.deepEqual(read({ schemaVersion: 1 }).opacities, { bg: 75, sidebar: 75, card: 100, input: 100, settings: 75 })
  const existing = { bg: 75, sidebar: 90, card: 100, input: 100, settings: 95 }
  assert.deepEqual(read({ schemaVersion: 2, opacities: existing }).opacities, existing)
  assert.deepEqual(read({ ...NATIVE_DEFAULT, source: { kind: 'preset', id: 'moonlit' } }).source, { kind: 'preset', id: 'default' })
  assert.equal(v1.schemaVersion, 1)
  assert.equal(read(v1).respectReducedTransparency, false)
  for (const raw of [null, [], false, '']) assert.deepEqual(normalizeConfig(raw), { state: 'read-only', reason: 'format' })
  for (const raw of [{}, { schemaVersion: 3 }, { schemaVersion: '1' }]) assert.deepEqual(normalizeConfig(raw), { state: 'read-only', reason: 'version' })
})
test('all media and generators round trip and invalid locations are rejected', () => {
  const sources: Source[] = [
    { kind: 'none' },
    ...BUILTIN_BACKDROPS.map(id => ({ kind: 'preset', id }) as const),
    { kind: 'url', url: 'https://example.com/image.png' },
    { kind: 'local-image', id: uuid(0) }, { kind: 'local-video', id: uuid(1), mime: 'video/webm' },
    { kind: 'rotation', poolId: DEFAULT.rotation.poolId },
    { kind: 'mesh', seed: 99, scale: 1.7, intensity: 0 },
    ...SHADERS.map(preset => ({ kind: 'shader', preset, seed: 109, scale: 1, speed: 0.01 }) as const),
    ...PATTERNS.map(preset => ({ kind: 'pattern', preset, seed: 17, scale: 2, density: 1 }) as const),
  ]
  for (const source of sources) {
    const config = { ...DEFAULT, source }
    assert.deepEqual(read(read(config)), config)
    assert.deepEqual(importConfig(exportConfig(config)), { state: 'ready', config })
  }
  for (const url of ['http://example.com/', 'javascript:alert(1)', 'blob:https://example.com/x', '/relative', 'https://a:b@example.com/', `https://a.test/${'x'.repeat(2048)}`]) {
    assert.deepEqual(read({ ...DEFAULT, source: { kind: 'url', url } }).source, NATIVE_DEFAULT.source)
  }
  assert.deepEqual(read({ ...DEFAULT, source: { kind: 'local-image', id: uuid(0).toUpperCase() } }).source, { kind: 'local-image', id: uuid(0) })
  for (const source of [{ kind: 'preset', id: 'unknown' }, { kind: 'local-image', id: 'bogus' }, { kind: 'local-video', id: uuid(0), mime: 'image/png' }, { kind: 'rotation', poolId: uuid(0) }]) {
    assert.deepEqual(read({ ...DEFAULT, source }).source, NATIVE_DEFAULT.source)
  }
  for (const preset of FONT_PRESETS) {
    const raw = { ...DEFAULT, font: { enabled: false, mediaId: null, mime: null, preset } }
    const normalized = read(raw)
    assert.equal(normalized.font.preset, preset === 'system' ? undefined : preset)
    assert.deepEqual(importConfig(exportConfig(normalized)), { state: 'ready', config: normalized })
  }
  assert.equal(importConfig(JSON.stringify({ ...DEFAULT, font: { enabled: false, mediaId: null, mime: null, preset: 'bogus' } })).state, 'read-only')
  assert.equal(importConfig(JSON.stringify({ ...DEFAULT, source: { kind: 'preset', id: 'bogus' } })).state, 'read-only')
})
test('v2 bounds, color, font magic MIME, and placement are normalized independently', () => {
  const config = read({ ...NATIVE_DEFAULT, accent: '#A1C000', schemeOverride: 'dark', opacity: NaN, blur: 99,
    opacities: { bg: 98, sidebar: -1 }, blurs: { input: 99, card: 4.7 },
    strokes: { bg: { width: 0.7, color: 'custom', customColor: '#30A1FF' }, card: { width: 999, color: 'bad' } },
    respectReducedTransparency: true, regenerateOnReload: true, font: { mediaId: uuid(0), enabled: true, mime: 'font/woff2' },
    placement: { mode: 'tile', zoom: 100, panX: -1, panY: Infinity }, videoPlacement: { mode: 'stretch', zoom: 2, panX: 1 },
    source: { kind: 'shader', preset: 'other', seed: 1.9, scale: -3, speed: Infinity } })
  assert.deepEqual(config, { ...NATIVE_DEFAULT, accent: '#a1c000', schemeOverride: 'dark', blur: 60,
    opacities: { ...NATIVE_DEFAULT.opacities, bg: 100, sidebar: 0 }, blurs: { ...NATIVE_DEFAULT.blurs, input: 40, card: 5 },
    strokes: { ...NATIVE_DEFAULT.strokes, bg: { width: 0.5, color: 'custom', customColor: '#30a1ff' }, card: { ...NATIVE_DEFAULT.strokes.card, width: 4 } },
    respectReducedTransparency: true, regenerateOnReload: true, font: { mediaId: uuid(0), enabled: true, mime: 'font/woff2' },
    placement: { mode: 'tile', zoom: 4, panX: 0, panY: 0.5 }, videoPlacement: { mode: 'stretch', zoom: 2, panX: 1, panY: 0.5 },
    source: { kind: 'shader', preset: 'aurora', seed: 1, scale: 0.5, speed: 0.35 } })
  assert.deepEqual(read(config), config)
})
test('pool and profiles are bounded and deduplicated, schedule validates references and wraps midnight', () => {
  const profiles = Array.from({ length: 22 }, (_, n) => ({ id: uuid(n), name: `  Look ${n} `, createdAt: n, appearance: readAppearance(DEFAULT) }))
  const items = Array.from({ length: 32 }, (_, n) => uuid(n + 100))
  const config = read({ ...DEFAULT, profiles: [profiles[0], ...profiles], activeProfile: uuid(99),
    rotation: { ...DEFAULT.rotation, items: ['bad', items[0], ...items], mode: 'order', interval: 'hourly' },
    schedule: { enabled: true, mode: 'time', dayStart: '19:30', nightStart: '05:00', dayProfile: profiles[0].id, nightProfile: profiles[1].id } })
  assert.equal(config.profiles.length, MAX_PROFILES)
  assert.equal(config.rotation.items.length, MAX_ROTATION_ITEMS)
  assert.equal(config.profiles[0].name, 'Look 0')
  assert.equal(config.activeProfile, null)
  for (const [h, m, want] of [[19, 29, 1], [19, 30, 0], [0, 0, 0], [5, 0, 1]])
    assert.equal(scheduledProfile(config, 'dark', new Date(2025, 4, 1, h, m))?.id, profiles[want].id)
  assert.equal(scheduledProfile({ ...config, schedule: { ...config.schedule, mode: 'system' } }, 'light')?.id, profiles[0].id)
  assert.equal(read({ ...config, schedule: { ...config.schedule, dayStart: '24:00', dayProfile: uuid(100) } }).schedule.dayStart, DEFAULT.schedule.dayStart)
  assert.deepEqual(importConfig(exportConfig(config)), { state: 'ready', config })
})
test('import rejects incompatible versions, invalid JSON, sources and oversized bytes', () => {
  for (const payload of ['{', 'null', JSON.stringify({ ...DEFAULT, source: { kind: 'url', url: 'data:image/png;base64,q' } }), '字'.repeat(350_000)])
    assert.deepEqual(importConfig(payload), { state: 'read-only', reason: 'format' })
  assert.deepEqual(importConfig(JSON.stringify({ ...DEFAULT, schemaVersion: 99 })), { state: 'read-only', reason: 'version' })
  assert.equal(importConfig(JSON.stringify({ schemaVersion: 1, plate: 30, source: { kind: 'none' } })).state, 'ready')
})

test('old profiles inherit all four media fields; deep snapshots and explicit off values round trip', () => {
  const base = structuredClone({ ...DEFAULT, source: { kind: 'local-video', id: uuid(50), mime: 'video/mp4' } as const,
    font: { enabled: true, mediaId: uuid(51), mime: 'font/ttf' } as const })
  const legacy = { id: uuid(0), name: 'Legacy', createdAt: 1, appearance: readAppearance(DEFAULT) }
  const saved = { id: uuid(1), name: 'Off', createdAt: 1, ...profileSnapshot({ ...base, source: DEFAULT.source, font: DEFAULT.font }) }
  assert.notEqual(saved.videoPlacement, base.videoPlacement)
  assert.notEqual(saved.font, DEFAULT.font)
  assert.notEqual(saved.appearance.opacities, DEFAULT.opacities)
  saved.placement.panX = 0; saved.videoPlacement.zoom = 3
  const config = read({ ...base, profiles: [legacy, saved], schedule: { ...DEFAULT.schedule, enabled: true, mode: 'system', dayProfile: legacy.id, nightProfile: saved.id } })
  assert.deepEqual(config.profiles[0], legacy)
  const inherited = scheduledConfig(config, 'light').config, active = scheduledConfig(config, 'dark').config
  for (const field of ['source', 'font', 'placement', 'videoPlacement'] as const) {
    assert.deepEqual(inherited[field], config[field])
    assert.deepEqual(active[field], saved[field])
  }
  assert.deepEqual(profileOverrides(legacy), legacy.appearance)
  assert.equal(active.respectReducedTransparency, config.respectReducedTransparency)
  assert.deepEqual(importConfig(exportConfig(config)), { state: 'ready', config })
})

test('custom editable themes start independent of built-ins, support user media/colors/fonts, update preserving UUID/createdAt, and respect MAX_PROFILES', () => {
  const blank = blankCustomDraft()
  assert.equal(blank.name, '')
  assert.deepEqual(blank.source, { kind: 'none' })
  assert.equal(blank.appearance.accent, null)
  assert.equal(blank.appearance.schemeOverride, 'auto')
  assert.equal(blank.appearance.blurs.card, 0)
  assert.equal(blank.appearance.blurs.input, 0)

  const localWallpaper = uuid(77)
  const localFont = uuid(78)
  const created = upsertCustomProfile([], {
    ...blank,
    name: '  My Own Wallpaper Theme  ',
    appearance: { ...blank.appearance, accent: '#3DA58A', schemeOverride: 'dark' },
    source: { kind: 'local-image', id: localWallpaper },
    font: { enabled: true, mediaId: localFont, mime: 'font/woff2' },
  }, undefined, 1000)
  assert.ok(created)
  assert.equal(created.profiles.length, 1)
  assert.equal(created.profile.name, 'My Own Wallpaper Theme')
  assert.equal(created.profile.createdAt, 1000)
  assert.equal(created.profile.appearance.accent, '#3da58a')
  assert.deepEqual(created.profile.source, { kind: 'local-image', id: localWallpaper })
  assert.deepEqual(created.profile.font, { enabled: true, mediaId: localFont, mime: 'font/woff2' })

  const edited = upsertCustomProfile(created.profiles, {
    ...blank,
    name: 'My Updated Look',
    appearance: { ...blank.appearance, accent: '#78b8f8', opacities: { ...blank.appearance.opacities, bg: 22 } },
    source: { kind: 'url', url: 'https://example.test/my-bg.webp' },
  }, created.profile.id, 2000)
  assert.ok(edited)
  assert.equal(edited.profiles.length, 1)
  assert.equal(edited.profile.id, created.profile.id, 'editing preserves UUID for schedule links')
  assert.equal(edited.profile.createdAt, 1000, 'editing preserves original createdAt')
  assert.equal(edited.profile.name, 'My Updated Look')
  assert.equal(edited.profile.appearance.accent, '#78b8f8')
  assert.equal(edited.profile.appearance.opacities.bg, 20, 'snaps opacity to 5% steps')
  assert.deepEqual(edited.profile.source, { kind: 'url', url: 'https://example.test/my-bg.webp' })

  const roundTrip = read({ ...DEFAULT, profiles: edited.profiles, activeProfile: edited.profile.id })
  assert.deepEqual(importConfig(exportConfig(roundTrip)), { state: 'ready', config: roundTrip })

  assert.equal(upsertCustomProfile(edited.profiles, { ...blank, name: '   ' }), null)
  const full = Array.from({ length: MAX_PROFILES }, (_, n) => ({ id: uuid(n), name: `P${n}`, createdAt: n, appearance: readAppearance(DEFAULT) }))
  assert.equal(upsertCustomProfile(full, { ...blank, name: 'Overflow' }), null)
  assert.ok(upsertCustomProfile(full, { ...blank, name: 'Edit Existing When Full' }, full[0].id))
})

test('import rejects explicit bad profile media and pool links and names the affected profile', () => {
  const base = { ...DEFAULT, profiles: [{ id: uuid(3), name: 'Missing references', createdAt: 0, appearance: readAppearance(DEFAULT) }] }
  for (const change of [
    { source: { kind: 'rotation', poolId: uuid(8) } }, { source: { kind: 'local-image', id: 'bad' } },
    { source: { kind: 'url', url: 'http://example.test' } }, { source: { kind: 'shader', preset: 'wrong' } },
    { font: { enabled: true, mediaId: null, mime: null } }, { font: { enabled: false, mediaId: uuid(1), mime: 'font/ttc' } },
    { font: null }, { videoPlacement: false },
  ]) {
    const raw = { ...base, profiles: [{ ...base.profiles[0], ...change }] }
    assert.deepEqual(importConfig(JSON.stringify(raw)), { state: 'read-only', reason: 'format', profile: 'Missing references' })
  }
  assert.equal(importConfig(JSON.stringify({ ...base, rotation: { ...DEFAULT.rotation, poolId: 'bad' } })).state, 'read-only')
})

test('20 full snapshots with max-length URLs and names fit both the Host envelope and JSON export', () => {
  const prefix = 'https://example.test/'
  const setup = { ...DEFAULT, source: { kind: 'url', url: prefix.padEnd(2048, 'a') } as const,
    font: { enabled: true, mediaId: uuid(100), mime: 'font/woff2' } as const }
  const config = read({ ...setup, profiles: Array.from({ length: 20 }, (_, index) => ({ id: uuid(index), name: '档'.repeat(64),
    createdAt: index, ...profileSnapshot(setup) })), rotation: { ...DEFAULT.rotation, items: Array.from({ length: 30 }, (_, index) => uuid(200 + index)) } })
  assert.equal(config.profiles.length, 20)
  const json = exportConfig(config)
  assert.ok(Buffer.byteLength(json) < MAX_SETTINGS)
  assert.ok(Buffer.byteLength(JSON.stringify({ settingsRevision: Number.MAX_SAFE_INTEGER, values: { theme: config } })) < MAX_SETTINGS)
  assert.deepEqual(importConfig(json), { state: 'ready', config })
})
