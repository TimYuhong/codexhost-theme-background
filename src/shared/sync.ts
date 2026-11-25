import type { Dispose, StorageApi } from '../host-api.ts'
import { MAX_SETTINGS, normalizeConfig, record, UUID4 } from './config.ts'
import type { ConfigRead, ThemeConfig } from './config.ts'

export const CHANNEL = 'codexhost.theme-background.v1'
type Outbound =
  { type: 'settings-committed' | 'settings-observed' } |
  { type: 'media-changed'; id: string; op: 'put' | 'delete' } |
  { type: 'rotation-changed'; poolId: string }
export type Notice = { v: 1; sender: string } & Outbound

export function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function openNotices(receive: (notice: Notice) => void) {
  const sender = uuid()
  let channel: BroadcastChannel | undefined
  try { channel = new BroadcastChannel(CHANNEL) } catch { /* Host events and focus still work. */ }
  const message = ({ data }: MessageEvent<unknown>) => {
    if (!record(data) || data.v !== 1 || typeof data.sender !== 'string' || !UUID4.test(data.sender) || data.sender === sender) return
    if (data.type === 'settings-committed' || data.type === 'settings-observed') {
      receive({ v: 1, sender: data.sender, type: data.type })
    } else if (data.type === 'media-changed' && typeof data.id === 'string' && UUID4.test(data.id) && (data.op === 'put' || data.op === 'delete')) {
      receive({ v: 1, sender: data.sender, type: data.type, id: data.id.toLowerCase(), op: data.op })
    } else if (data.type === 'rotation-changed' && typeof data.poolId === 'string' && UUID4.test(data.poolId)) {
      receive({ v: 1, sender: data.sender, type: data.type, poolId: data.poolId.toLowerCase() })
    }
  }
  channel?.addEventListener('message', message)
  return {
    send(notice: Outbound) {
      try { channel?.postMessage({ ...notice, v: 1, sender }) } catch { /* Notification is best effort. */ }
    },
    close() {
      channel?.removeEventListener('message', message)
      channel?.close()
      channel = undefined
    },
  }
}

type ReadStorage<T> = { get(): Promise<T>; onChange(fn: (values: T) => void): Dispose }
type ReadResult<T> = { values: T; theme: ConfigRead }
const fromValues = (values: unknown): ConfigRead => record(values) ? normalizeConfig(values.theme) : { state: 'read-only', reason: 'format' }
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Subscribe before the first read. A notification invalidates any older in-flight get.
export function readSettings<T>(storage: ReadStorage<T>, adopt: (theme: ConfigRead, independent: boolean) => void, failed: () => void) {
  let active = true, generation = 0
  let pending: 'independent' | 'silent' | undefined
  let inFlight: Promise<ReadResult<T> | undefined> | undefined
  const unsubscribe = storage.onChange(values => {
    if (!active) return
    generation++
    if (inFlight) pending = 'silent'
    adopt(fromValues(values), false)
  })
  async function drain() {
    let result: ReadResult<T> | undefined
    while (active && pending) {
      const independent = pending === 'independent', started = generation
      pending = undefined
      try {
        const values = await storage.get()
        if (!active || generation !== started) continue
        const theme = fromValues(values)
        result = { values, theme }
        adopt(theme, independent && pending !== 'silent')
      } catch {
        if (!active || generation !== started) continue
        result = undefined
        failed()
      }
    }
    return active ? result : undefined
  }
  return {
    read(independent = false) {
      if (!active) return Promise.resolve(undefined)
      const reason = independent ? 'independent' : 'silent'
      if (pending !== 'silent') pending = reason
      inFlight ??= Promise.resolve().then(drain).finally(() => { inFlight = undefined })
      return inFlight
    },
    dispose() { if (active) { active = false; unsubscribe() } },
  }
}

export function watchFocus(doc: Document, refresh: (periodic: boolean) => void, poll = false) {
  const win = doc.defaultView!
  let timer: number | undefined
  const visible = () => doc.visibilityState === 'visible'
  function focus() { if (visible()) refresh(false) }
  function visibility() {
    win.clearInterval(timer)
    timer = undefined
    if (!visible()) return
    focus()
    startTimer()
  }
  function startTimer() {
    if (poll && visible()) timer = win.setInterval(() => { if (visible()) refresh(true) }, 5000)
  }
  win.addEventListener('focus', focus)
  doc.addEventListener('visibilitychange', visibility)
  startTimer()
  return () => {
    win.clearInterval(timer)
    win.removeEventListener('focus', focus)
    doc.removeEventListener('visibilitychange', visibility)
  }
}

const FIELDS = ['accent', 'schemeOverride', 'respectReducedTransparency', 'opacities', 'blurs', 'strokes', 'source',
  'regenerateOnReload', 'placement', 'videoPlacement', 'opacity', 'blur', 'font', 'rotation', 'profiles', 'activeProfile', 'schedule'] as const
export type Field = typeof FIELDS[number]
type Value = ThemeConfig[Field]
type Edit = { base: Value; value: Value; sequence: number }
export type EditStatus = 'loading' | 'ready' | 'unsaved' | 'saving' | 'saved' | 'failed' | 'changed' | 'conflict' | 'read-error' | 'format' | 'version'

