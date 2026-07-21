// Post-build step for `npm run build:pages`.
//
// The GitHub Pages landing bundle is built from `landing.html`, so Vite emits
// `dist-pages/landing.html`. GitHub Pages serves a directory's `index.html`, so
// rename it to `index.html` at the output root (that is what
// https://inajaf.github.io/you-ads-blocker/ requests).
import { rename, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const outDir = fileURLToPath(new URL('../dist-pages/', import.meta.url))
const from = `${outDir}landing.html`
const to = `${outDir}index.html`

try {
  await access(from)
} catch {
  throw new Error(
    `pages-index: expected ${from} from the pages build but it was not found`,
  )
}

await rename(from, to)
console.log('pages-index: dist-pages/landing.html -> dist-pages/index.html')
