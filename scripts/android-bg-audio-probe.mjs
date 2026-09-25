/**
 * Emulator probe for AdVoid background audio.
 *
 * The WebView is debuggable on every build, so this drives the real page over
 * CDP. Native state (foreground service, audio focus/hardening, notification)
 * is read with adb in the shell; this script owns the page side.
 *
 * Prerequisites (see docs/decisions.md for the full verification recipe):
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *
 * Usage:
 *   node scripts/android-bg-audio-probe.mjs play <watch-url>   # navigate + play
 *   node scripts/android-bg-audio-probe.mjs sample [seconds]   # sample playback
 */
const [mode, argument] = process.argv.slice(2)

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((t) => t.type === 'page')
if (!target) {
  console.error('no WebView page target; is the adb forward set up?')
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
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const next = ++id
    pending.set(next, resolve)
    ws.send(JSON.stringify({ id: next, method, params }))
  })
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
    .result?.result?.value

const PROBE = `(() => {
  var videos = Array.prototype.slice.call(document.querySelectorAll('.html5-video-player video'));
  var video = videos.filter(function(v) { return !v.paused; })[0] || videos[0] || null;
  return JSON.stringify({
    url: location.pathname + location.search,
    visibility: document.visibilityState,
    hidden: document.hidden,
    armed: window._advoidBgAudioArmed === true,
    suppressPause: window._advoidSuppressPagePause === true,
    paused: video ? video.paused : null,
    currentTime: video ? Number(video.currentTime.toFixed(2)) : null,
    readyState: video ? video.readyState : null,
    playingMode: document.querySelectorAll('.html5-video-player.playing-mode').length
  });
})()`

if (mode === 'play') {
  if (!argument) {
    console.error('usage: play <watch-url>')
    process.exit(1)
  }
  await send('Page.enable')
  await send('Page.navigate', { url: argument })
  await new Promise((resolve) => setTimeout(resolve, 10000))
  const started = await evaluate(`(async () => {
    var video = document.querySelector('.html5-video-player video') ||
      document.querySelector('video');
    if (!video) return 'no-video';
    video.muted = false;
    video.volume = 1;
    await video.play().catch(function(e) { return e.name; });
    return 'ok';
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  console.log('play:', started)
  console.log('state:', await evaluate(PROBE))
} else if (mode === 'sample') {
  const seconds = Number(argument || 6)
  for (let i = 0; i < seconds; i += 1) {
    console.log(`t+${i}`, await evaluate(PROBE))
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
} else {
  console.log('state:', await evaluate(PROBE))
}

ws.close()
