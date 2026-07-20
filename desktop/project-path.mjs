import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isPacked = __filename.includes('.asar')

export function resolveProjectPath(...segments) {
  const base = isPacked ? process.resourcesPath : path.resolve(__dirname, '..')
  return path.join(base, ...segments)
}
