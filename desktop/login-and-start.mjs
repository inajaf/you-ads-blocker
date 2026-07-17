import { spawn } from 'node:child_process'
import chromeAuth from './chrome-auth.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromePath, ensureChromeRuntime, profileDir } from './runtime-paths.mjs'

const desktopDir = path.dirname(fileURLToPath(import.meta.url))
const { GOOGLE_LOGIN_URL } = chromeAuth

ensureChromeRuntime()

console.log('Sign in with the supported Google Chrome window.')
console.log('Close that window after YouTube shows your avatar; Tube will open automatically.')

const login = spawn(
  chromePath,
  [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--disable-infobars',
    `--app=${GOOGLE_LOGIN_URL}`,
  ],
  { stdio: 'inherit' },
)

const code = await new Promise((resolve) => login.once('exit', resolve))
if (code !== 0 && code !== null) process.exit(code)

await import(path.join(desktopDir, 'start-chrome-app.mjs'))
