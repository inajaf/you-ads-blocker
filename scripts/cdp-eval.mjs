/**
 * Minimal CDP driver for the running AdVoid Electron app (dev/debug helper).
 * Usage:
 *   node scripts/cdp-eval.mjs "<expression>" [--url-match=watch] [--gesture]
 *
 * Connects to the first page target whose URL contains --url-match (default:
 * "youtube"), evaluates the expression in the main world, and prints the
 * JSON-serializable result. With --gesture, evaluation runs with transient
 * user activation (so requestFullscreen()/play() work).
 */
const rawArg = process.argv[2]
if (!rawArg) {
  console.error('usage: node scripts/cdp-eval.mjs "<expr>|@file.txt" [--url-match=...] [--gesture]')
  process.exit(2)
}
const expr = rawArg.startsWith('@')
  ? await import('node:fs/promises').then((fs) => fs.readFile(rawArg.slice(1), 'utf8'))
  : rawArg
const urlMatch = (process.argv.find((a) => a.startsWith('--url-match=')) || '--url-match=youtube').slice('--url-match='.length)
const gesture = process.argv.includes('--gesture')

const list = await (await fetch('http://localhost:9222/json')).json()
const target = list.find(
  (t) => t.type === 'page' && t.url.includes(urlMatch) && !t.url.startsWith('file:'),
)
if (!target) {
  console.error('no matching page target for', urlMatch)
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let id = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = ++id
    pending.set(msgId, resolve)
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}

const result = await send('Runtime.evaluate', {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
  userGesture: gesture,
})
if (result.result?.exceptionDetails) {
  console.error('EXCEPTION:', JSON.stringify(result.result.exceptionDetails, null, 2))
  ws.close()
  process.exit(1)
}
console.log(JSON.stringify(result.result?.result?.value, null, 2))
ws.close()
