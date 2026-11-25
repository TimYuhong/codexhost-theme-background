import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ref = process.env.CH_REFERENCE_DIR
assert.ok(ref, 'CH_REFERENCE_DIR must point to the isolated reference build')
const url = pathToFileURL(resolve(ref, 'packages/shared-contracts/dist/host-extensions.js'))
const { hostExtensionManifestV2Schema: schema } = await import(url.href)
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'))

function check(m) {
  schema.parse(m)
  assert.equal(m.manifestVersion, 2)
  assert.equal(m.id, 'theme-background')
  assert.equal(m.version, '1.0.0')
  assert.deepEqual(m.slots, ['appearance.theme'])
  for (const key of ['settingsSchema', 'backend', 'widget']) assert.ok(!Object.hasOwn(m, key), `Forbidden manifest field: ${key}`)
  assert.deepEqual([m.page.entry, m.desktop.script, m.web.entry], ['page.mjs', 'desktop.js', 'web.mjs'])
  assert.deepEqual([m.page.style, m.desktop.style, m.web.style], ['page.css', 'desktop.css', 'web.css'])
}
check(manifest)
for (const [name, invalid] of [
  ['desktop entry', { ...manifest, desktop: { apiVersion: 1, entry: 'desktop.js' } }],
  ['page suffix', { ...manifest, page: { apiVersion: 1, entry: 'page.js' } }],
  ['slot', { ...manifest, slots: ['theme'] }],
  ['incomplete locale', { ...manifest, name: { en: 'Theme' } }],
]) assert.equal(schema.safeParse(invalid).success, false, `Host accepted invalid ${name}`)
const emptySchema = { ...manifest, settingsSchema: [] }
assert.equal(schema.safeParse(emptySchema).success, true)
assert.throws(() => check(emptySchema), /Forbidden manifest field: settingsSchema/)
console.log('Real Host Zod schema: manifest accepted, 4 invalid manifests rejected, settingsSchema: [] rejected by package policy')
