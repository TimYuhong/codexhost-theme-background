import type { ThemeFont } from './config.ts'
import { sniffFont } from './media-db.ts'
import type { MediaRecord } from './media-db.ts'

export type FontState = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

async function loadFontFace(doc: Document, family: string, file: Blob, signal: AbortSignal) {
  const Face = doc.defaultView!.FontFace
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer()
    signal.throwIfAborted()
    return await new Face(family, buffer).load()
  }
  const url = URL.createObjectURL(file)
  const abort = () => URL.revokeObjectURL(url)
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await new Face(family, `url("${url}")`).load()
  } finally {
    signal.removeEventListener('abort', abort)
    if (!signal.aborted) URL.revokeObjectURL(url)
  }
}

export async function validateFont(file: Blob, doc: Document, signal: AbortSignal) {
  const mime = await sniffFont(file, signal)
  try {
    await loadFontFace(doc, 'ThemeBackgroundValidation', file, signal)
    signal.throwIfAborted()
    return mime
  } catch (error) {
    signal.throwIfAborted()
    throw new DOMException(String(error), 'EncodingError')
  }
}

export function createFontLoader(doc: Document, signal: AbortSignal, get: (id: string) => Promise<MediaRecord | undefined>,
  change: (state: FontState) => void, family = 'ThemeBackgroundLocal') {
  let active = !signal.aborted, generation = 0, config: ThemeFont | undefined
  let face: FontFace | undefined, url: string | undefined
  let state: FontState = 'idle'
  function report(next: FontState) {
    if (state === next) return
    state = next
    change(next)
  }
  function release() {
    generation++
    if (face) { doc.fonts.delete(face); face = undefined }
    if (url) { URL.revokeObjectURL(url); url = undefined }
  }
  async function load(id: string, mime: ThemeFont['mime'], ticket: number) {
    try {
      const media = await get(id)
      if (!active || ticket !== generation) return
      if (!media || media.kind !== 'font' || media.mime !== mime) { report('missing'); return }
      if (await sniffFont(media.blob, signal) !== mime) throw new Error('Font signature changed')
      if (!active || ticket !== generation) return
      const Face = doc.defaultView!.FontFace
      let next: FontFace
      if (typeof media.blob.arrayBuffer === 'function') {
        const buffer = await media.blob.arrayBuffer()
        if (!active || ticket !== generation) return
        next = await new Face(family, buffer).load()
      } else {
        url = URL.createObjectURL(media.blob)
        next = await new Face(family, `url("${url}")`).load()
      }
      if (!active || ticket !== generation) return
      doc.fonts.add(next)
      face = next
      report('ready')
    } catch {
      if (!active || ticket !== generation) return
      release()
      report('error')
    }
  }
  function update(next: ThemeFont | undefined, retry = false) {
    if (!active) return
    if (!retry && config?.enabled === next?.enabled && config?.mediaId === next?.mediaId && config?.mime === next?.mime) return
    config = next
    release()
    if (!next?.enabled || !next.mediaId) { report('idle'); return }
    report('loading')
    void load(next.mediaId, next.mime, generation)
  }
  function dispose() {
    if (!active) return
    active = false
    signal.removeEventListener('abort', dispose)
    release()
  }
  if (active) signal.addEventListener('abort', dispose, { once: true })
  return { update, retry: () => update(config, true), dispose, get state() { return state } }
}
