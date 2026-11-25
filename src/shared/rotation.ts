import type { Rotation } from './config.ts'

/** Inputs to cadence and index selection. */
export interface RotationCadence {
  enabled: boolean
  mode: 'shuffle' | 'order'
  interval: 'reload' | 'hourly' | 'daily' | 'weekly'
  current: number
  items: ReadonlyArray<unknown>
  lastRotate: string | null
}

/** ISO week key (Monday-first). */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${week}`
}

/** Whether the pool should advance right now. */
export function rotationDue(rot: RotationCadence, now: Date = new Date()): boolean {
  if (!rot.enabled || rot.items.length === 0) return false
  if (rot.interval === 'reload') return true
  const last = rot.lastRotate !== null ? new Date(rot.lastRotate) : null
  if (last === null || isNaN(last.getTime())) return true
  if (rot.interval === 'hourly') return hourKey(last) !== hourKey(now)
  if (rot.interval === 'daily') return last.toDateString() !== now.toDateString()
  return isoWeekKey(last) !== isoWeekKey(now)
}

/** Epoch-hour bucket: hourly cadence advances on each full hour boundary
 *  (in whole-hour timezones — UTC+8 among them — that is exactly the local
 *  on-the-hour tick). */
const hourKey = (d: Date): number => Math.floor(d.getTime() / 3_600_000)

/** Reload is due at startup only; a periodic caller must check this before rotationDue. */
export function rotationAdvancesLive(rot: Pick<RotationCadence, 'interval'>): boolean {
  return rot.interval !== 'reload'
}

/** Pick the next pool index under the configured mode. */
export function pickNextRotationIndex(rot: RotationCadence): number {
  const n = rot.items.length
  if (n === 0) return -1
  if (rot.mode === 'shuffle' && n > 1) {
    const excluding = rot.current >= 0 && rot.current < n
    const index = Math.floor(Math.random() * (excluding ? n - 1 : n))
    return excluding && index >= rot.current ? index + 1 : index
  }
  return (rot.current + 1) % n
}

export type RotationState = { poolId: string; current: string | null; lastRotate: string | null }
export type RotationAction = 'read' | 'startup' | 'tick' | 'next' | { select: string }

export function rotationStep(pool: Rotation, saved: RotationState | undefined, action: RotationAction, now = new Date()) {
  const index = saved?.current ? pool.items.indexOf(saved.current) : -1
  const cadence: RotationCadence = { ...pool, enabled: true, current: index, lastRotate: saved?.lastRotate ?? null }
  const selected = typeof action === 'object' ? pool.items.indexOf(action.select) : -1
  const due = action === 'startup' || (action === 'tick' && rotationAdvancesLive(pool))
  const changed = !!pool.items.length && (selected >= 0 || action === 'next' || (due && rotationDue(cadence, now)))
  const current = changed ? pool.items[selected >= 0 ? selected : pickNextRotationIndex(cadence)] : pool.items[Math.max(0, index)] ?? null
  const state: RotationState = { poolId: pool.poolId, current, lastRotate: changed ? now.toISOString() : cadence.lastRotate }
  return { state, changed }
}
