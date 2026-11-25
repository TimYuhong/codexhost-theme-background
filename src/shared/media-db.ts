import { FONT_MIMES, UUID4, VIDEO_MIMES } from './config.ts'
import { rotationStep } from './rotation.ts'
import type { Rotation } from './config.ts'
import type { RotationAction, RotationState } from './rotation.ts'
import { loadVideoFrame, prepareVideo, releaseVideo } from './video.ts'

export type MediaRecord = {
  id: string; kind: 'image' | 'video' | 'font'; mime: string
  name: string; size: number; createdAt: number; blob: Blob
}
export type MediaSummary = Omit<MediaRecord, 'blob'>
export interface MediaStore {
  list(kind: MediaRecord['kind']): Promise<MediaSummary[]>
  get(id: string): Promise<MediaRecord | undefined>
  backgroundBlob(id: string, kind: 'image' | 'video', mime?: string): Promise<Blob | undefined>
  put(record: MediaRecord): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<string[]>
  rotate(pool: Rotation, action: RotationAction, now?: Date): Promise<ReturnType<typeof rotationStep>>
  close(): void
}
const NAME = 'codexhost.ext.theme-background.media'
const TABLE = 'media', ROTATION = 'rotationState'
export const MAX_IMAGE = 20 * 1024 * 1024
export const MAX_VIDEO = 200 * 1024 * 1024
export const MAX_FONT = 50 * 1024 * 1024
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const

export const withMime = (file: Blob, mime: string) => file.type === mime ? file : file.slice(0, file.size, mime)
const MAX_FTYP = 4096
const ascii = (bytes: Uint8Array, start = 0, end = bytes.length) => String.fromCharCode(...bytes.subarray(start, end))
function brands(bytes: Uint8Array) {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') return []
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = header.getUint32(0), offset = 8
  if (end === 1) { end = Number(header.getBigUint64(8)); offset = 16 }
  if (end < offset + 8 || end > bytes.length || (end - offset) % 4) return []
  const result = [ascii(bytes, offset, offset + 4)]
  for (let i = offset + 8; i < end; i += 4) result.push(ascii(bytes, i, i + 4))
  return result
}
const isAvif = (types: string[]) => types.some(brand => brand === 'avif' || brand === 'avis')
const mp4Brand = /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |dash|cmf[cs]|MSNV)$/

export function createMediaStore(): MediaStore {
  let closed = false, db: IDBDatabase | undefined, opening: Promise<IDBDatabase> | undefined
  let cancelOpen: (() => void) | undefined
  const transactions = new Set<IDBTransaction>()
  function open() {
    if (closed) return Promise.reject(new DOMException('Store closed', 'AbortError'))
    if (db) return Promise.resolve(db)
    if (opening) return opening
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(NAME, 2)
      let abandoned = false
      const fail = (error: unknown) => { abandoned = true; reject(error) }
      cancelOpen = () => fail(new DOMException('Store closed', 'AbortError'))
      request.onupgradeneeded = event => {
        if (abandoned) { request.transaction?.abort(); return }
        if (event.oldVersion < 1) request.result.createObjectStore(TABLE, { keyPath: 'id' }).createIndex('byKind', 'kind')
        if (event.oldVersion < 2) request.result.createObjectStore(ROTATION, { keyPath: 'poolId' })
      }
      request.onblocked = () => fail(new DOMException('Close other tabs using this library', 'BlockedError'))
      request.onerror = () => fail(request.error)
      request.onsuccess = () => {
        const connection = request.result
        if (abandoned || closed) { connection.close(); return }
        db = connection
        const release = () => { connection.close(); if (db === connection) db = undefined }
        connection.onversionchange = release
        connection.onclose = release
        resolve(connection)
      }
    }).finally(() => { opening = undefined; cancelOpen = undefined })
    return opening
  }
  async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void, table = TABLE): Promise<T> {
    const connection = await open()
    if (closed) throw new DOMException('Store closed', 'AbortError')
    return new Promise((resolve, reject) => {
      const tx = connection.transaction(table, mode)
      transactions.add(tx)
      let value: T
      let failure: DOMException | null = null
      tx.oncomplete = () => { transactions.delete(tx); resolve(value) }
      tx.onerror = event => { failure = (event.target as IDBRequest).error ?? tx.error }
      tx.onabort = () => { transactions.delete(tx); reject(failure ?? tx.error ?? new DOMException('Transaction aborted', 'AbortError')) }
      try { run(tx.objectStore(table), next => { value = next }) } catch (error) { tx.abort(); reject(error) }
    })
  }
  function get(id: string) {
    return transaction<MediaRecord | undefined>('readonly', (store, result) => {
      const request = store.get(id)
      request.onsuccess = () => result(request.result)
    })
  }
  return {
    list(kind) {
      return transaction<MediaSummary[]>('readonly', (store, result) => {
        const rows: MediaSummary[] = []
        const request = store.index('byKind').openCursor(kind)
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) { result(rows.sort((a, b) => b.createdAt - a.createdAt)); return }
          const { id, kind, mime, name, size, createdAt } = cursor.value as MediaRecord
          rows.push({ id, kind, mime, name, size, createdAt })
          cursor.continue()
        }
      })
    },
    get,
    async backgroundBlob(id, kind, mime) {
      const record = await get(id)
      return record?.kind === kind && (!mime || record.mime === mime) ? record.blob : undefined
    },
    put(record) {
      if (!UUID4.test(record.id) || record.id !== record.id.toLowerCase()) return Promise.reject(new TypeError('Invalid media ID'))
      return transaction<void>('readwrite', store => { store.add(record) })
    },
    remove(id) { return transaction<void>('readwrite', store => { store.delete(id) }) },
    clear() {
      return transaction<string[]>('readwrite', (store, result) => {
        const keys = store.getAllKeys()
        keys.onsuccess = () => { result(keys.result as string[]); store.clear() }
      })
    },
    rotate(pool, action, now) {
      return transaction<ReturnType<typeof rotationStep>>(action === 'read' ? 'readonly' : 'readwrite', (store, result) => {
        const request = store.get(pool.poolId)
        request.onsuccess = () => {
          const next = rotationStep(pool, request.result as RotationState | undefined, action, now)
          if (next.changed) store.put(next.state)
          result(next)
        }
      }, ROTATION)
    },
    close() {
      if (closed) return
      closed = true
      cancelOpen?.()
      for (const tx of transactions) { try { tx.abort() } catch { /* Completion is already queued. */ } }
      db?.close()
      db = undefined
    },
  }
}

