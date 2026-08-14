/**
 * Evaluate an expression on a specific CDP target (supports file: URLs).
 * Usage: node scripts/cdp-eval-target.mjs <url-match> <expr|@file>
 */
const urlMatch = process.argv[2]
const rawArg = process.argv[3]
if (!urlMatch || !rawArg) {
  console.error('usage: node scripts/cdp-eval-target.mjs <url-match> "<expr>|@file.txt"')
  process.exit(2)
}
const expr = rawArg.startsWith('@')
  ? (await import('node:fs/promises')).readFile(rawArg.slice(1), 'utf8')
  : rawArg

const list = await (await fetch('http://localhost:9222/json')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes(urlMatch))
if (!target) {
  console.error('no matching page target for', urlMatch)
  process.exit(1)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let id = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = ++id
    pending.set(msgId, resolve)
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
if (res.result?.exceptionDetails) {
  console.error('EXCEPTION:', JSON.stringify(res.result.exceptionDetails).slice(0, 500))
  process.exit(1)
}
console.log(JSON.stringify(res.result?.result?.value, null, 2))
ws.close()
