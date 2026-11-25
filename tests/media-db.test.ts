import assert from 'node:assert/strict'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { validateFont } from '../src/shared/font-loader.ts'
import { MAX_FONT, MAX_IMAGE, MAX_VIDEO, sniffFont, validateImage, validateVideo, withMime } from '../src/shared/media-db.ts'

const signal = new AbortController().signal
function ftyp(major: string, ...compatible: string[]) {
  const box = Buffer.alloc(16 + 4 * compatible.length)
  box.writeUInt32BE(box.length)
  box.write('ftyp' + major, 4)
  compatible.forEach((brand, i) => box.write(brand, 16 + 4 * i))
  return box
}
function decoders(context: TestContext) {
  const blobs: Blob[] = [], revoked: string[] = []
  let fail = false
  context.mock.method(URL, 'createObjectURL', (blob: Blob) => { blobs.push(blob); return String(blobs.length) })
  context.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url))
  const doc = {
    createElement(tag: string) {
      if (tag === 'img') return {
        naturalWidth: 3, naturalHeight: 4, removeAttribute() {},
        async decode() { if (fail) throw new DOMException('Corrupt image', 'EncodingError') },
      }
      const video = Object.assign(new EventTarget(), { videoWidth: 320, videoHeight: 240, pause() {}, load() {}, removeAttribute() {} })
      return Object.defineProperty(video, 'src', { set() { queueMicrotask(() => video.dispatchEvent(new Event(fail ? 'error' : 'loadeddata'))) } })
    },
  }
  return { doc: doc as unknown as Document, blobs, revoked, fail() { fail = true } }
}

test('empty and aliased MIME types use the decoded canonical format without changing bytes', async context => {
  const { doc, blobs, revoked } = decoders(context)
  for (const [bytes, type, mime, video] of [
    [Buffer.from('GIF87a'), '', 'image/gif', false], [Buffer.from('GIF89a'), 'application/octet-stream', 'image/gif', false],
    [ftyp('mif1', 'miaf', 'avif'), 'image/heif', 'image/avif', false], [ftyp('avis'), '', 'image/avif', false],
    [Buffer.from([255, 216, 255]), 'image/jpg', 'image/jpeg', false],
    [ftyp('isom', 'mp42'), '', 'video/mp4', true], [Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('webm')]), 'application/webm', 'video/webm', true],
  ] as const) {
    const file = new File([bytes], 'test', { type })
    const decoded = await (video ? validateVideo : validateImage)(file, doc, signal)
    assert.equal(decoded, mime)
    for (const blob of [blobs.at(-1)!, withMime(file, decoded)]) {
      assert.equal(blob.type, mime)
      assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes)
    }
  }
  assert.equal(revoked.length, blobs.length)
})

test('reject out-of-box brands, spoofed ftyp, and recognized formats that fail to decode', async context => {
  const d = decoders(context)
  const fake = ftyp('junk', 'avif'); fake.writeUInt32BE(16)
  const truncated = ftyp('avif'); truncated.writeUInt32BE(8192)
  for (const bytes of [fake, truncated, ftyp('junk'), ftyp('avif', 'isom')]) {
    await assert.rejects(validateVideo(new Blob([bytes]), d.doc, signal), { name: 'MimeError' })
  }
  for (const bytes of [fake, truncated, ftyp('isom'), Buffer.from('GIF00a')]) {
    await assert.rejects(validateImage(new Blob([bytes]), d.doc, signal), { name: 'MimeError' })
  }
  assert.equal(d.blobs.length, 0)
  d.fail()
  await assert.rejects(validateImage(new Blob(['GIF89a']), d.doc, signal), { name: 'EncodingError' })
  await assert.rejects(validateVideo(new Blob([ftyp('mp42')]), d.doc, signal), { name: 'EncodingError' })
  assert.equal(d.revoked.length, 2)
})

test('file size boundaries precede decoding and TTC/OTC gets its own error', async context => {
  const { doc } = decoders(context)
  const virtual = (size: number, header: string | Buffer) => ({ size, type: '', slice: () => new Blob([typeof header === 'string' ? header : Uint8Array.from(header)]) }) as Blob
  for (const [validate, max, header] of [[validateImage, MAX_IMAGE, 'GIF89a'], [validateVideo, MAX_VIDEO, ftyp('mp42')]] as const) {
    await assert.rejects(validate(virtual(0, header), doc, signal), { name: 'SizeError' })
    await assert.rejects(validate(virtual(max + 1, header), doc, signal), { name: 'SizeError' })
    assert.ok(await validate(virtual(max, header), doc, signal))
  }
  assert.equal(await sniffFont(virtual(MAX_FONT, 'wOF2'), signal), 'font/woff2')
  await assert.rejects(sniffFont(virtual(MAX_FONT + 1, 'wOF2'), signal), { name: 'SizeError' })
  await assert.rejects(validateFont(new Blob(['ttcf']), doc, signal), { name: 'CollectionError' })
})
