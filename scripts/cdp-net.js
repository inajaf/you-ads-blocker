/**
 * Capture the WebView's network requests for ~10s and report any googlevideo
 * videoplayback URLs (which carry the deciphered sig) the media element made.
 */
const list = await (await fetch('http://localhost:9222/json')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('youtube') && !t.url.startsWith('file:'))
if (!target) { console.error('no target'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
const hits = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  else if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url
    if (/googlevideo\.com\/videoplayback/.test(u)) {
      const sig = (u.match(/[?&](sig|signature)=([^&]+)/) || [])[2]
      hits.push({ hasSig: !!sig, sigLen: sig ? sig.length : 0, hasRange: /[?&](range|rn)=/.test(u), hasN: /[?&]n=/.test(u) })
    }
  }
}
function send(method, params = {}) {
  return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
}
await send('Network.enable')
// ensure a video is playing
await send('Runtime.evaluate', { expression: `(() => { const v = document.querySelector('video'); if (v && v.paused) v.play(); return 'playing'; })()` })
await new Promise((r) => setTimeout(r, 12000))
console.log('videoplayback requests captured:', hits.length)
console.log(JSON.stringify(hits.slice(0, 12), null, 2))
ws.close()
