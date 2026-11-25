import { exportConfig, importConfig, MAX_PROFILE_NAME, MAX_PROFILES, MAX_SETTINGS, profileOverrides, profileSnapshot, readAppearance } from '../shared/config.ts'
import type { Profile, ThemeConfig } from '../shared/config.ts'
import { hslToRgb, rgbToHex } from '../shared/palette.ts'
import { uuid } from '../shared/sync.ts'
import type { Key } from './i18n.ts'
import { preserveFocus } from './ui.ts'
import type { Ui } from './ui.ts'

export const builtIn = [
  { name: 'default', description: 'defaultDesc', accent: null, schemeOverride: 'auto', opacities: { bg: 85, sidebar: 95, card: 100, input: 100, settings: 100 }, opacity: 100 },
  { name: 'glass', description: 'glassDesc', accent: rgbToHex(hslToRgb(212, 0.5, 0.38)), schemeOverride: 'auto', opacities: { bg: 80, sidebar: 85, card: 85, input: 85, settings: 90 }, blurs: { bg: 20, sidebar: 14, card: 12, input: 14, settings: 20 }, opacity: 100 },
  { name: 'minimal', description: 'minimalDesc', accent: null, schemeOverride: 'auto', opacities: { bg: 95, sidebar: 95, card: 100, input: 100, settings: 100 }, opacity: 100 },
  { name: 'midnight', description: 'midnightDesc', accent: rgbToHex(hslToRgb(262, 0.45, 0.16)), schemeOverride: 'dark', opacities: { bg: 85, sidebar: 90, card: 90, input: 90, settings: 95 }, blurs: { bg: 24, sidebar: 18, card: 14, input: 16, settings: 22 }, opacity: 92, blur: 2 },
  { name: 'cyber', description: 'cyberDesc', accent: rgbToHex(hslToRgb(315, 0.7, 0.22)), schemeOverride: 'dark', opacities: { bg: 80, sidebar: 85, card: 85, input: 85, settings: 90 }, blurs: { bg: 16, sidebar: 12, card: 10, input: 20, settings: 18 }, opacity: 100 },
  { name: 'warm', description: 'warmDesc', accent: rgbToHex(hslToRgb(28, 0.6, 0.72)), schemeOverride: 'light', opacities: { bg: 90, sidebar: 95, card: 100, input: 100, settings: 100 }, opacity: 100 },
] as const

