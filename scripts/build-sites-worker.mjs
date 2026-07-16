import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'dist', 'server')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

await build({
  configFile: false,
  root,
  logLevel: 'warn',
  build: {
    ssr: path.join(root, 'sites', 'worker.mjs'),
    outDir,
    emptyOutDir: false,
    copyPublicDir: false,
    target: 'es2022',
    minify: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'index.js',
      },
    },
  },
})

console.log('Sites worker built at dist/server/index.js')
