import assert from 'node:assert/strict'
import test from 'node:test'
import { backgroundPage } from '../src/page/background.ts'
import type { mediaPage } from '../src/page/library.ts'
import { DEFAULT } from '../src/shared/config.ts'
import type { ThemeConfig } from '../src/shared/config.ts'
import type { MediaStore, MediaSummary } from '../src/shared/media-db.ts'
import { fixtures } from './page-fixture.ts'

const turn = () => new Promise<void>(resolve => setImmediate(resolve))
const image = (id: string): MediaSummary => ({ id, name: id, createdAt: 1, size: 8, kind: 'image', mime: 'image/png' })
const video = (id: string): MediaSummary => ({ id, name: id, createdAt: 2, size: 16, kind: 'video', mime: 'video/mp4' })

test('rapid Image/Video switches ignore stale lists, remember valid items and retain the source for an empty group', async context => {
  const abort = new AbortController()
  const old = globalThis.ResizeObserver
  context.after(() => { abort.abort(); globalThis.ResizeObserver = old })
  globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver
  const f = fixtures(abort.signal), panel = f.panel('background'), applied: string[] = [], errors: string[] = []
  const pending: { kind: string; finish(rows: MediaSummary[]): void }[] = []
  let draft: ThemeConfig = { ...DEFAULT, source: { kind: 'local-image', id: 'image-a' }, respectReducedTransparency: true }
  let locked = false
  const media = { list: (kind: string) => new Promise<MediaSummary[]>(finish => pending.push({ kind, finish })),
    async backgroundBlob() { return undefined } } as unknown as MediaStore
  const use = (row: MediaSummary) => {
    applied.push(row.id)
    draft = { ...draft, source: row.kind === 'image' ? { kind: 'local-image', id: row.id } : { kind: 'local-video', id: row.id, mime: 'video/mp4' } }
    page.render(draft, locked, true)
  }
  const library = { apply: use, upload: () => f.make('div') } as unknown as ReturnType<typeof mediaPage>
  const page = backgroundPage(f.ui, panel, abort.signal, media, library, () => draft, patch => { draft = { ...draft, ...patch } }, () => {},
    () => locked, () => {}, key => errors.push(key), () => draft)
  page.render(draft, false, true)
  const select = f.choices.get('source')!, framing = f.root.find(node => node.className.includes('tb-placement'))!
  select('video'); assert.equal(framing.hidden, true)
  select('still'); pending.shift()!.finish([video('video-late')]); await turn()
  assert.deepEqual(applied, []); assert.equal(framing.hidden, false)
  select('video'); pending.shift()!.finish([]); await turn()
  assert.deepEqual(draft.source, { kind: 'local-image', id: 'image-a' })
  assert.ok(draft.respectReducedTransparency)
  assert.equal(framing.hidden, true)
  assert.ok(f.root.find(node => node.textContent === 'Currently using Image.'))
  select('video'); pending.shift()!.finish([video('video-a')]); await turn()
  select('still'); pending.shift()!.finish([image('image-newest'), image('image-a')]); await turn()
  assert.deepEqual(applied, ['video-a', 'image-a']); assert.equal(framing.hidden, false)
  select('video'); locked = true; pending.shift()!.finish([video('video-a')]); await turn()
  locked = false
  select('video'); page.render(draft, false, false); page.render(draft, false, true); pending.shift()!.finish([video('video-a')]); await turn()
  select('video'); abort.abort(); pending.shift()!.finish([video('video-a')]); await turn()
  assert.deepEqual(applied, ['video-a', 'image-a']); assert.deepEqual(errors, [])
})