export async function sniffFont(file: Blob, signal: AbortSignal) {
  if (!file.size || file.size > MAX_FONT) throw new DOMException('Font must be 1 byte to 50 MiB', 'SizeError')
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  signal.throwIfAborted()
  const signature = String.fromCharCode(...bytes)
  if (signature === 'ttcf') throw new DOMException('Select an individual font instead of a font collection', 'CollectionError')
  const mime = signature === 'wOF2' ? FONT_MIMES[0] : signature === 'wOFF' ? FONT_MIMES[1]
    : signature === '\x00\x01\x00\x00' || signature === 'true' ? FONT_MIMES[2] : signature === 'OTTO' ? FONT_MIMES[3] : null
  if (!mime) throw new DOMException('Unsupported font signature', 'MimeError')
  return mime
}

export async function validateVideo(file: Blob, doc: Document, signal: AbortSignal) {
  if (!file.size || file.size > MAX_VIDEO) throw new DOMException('Video must be 1 byte to 200 MiB', 'SizeError')
  const bytes = new Uint8Array(await file.slice(0, MAX_FTYP).arrayBuffer())
  signal.throwIfAborted()
  const types = brands(bytes)
  const mime = !isAvif(types) && types.some(brand => mp4Brand.test(brand)) ? VIDEO_MIMES[0]
    : bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 &&
      ascii(bytes).includes('webm') ? VIDEO_MIMES[1] : null
  if (!mime) throw new DOMException('Expected an MP4 or WebM signature', 'MimeError')
  const video = prepareVideo(doc), url = URL.createObjectURL(withMime(file, mime))
  try { await loadVideoFrame(video, url, signal); signal.throwIfAborted(); return mime }
  finally { releaseVideo(video); URL.revokeObjectURL(url) }
}

export async function validateImage(file: Blob, doc: Document, signal: AbortSignal) {
  if (!file.size || file.size > MAX_IMAGE) throw new DOMException('Image must be 1 byte to 20 MiB', 'SizeError')
  const bytes = new Uint8Array(await file.slice(0, MAX_FTYP).arrayBuffer())
  signal.throwIfAborted()
  const starts = (signature: number[], offset = 0) => signature.every((byte, i) => bytes[i + offset] === byte)
  const gif = ascii(bytes, 0, 6)
  const mime = starts([255, 216, 255]) ? 'image/jpeg'
    : starts([137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
    : ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP' ? 'image/webp'
    : gif === 'GIF87a' || gif === 'GIF89a' ? 'image/gif'
    : isAvif(brands(bytes)) ? 'image/avif' : null
  if (!mime) throw new DOMException('Unsupported image signature', 'MimeError')
  const image = doc.createElement('img'), url = URL.createObjectURL(withMime(file, mime))
  const detach = () => image.removeAttribute('src')
  signal.addEventListener('abort', detach, { once: true })
  try {
    image.src = url
    await image.decode()
    signal.throwIfAborted()
    if (!image.naturalWidth || !image.naturalHeight) throw new DOMException('Empty decoded image', 'EncodingError')
    return mime
  } finally {
    signal.removeEventListener('abort', detach)
    detach()
    URL.revokeObjectURL(url)
  }
}
