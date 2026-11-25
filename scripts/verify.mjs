import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const KIB = 1024, MIB = KIB * KIB, JS_BUDGET = 512 * KIB
const ICON_LIMIT = 128 * KIB, SHOT_LIMIT = 512 * KIB
const names = [
  'LICENSE', 'desktop.css', 'desktop.js', 'icon.png', 'manifest.json',
  'page.css', 'page.mjs', 'preview-dark.webp', 'preview-light.webp', 'preview-settings.webp',
  'web.css', 'web.mjs',
]
const manifestSource = await readFile('manifest.json')
const pkg = JSON.parse(await readFile('package.json', 'utf8'))

const forbiddenNames = /^(?:require|__require\w*|eval|Function|AsyncFunction|GeneratorFunction|importScripts|Worker|SharedWorker|innerHTML|outerHTML|insertAdjacentHTML|srcdoc|trustedTypes|__ModuleLoader__)$/
function literal(node) {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return literal(node.expression)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literal(node.left), right = literal(node.right)
    if (left !== undefined && right !== undefined) return left + right
  }
}
function cssCheck(name, text) {
  const decoded = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([^\r\n]))/g,
    (_, code, escaped) => escaped ?? String.fromCodePoint(Math.min(0x10ffff, parseInt(code, 16))))
  assert.doesNotMatch(decoded, /@import\b|\b(?:url|image-set|-webkit-image-set|src)\s*\(/i, `${name}: CSS imports and external resources are forbidden`)
}
function imageCheck(name, bytes) {
  if (name.endsWith('.png')) {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name}: invalid PNG signature`)
  } else if (name.endsWith('.webp')) {
    assert.ok(bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP', `${name}: invalid WebP signature`)
  }
}
function jsCheck(name, text) {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  function walk(node) {
    const fail = msg => {
      const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file))
      throw new Error(`${name}:${line + 1}:${character + 1}: ${msg}`)
    }
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) fail('runtime module specifier')
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) fail('import.meta')
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) fail('dynamic import')
    const word = ts.isIdentifier(node) ? node.text : literal(node)
    if (word && forbiddenNames.test(word)) fail(`forbidden JS capability ${word}`)
    if (word?.toLowerCase() === 'script') fail('script element creation/loading')
    if ((ts.isPropertyAccessExpression(node) && node.name.text === 'constructor') ||
        (ts.isElementAccessExpression(node) && literal(node.argumentExpression) === 'constructor')) fail('constructor member access')
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) ? literal(callee.argumentExpression) : undefined
      if (method && /^(?:setAttribute|setAttributeNS)$/i.test(method)) {
        const key = node.arguments[method === 'setAttributeNS' ? 1 : 0]
        if (key && /^on/i.test(literal(key) ?? '')) fail('inline event attribute')
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
}

async function verify(dir, print = false) {
  assert.ok((await lstat(dir)).isDirectory(), `${dir}: expected a real directory`)
  const entries = (await readdir(dir)).sort()
  for (const name of names) assert.ok(entries.includes(name), `${name}: missing dist file`)
  for (const name of entries) assert.ok(names.includes(name), `${name}: unexpected dist file`)
  for (const name of names) {
    const stat = await lstat(join(dir, name))
    assert.ok(stat.isFile(), `${name}: expected a regular file`)
    const js = /\.(?:m?js)$/.test(name)
    const host = name === 'manifest.json' ? 128 * KIB : name === 'icon.png' ? ICON_LIMIT : name.endsWith('.webp') ? SHOT_LIMIT : js ? 2 * MIB : name.endsWith('.css') ? 256 * KIB : 16 * MIB
    assert.ok(stat.size > 0 && stat.size <= host, `${name}: ${stat.size} bytes outside Host limit ${host}`)
    if (js) assert.ok(stat.size <= JS_BUDGET, `${name}: ${stat.size} bytes exceeds project budget ${JS_BUDGET}`)
    if (print) console.log(`${name}\t${stat.size}`)
  }
  const manifest = await readFile(join(dir, 'manifest.json'))
  assert.deepEqual(manifest, manifestSource, 'manifest.json: differs from source')
  const m = JSON.parse(manifest)
  assert.equal(m.version, pkg.version, 'manifest.json: package version mismatch')
  assert.ok(typeof m.author === 'string' && m.author.trim().length > 0, 'manifest.json: author is required')
  assert.deepEqual([m.page.entry, m.desktop.script, m.web.entry], ['page.mjs', 'desktop.js', 'web.mjs'], 'manifest.json: bad entry paths')
  assert.deepEqual([m.page.style, m.desktop.style, m.web.style], ['page.css', 'desktop.css', 'web.css'], 'manifest.json: bad CSS paths')
  assert.equal(m.icon, 'icon.png', 'manifest.json: bad icon path')
  assert.deepEqual(m.screenshots, ['preview-dark.webp', 'preview-settings.webp', 'preview-light.webp'], 'manifest.json: bad screenshots list')
  for (const name of [m.icon, ...m.screenshots]) imageCheck(name, await readFile(join(dir, name)))
  for (const name of names.filter(name => name.endsWith('.css'))) cssCheck(name, await readFile(join(dir, name), 'utf8'))
  for (const [name, exported] of [['page.mjs', 'mount'], ['web.mjs', 'activate'], ['desktop.js', undefined]]) {
    const path = join(dir, name), text = await readFile(path, 'utf8')
    jsCheck(name, text)
    if (exported) {
      try { execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' }) }
      catch (error) { throw new Error(`${name}: node --check failed\n${error.stderr}`) }
      const entry = await import(pathToFileURL(path).href)
      assert.equal(typeof entry[exported], 'function', `${name}: missing ${exported} export`)
      assert.deepEqual(Object.keys(entry), [exported], `${name}: unexpected exports`)
    } else {
      const registrations = []
      const context = vm.createContext({ define: extension => { registrations.push(extension) } }, { codeGeneration: { strings: false, wasm: false } })
      const script = new vm.Script(text, { filename: name })
      script.runInContext(context, { timeout: 1000 })
      assert.equal(registrations.length, 1, `${name}: expected one synchronous define call`)
      assert.equal(typeof registrations[0].activate, 'function', `${name}: missing activate`)
    }
  }
}

cssCheck('src/desktop/settings-shadow.css', await readFile('src/desktop/settings-shadow.css', 'utf8'))
const dist = resolve('dist')
await verify(dist, true)
const tmp = await mkdtemp(join(tmpdir(), 'theme-background-verify-'))
try {
  for (const [name, pattern, modify] of [
    ['dynamic-import', /page\.mjs.*dynamic import/, dir => writeFile(join(dir, 'page.mjs'), 'export const mount = () => import(location.href)')],
    ['bare-specifier', /web\.mjs.*runtime module specifier/, dir => writeFile(join(dir, 'web.mjs'), 'import "bare"; export const activate = () => {}')],
    ['classic-export', /desktop\.js.*Unexpected token.*export/s, dir => writeFile(join(dir, 'desktop.js'), 'export function activate() {}')],
    ['oversize', /desktop\.js.*exceeds project budget/, dir => truncate(join(dir, 'desktop.js'), JS_BUDGET + 1)],
    ['missing-css', /web\.css.*missing dist file/, dir => rm(join(dir, 'web.css'))],
  ]) {
    const dir = join(tmp, name)
    await cp(dist, dir, { recursive: true })
    await modify(dir)
    await assert.rejects(verify(dir), error => pattern.test(`${error.stack}`), `Negative fixture not diagnosed: ${name}`)
    console.log(`Rejected fixture: ${name}`)
  }
} finally { await rm(tmp, { recursive: true, force: true }) }
