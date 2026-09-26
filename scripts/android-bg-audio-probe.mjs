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
  var player = video && video.closest ? video.closest('.html5-video-player') : null;
  var videoRect = video ? video.getBoundingClientRect() : null;
  var playerRect = player ? player.getBoundingClientRect() : null;
  return JSON.stringify({
    url: location.pathname,
    visibility: document.visibilityState,
    hidden: document.hidden,
    armed: window._advoidBgAudioArmed === true,
    suppressPause: window._advoidSuppressPagePause === true,
    pipClass: document.documentElement.classList.contains('advoid-pip'),
    paused: video ? video.paused : null,
    currentTime: video ? Number(video.currentTime.toFixed(2)) : null,
    readyState: video ? video.readyState : null,
    // The "player is dead" signature: a video pushed above its own player box.
    videoTop: videoRect ? Math.round(videoRect.top) : null,
    playerTop: playerRect ? Math.round(playerRect.top) : null,
    videoInlineTop: video ? (video.style.top || '') : null,
    playingMode: document.querySelectorAll('.html5-video-player.playing-mode').length
  });
})()`

/** Taps the video centre through CDP, which produces a trusted gesture. */
async function tapVideoCentre() {
  const rect = await evaluate(`(() => {
    var v = document.querySelector('.html5-video-player video');
    if (!v) return null;
    var r = v.getBoundingClientRect();
    return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]);
  })()`)
  if (!rect) {
    console.error('no video to tap')
    return
  }
  const [x, y] = JSON.parse(rect)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  console.log(`tapped ${x},${y}`)
  console.log('state:', await evaluate(PROBE))
}

/** Taps YouTube's own play/pause control, the "force the play button" path. */
async function tapPlayControl() {
  const rect = await evaluate(`(() => {
    var b = document.querySelector('.player-control-play-pause-icon') ||
      document.querySelector('button[aria-label="play video"]') ||
      document.querySelector('button[aria-label="pause video"]') ||
      document.querySelector('.ytp-play-button');
    if (!b) return null;
    var r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]);
  })()`)
  if (!rect) {
    console.error('no play/pause control reachable')
    return
  }
  const [x, y] = JSON.parse(rect)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await new Promise((resolve) => setTimeout(resolve, 2000))
  console.log(`tapped play control ${x},${y}`)
  console.log('state:', await evaluate(PROBE))
}

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
} else if (mode === 'tap') {
  await tapVideoCentre()
} else if (mode === 'playbutton') {
  await tapPlayControl()
} else {
  console.log('state:', await evaluate(PROBE))
}

ws.close()