export function profilesPage(ui: Ui, panel: HTMLElement, signal: AbortSignal, current: () => ThemeConfig, edit: (changes: Partial<ThemeConfig>) => void,
  commit: () => Promise<boolean>, toast: (key: Key) => void, isLocked: () => boolean) {
  const { make, card, text, button, on, check, select, input, value, label } = ui
  const presets = make('fieldset', panel, 'tb-card')
  text(make('h3', presets), 'presets')
  const gallery = make('div', presets, 'tb-presets')
  for (const preset of builtIn) {
    const tile = make('div', gallery, `tb-preset tb-preset-${preset.name}`)
    const swatch = make('div', tile, 'tb-preset-art')
    if (preset.accent) swatch.style.setProperty('--tb-preset-accent', preset.accent)
    make('span', swatch); make('span', swatch); make('span', swatch)
    text(make('strong', tile), preset.name)
    text(make('small', tile), preset.description)
    const use = button(tile, 'apply', () => { edit({ ...readAppearance(preset), respectReducedTransparency: false, activeProfile: null }); void commit() })
    use.dataset.tbPreset = preset.name
  }
  const profiles = make('fieldset', panel, 'tb-card')
  text(make('h3', profiles), 'savedProfiles')
  const name = input(profiles, 'profileName', 'text')
  name.maxLength = MAX_PROFILE_NAME
  const save = button(profiles, 'saveProfile', () => void createProfile(name.value.trim()), 'tb-primary')
  on(name, 'input', () => updateSave(current()))
  on(name, 'keydown', event => { if (event.key === 'Enter' && !save.disabled) { event.preventDefault(); save.click() } })
  const list = make('div', profiles, 'tb-list')
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
  signal.addEventListener('abort', () => { for (const url of downloads.keys()) releaseDownload(url) }, { once: true })

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
  function updateSave(config: ThemeConfig) { save.disabled = !name.value.trim() || config.profiles.length >= MAX_PROFILES }
  async function createProfile(raw: string, snapshot?: Omit<Profile, 'name' | 'id' | 'createdAt'>, activate = true) {
    const profileName = raw.slice(0, MAX_PROFILE_NAME).trim()
    if (!profileName || isLocked()) return
    if (current().profiles.length >= MAX_PROFILES) { toast('profileFull'); return }
    const profile: Profile = { id: uuid(), name: profileName, createdAt: Date.now(), ...(snapshot ? structuredClone(snapshot) : profileSnapshot(current())) }
    edit({ profiles: [...current().profiles, profile], ...(activate ? { activeProfile: profile.id } : {}) })
    if (activate) { name.value = ''; updateSave(current()); name.focus() }
    if (await commit()) toast('done')
  }
  async function rename(profile: Profile) {
    let next = profile.name
    const accepted = await ui.dialog('rename', (dialog, finish) => {
      const field = input(dialog, 'profileName', 'text')
      field.value = profile.name; field.maxLength = MAX_PROFILE_NAME
      const actions = make('div', dialog, 'tb-actions')
      button(actions, 'cancel', () => finish(false))
      const apply = () => { next = field.value.trim(); if (next) finish(true) }
      button(actions, 'confirm', apply, 'tb-primary')
      field.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); apply() } })
      return field
    })
    if (!accepted || signal.aborted || isLocked()) return
    edit({ profiles: current().profiles.map(item => item.id === profile.id ? { ...item, name: next } : item) })
    void commit()
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
    preserveFocus(list, () => {
      list.replaceChildren()
      if (!config.profiles.length) text(make('p', list, 'tb-hint'), 'noProfiles')
      for (const profile of config.profiles) {
        const row = make('div', list, 'tb-list-row')
        row.dataset.tbProfile = profile.id
        const name = make('strong', row)
        name.textContent = profile.name
        const controls = make('div', row, 'tb-actions')
        for (const [key, click] of [
          ['apply', () => { edit({ ...profileOverrides(profile), activeProfile: profile.id, respectReducedTransparency: false }); void commit() }],
          ['rename', () => void rename(profile)], ['copy', () => {
            const { id, name, createdAt, ...snapshot } = profile
            void createProfile(`${name.slice(0, 55)} ${ui.t('copySuffix')}`, snapshot, false)
          }],
          ['remove', () => void remove(profile)],
        ] as const) button(controls, key, click).dataset.tbFocus = `${profile.id}-${key}`
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
  return (config: ThemeConfig, readOnly: boolean) => {
    const key = JSON.stringify(config.profiles)
    if (key !== listKey) { listKey = key; renderList(config) }
    for (const row of list.querySelectorAll<HTMLElement>('[data-tb-profile]')) {
      const active = row.dataset.tbProfile === config.activeProfile
      row.toggleAttribute('data-tb-current', active)
      const apply = row.querySelector<HTMLButtonElement>('button')!
      apply.setAttribute('aria-pressed', String(active))
    }
    presets.disabled = profiles.disabled = schedule.disabled = download.disabled = upload.disabled = textTransfer.disabled = readOnly
    updateSave(config)
    enabled.checked = config.schedule.enabled
    mode.value = config.schedule.mode
    day.disabled = night.disabled = config.schedule.mode === 'system'
    value(day, config.schedule.dayStart); value(night, config.schedule.nightStart)
    dayProfile.value = config.schedule.dayProfile ?? ''; nightProfile.value = config.schedule.nightProfile ?? ''
  }
}
