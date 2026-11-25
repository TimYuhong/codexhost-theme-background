import { randomSeed, scheduledConfig } from './config.ts'
import type { ThemeConfig } from './config.ts'
import { createFontLoader } from './font-loader.ts'
import type { MediaStore } from './media-db.ts'
import type { RotationAction } from './rotation.ts'
import { equal } from './sync.ts'
import type { Notice, openNotices } from './sync.ts'

export function createEffects(doc: Document, signal: AbortSignal, media: MediaStore, notices: Pick<ReturnType<typeof openNotices>, 'send'>, refresh: () => void) {
  const win = doc.defaultView!
  const system = win.matchMedia('(prefers-color-scheme: dark)')
  let base: ThemeConfig | undefined, config: ThemeConfig | undefined, current: string | null = null
  let active = !signal.aborted, started = false, generation = 0, request = 0
  let temporarySeed: { original: number; kind: string; seed: number } | undefined
  const font = createFontLoader(doc, signal, id => media.get(id), refresh)
  const rotation = () => config?.source.kind === 'rotation' ? config.rotation : undefined
  async function rotate(action: RotationAction) {
    const pool = rotation()
    if (!pool || !active) return
    const ticket = generation, latest = ++request
    const canApply = () => active && generation === ticket && request === latest
    try {
      const { state, changed } = await media.rotate(pool, action)
      if (active && generation === ticket && changed) notices.send({ type: 'rotation-changed', poolId: pool.poolId })
      if (canApply() && current !== state.current) { current = state.current; refresh() }
    } catch { if (canApply() && current) { current = null; refresh() } }
  }
  function reconcile() {
    const previous = rotation()
    config = base && scheduledConfig(base, system.matches ? 'dark' : 'light').config
    const source = config?.source, pool = rotation(), startup = !started && !!config
    if (startup) {
      started = true
      if (config?.regenerateOnReload && source && 'seed' in source) {
        temporarySeed = { original: source.seed, kind: source.kind, seed: randomSeed() }
      }
    }
    if (!config?.regenerateOnReload || !source || !('seed' in source) || source.seed !== temporarySeed?.original || source.kind !== temporarySeed.kind) temporarySeed = undefined
    const poolChanged = !equal(previous, pool)
    if (poolChanged) {
      generation++
      if (previous?.poolId !== pool?.poolId || !current || !pool?.items.includes(current)) current = null
      if (pool) void rotate(startup ? 'startup' : 'read')
    }
    font.update(config?.font)
    return poolChanged
  }
  function updateSchedule() {
    if (!active || !base?.schedule.enabled) return
    reconcile()
    refresh()
  }
  const timer = active ? win.setInterval(() => {
    if (doc.visibilityState !== 'visible' || !active) return
    const poolChanged = reconcile()
    if (base?.schedule.enabled) refresh()
    const pool = rotation()
    if (!poolChanged && pool && pool.interval !== 'reload') void rotate('tick')
  }, 30000) : undefined
  function dispose() {
    if (!active) return
    active = false
    win.clearInterval(timer)
    system.removeEventListener('change', updateSchedule)
    signal.removeEventListener('abort', dispose)
    font.dispose()
  }
  if (active) {
    system.addEventListener('change', updateSchedule)
    signal.addEventListener('abort', dispose, { once: true })
  }
  return {
    adopt(next: ThemeConfig | undefined) { if (active) { base = next; reconcile() } },
    effective(): ThemeConfig | undefined {
      if (!config) return undefined
      const { source } = config
      if (source.kind === 'rotation') return { ...config, source: current ? { kind: 'local-image', id: current } : { kind: 'none' } }
      if (temporarySeed && 'seed' in source) return { ...config, source: { ...source, seed: temporarySeed.seed } }
      return config
    },
    notice(notice: Notice) {
      if (!active) return
      if (notice.type === 'rotation-changed' && notice.poolId === rotation()?.poolId) void rotate('read')
      if (notice.type === 'media-changed' && notice.id === config?.font.mediaId) font.retry()
    },
    focus() {
      if (!active) return
      const poolChanged = reconcile()
      if (font.state === 'missing' || font.state === 'error') font.retry()
      if (rotation() && !poolChanged) void rotate('read')
    },
    get fontReady() { return font.state === 'ready' },
    dispose,
  }
}
