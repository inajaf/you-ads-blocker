import { spawn } from 'node:child_process'
import chromeAuth from './chrome-auth.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromePath, ensureChromeRuntime, profileDir } from './runtime-paths.mjs'

const desktopDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDir = path.resolve(desktopDir, '..', 'dist-extension')
const { GOOGLE_LOGIN_URL } = chromeAuth

ensureChromeRuntime()

console.log('Sign in with the supported Google Chrome window.')
console.log('Close that window after YouTube shows your avatar; Tube will open automatically.')

const login = spawn(
  chromePath,
  [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--disable-infobars',
    `--app=${GOOGLE_LOGIN_URL}`,
  ],
  { stdio: 'inherit' },
)

const result = await new Promise((resolve, reject) => {
  login.once('error', reject)
  login.once('exit', (code, signal) => resolve({ code, signal }))
}).catch((error) => {
  console.error(`Chrome sign-in could not be started: ${error.message}`)
  process.exit(1)
})

if (result.signal || result.code !== 0) {
  const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.code}`
  console.error(`Chrome sign-in closed unexpectedly (${reason}).`)
  process.exit(result.code || 1)
}

await import(path.join(desktopDir, 'start-chrome-app.mjs'))
