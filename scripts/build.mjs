import { build } from 'esbuild'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { markerCss } from '../src/shared/palette.ts'

await mkdir('dist', { recursive: true })
for (const [entry, output, format] of [
  ['page', 'page.mjs', 'esm'], ['desktop', 'desktop.js', 'iife'], ['web', 'web.mjs', 'esm'],
]) {
  await build({
    entryPoints: [`src/${entry}/index.ts`], outfile: `dist/${output}`, format,
    bundle: true, packages: 'bundle', platform: 'browser', target: 'es2022',
    splitting: false, sourcemap: false, legalComments: 'none', minify: true,
    loader: { '.css': 'text' },
  })
}
for (const target of ['desktop', 'web']) {
  const css = await readFile(`src/${target}/${target}.css`, 'utf8')
  await writeFile(`dist/${target}.css`, `${css}\n${markerCss(target)}`)
}
await copyFile('src/page/page.css', 'dist/page.css')
for (const name of ['manifest.json', 'LICENSE']) await copyFile(name, `dist/${name}`)
for (const asset of ['icon.png', 'preview-dark.webp', 'preview-settings.webp', 'preview-light.webp']) {
  await copyFile(`assets/${asset}`, `dist/${asset}`)
}