export function editSettings(storage: StorageApi, changed: () => void, committed: () => void) {
  let active = true, sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<boolean> | undefined, queued = false
  let confirmed: ThemeConfig | undefined, readOnly = false
  let status: EditStatus = 'loading'
  const edits = new Map<Field, Edit>()
  const conflicts = new Map<Field, Value>()
  function adopt(result: ConfigRead) {
    readOnly = result.state !== 'ready'
    if (result.state === 'ready') {
      confirmed = result.config
      if (status === 'loading' || status === 'read-error' || status === 'format' || status === 'version') status = edits.size ? 'unsaved' : 'ready'
    } else { status = result.reason }
    changed()
  }
  const reader = readSettings(storage, adopt, () => {
    if (!confirmed) status = 'read-error'
    changed()
  })
  const report = (next: EditStatus) => { status = next; if (active) changed() }
  function clearTimer() { clearTimeout(timer); timer = undefined }
  function draft() {
    return confirmed && { ...confirmed, ...Object.fromEntries([...edits].map(([key, edit]) => [key, edit.value])) } as ThemeConfig | undefined
  }
  function editMany(patch: Partial<ThemeConfig>) {
    if (!active || readOnly || !confirmed) return
    let changed = false
    for (const key of FIELDS) {
      const value = patch[key]
      if (value === undefined) continue
      const previous = edits.get(key)
      if (equal(value, previous ? previous.value : confirmed[key])) continue
      if (!running && equal(value, confirmed[key]) && !conflicts.has(key)) edits.delete(key)
      else edits.set(key, { base: previous ? previous.base : confirmed[key], value, sequence: ++sequence })
      changed = true
    }
    if (!changed) return
    clearTimer()
    if (edits.size && !conflicts.size) timer = setTimeout(() => { void flush() }, 200)
    report(conflicts.size ? 'conflict' : edits.size ? 'unsaved' : 'ready')
  }
  function edit<K extends Field>(key: K, value: ThemeConfig[K]) { editMany({ [key]: value }) }
  async function save() {
    if (!active || readOnly || conflicts.size) return false
    if (!edits.size) return true
    const batch = new Map(edits)
    report('saving')
    try {
      const latest = await reader.read()
      if (!active) return false
      if (!latest) { report('failed'); return false }
      if (latest.theme.state !== 'ready') return false
      const config = latest.theme.config
      const patch: [Field, Value][] = []
      for (const [key, sent] of batch) {
        if (equal(config[key], sent.value)) continue
        if (!equal(config[key], sent.base)) conflicts.set(key, config[key])
        else patch.push([key, sent.value])
      }
      if (conflicts.size) { report('conflict'); return false }
      if (patch.length) {
        const values = { ...latest.values, theme: { ...config, ...Object.fromEntries(patch) } }
        if (new TextEncoder().encode(JSON.stringify({ settingsRevision: Number.MAX_SAFE_INTEGER, values })).length > MAX_SETTINGS) {
          report('failed')
          return false
        }
        const ack = await storage.set(values)
        if (!active) return false
        const accepted = fromValues(ack)
        committed()
        adopt(accepted)
        if (accepted.state !== 'ready') return false
        const check = await reader.read()
        if (!active) return false
        if (!check) { report('failed'); return false }
        if (check.theme.state !== 'ready') return false
        const verified = check.theme.config
        if ([...batch].some(([key, sent]) => !equal(verified[key], sent.value))) {
          for (const [key, sent] of batch) if (!equal(verified[key], sent.value)) conflicts.set(key, verified[key])
          report('changed')
          return false
        }
      }
      for (const [key, sent] of batch) {
        const current = edits.get(key)
        if (current?.sequence === sent.sequence) edits.delete(key)
        else if (current) current.base = sent.value
      }
      report(edits.size ? 'unsaved' : 'saved')
      return true
    } catch {
      if (active) report('failed')
      return false
    }
  }
  function flush(): Promise<boolean> {
    clearTimer()
    if (!active) return Promise.resolve(false)
    if (running) { queued = true; return running }
    running = Promise.resolve().then(async () => {
      let ok: boolean
      do {
        queued = false
        ok = await save()
      } while (ok && queued && active)
      return ok && active
    }).finally(() => { running = undefined })
    return running
  }
  async function resolve(useMine: boolean) {
    if (!active || !conflicts.size || running) return
    const latest = await reader.read()
    if (!active || latest?.theme.state !== 'ready') return
    for (const [key, seen] of conflicts) {
      const current = edits.get(key)
      if (useMine && current) current.base = seen
      else edits.delete(key)
    }
    conflicts.clear()
    report(edits.size ? 'unsaved' : 'ready')
    if (edits.size) await flush()
  }
  return {
    edit, editMany, flush, resolve, read: reader.read,
    get draft() { return draft() },
    get confirmed() { return confirmed },
    get status() { return status },
    get readOnly() { return readOnly || !confirmed },
    get hasConflicts() { return conflicts.size > 0 },
    dispose() { if (active) { active = false; clearTimer(); reader.dispose() } },
  }
}
