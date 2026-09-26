// Captures the bridge's own console output (and the shadow's state) while a watch
// page loads and starts playing, so the reason a shadow build fails on a real
// device is visible instead of inferred.
//
//   node scripts/phone-shadow-diagnose.mjs [url] [seconds]

const url = process.argv[2] || 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'
const seconds = Number(process.argv[3] || 45)

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = targets.find((entry) => entry.type === 'page')
if (!target) throw new Error('no page target; is the app running and forwarded?')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let nextId = 0
const pending = new Map()
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
    return
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args || [])
      .map((arg) => arg.value ?? arg.description ?? '')
      .join(' ')
    if (text.includes('AdVoid')) console.log(`[console.${message.params.type}] ${text}`)
  }
  if (message.method === 'Log.entryAdded') {
    const text = message.params.entry?.text || ''
    if (text.includes('AdVoid')) console.log(`[log] ${text}`)
  }
  if (message.method === 'Runtime.exceptionThrown') {
    console.log(`[exception] ${message.params.exceptionDetails?.text}`)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  const details = response.result?.exceptionDetails
  if (details) return `EXC: ${details.exception?.description || details.text}`
  return response.result?.result?.value
}

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')

console.log('before:', await evaluate('JSON.stringify(window._advoidShadowState ? window._advoidShadowState() : null)'))
await send('Page.navigate', { url })
await new Promise((resolve) => setTimeout(resolve, 15000))
await evaluate(`(async () => {
  var video = document.querySelector('.html5-video-player video');
  if (video) { video.muted = false; await video.play().catch(function() {}); }
  return 'ok';
})()`)

const started = Date.now()
while (Date.now() - started < seconds * 1000) {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const state = await evaluate(`(() => {
    var video = document.querySelector('.html5-video-player video');
    var shadow = document.getElementById('advoid-shadow-audio');
    return JSON.stringify({
      presentable: window._advoidPresentable,
      armed: window._advoidBgAudioArmed === true,
      video: video ? { paused: video.paused, readyState: video.readyState, ct: Number(video.currentTime.toFixed(1)) } : null,
      shadow: shadow ? { muted: shadow.muted, readyState: shadow.readyState } : null,
      shadowState: typeof window._advoidShadowState === 'function' ? window._advoidShadowState() : null
    });
  })()`)
  console.log(`t+${Math.round((Date.now() - started) / 1000)}s`, state)
}

ws.close()
