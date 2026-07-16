'use strict'

// contextIsolation is false, so this preload shares the page's global object and
// runs in the MAIN world. We must patch the PAGE's own JSON.parse / fetch / XHR
// before page scripts run.
//
// A plain `(0,eval)(code)` is blocked on youtube.com by its Trusted Types CSP
// (`require-trusted-types-for 'script'`), which forbids evaluating strings as
// JS. So we use Electron's webFrame.executeJavaScript, which compiles the source
// directly via V8 (not through the eval sink) and — because contextIsolation is
// false — executes in the page's main world, bypassing the CSP restriction.

const fs = require('fs')
const path = require('path')
const { webFrame } = require('electron')

try {
  const injectPath = path.join(__dirname, '..', 'adblock', 'inject.js')
  const code = fs.readFileSync(injectPath, 'utf8')
  webFrame
    .executeJavaScript(code)
    .then(() => {
      console.log('[Tube] preload injected adblock/inject.js into page world')
    })
    .catch((err) => {
      console.error('[Tube] preload executeJavaScript failed:', err)
    })
} catch (err) {
  console.error('[Tube] preload failed to read inject.js:', err)
}
