// End-to-end acceptance check for the Android background-audio work, run against
// a connected device/emulator with the debug build installed.
//
//   node scripts/android-acceptance.mjs [watch-url]
//
// It drives the app over adb and inspects the live page over CDP, then prints a
// PASS/FAIL per scenario and exits non-zero if anything regressed. The scenarios
// are the reported bugs: audio while locked, while backgrounded (no PiP), a
// second lock after the buffer ran out, resume-on-return, and the transport pause.
//
// Env: ADB (path to adb), PACKAGE (default com.advoid.app.debug).

import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB || 'adb'
const PACKAGE = process.env.PACKAGE || 'com.advoid.app.debug'
const ACTIVITY = `${PACKAGE}/com.advoid.app.MainActivity`
const WATCH_URL = process.argv[2] || 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'

const adb = (...args) =>
  execFileSync(ADB, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // `logcat -d` on a busy emulator easily exceeds the 1 MB default.
    maxBuffer: 64 * 1024 * 1024,
  })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function forwardDevtools() {
  const unix = adb('shell', 'cat /proc/net/unix')
  const socket = (unix.match(/webview_devtools_remote_\d+/) || [])[0]
  if (!socket) throw new Error('no WebView devtools socket: is the app running?')
  adb('forward', '--remove-all')
  adb('forward', 'tcp:9222', `localabstract:${socket}`)
  return socket
}

async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('no page target over CDP')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
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
    if (details) throw new Error(details.exception?.description || details.text || 'evaluate failed')
    return response.result?.result?.value
  }
  return { send, evaluate, close: () => ws.close() }
}

const STATE = `(() => {
  var videos = Array.prototype.slice.call(document.querySelectorAll('.html5-video-player video'));
  var video = videos.filter(function(v) { return !v.paused; })[0] || videos[0] || null;
  var shadow = document.getElementById('advoid-shadow-audio');
  return JSON.stringify({
    url: location.pathname,
    presentable: window._advoidPresentable,
    armed: window._advoidBgAudioArmed === true,
    pipClass: document.documentElement.classList.contains('advoid-pip'),
    video: video ? { paused: video.paused, muted: video.muted, ct: Number(video.currentTime.toFixed(1)) } : null,
    shadow: shadow ? {
      muted: shadow.muted, paused: shadow.paused, readyState: shadow.readyState,
      ct: Number(shadow.currentTime.toFixed(1))
    } : null,
    shadowState: typeof window._advoidShadowState === 'function' ? window._advoidShadowState() : null
  });
})()`

/** Locked/backgrounded audio: the shadow must be audible and advancing. */
const shadowAudible = (state) =>
  state.shadow && state.shadow.muted === false && state.shadow.paused === false &&
  state.shadow.readyState >= 3

async function hasStartedAudioPlayer() {
  const dump = adb('shell', 'dumpsys', 'audio')
  return /state:started[\s\S]{0,200}?com\.advoid|u\/pid:\d+/.test(dump) && dump.includes('state:started')
}

async function main() {
  console.log(`acceptance: ${PACKAGE} on ${WATCH_URL}`)
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
  adb('shell', 'wm', 'dismiss-keyguard')
  adb('logcat', '-c')
  adb('shell', 'am', 'force-stop', PACKAGE)
  adb('shell', 'am', 'start', '-n', ACTIVITY)
  await sleep(9000)
  forwardDevtools()
  const cdp = await connect()

  // 1. Play a video through the page, the way the app does.
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: WATCH_URL })
  await sleep(14000)
  await cdp.evaluate(`(async () => {
    var video = document.querySelector('.html5-video-player video');
    if (video) { video.muted = false; await video.play().catch(function() {}); }
    return 'ok';
  })()`)
  await sleep(6000)
  let state = JSON.parse(await cdp.evaluate(STATE))
  check('playback starts and the bridge arms', state.armed === true && state.video && !state.video.paused,
    `armed=${state.armed} paused=${state.video?.paused} ct=${state.video?.ct}`)
  check('the shadow mirror is built and muted while visible',
    Boolean(state.shadow) && state.shadow.muted === true && state.shadowState?.disabled === false,
    `muted=${state.shadow?.muted} sources=${state.shadowState?.sources} disabled=${state.shadowState?.disabled}`)

  // 2. Lock: the shadow must take over with real audio.
  adb('shell', 'input', 'keyevent', 'KEYCODE_POWER')
  await sleep(8000)
  state = JSON.parse(await cdp.evaluate(STATE))
  const lockedCt = state.shadow?.ct
  check('locked: the shadow is audible', shadowAudible(state),
    `muted=${state.shadow?.muted} paused=${state.shadow?.paused} readyState=${state.shadow?.readyState}`)
  check('locked: the platform reports a started, unmuted player', await hasStartedAudioPlayer())
  await sleep(6000)
  const later = JSON.parse(await cdp.evaluate(STATE))
  check('locked: audio is actually advancing', later.shadow && later.shadow.ct > lockedCt,
    `${lockedCt} -> ${later.shadow?.ct}`)

  // 3. Return: the video resumes from where the audio was, shadow muted again.
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
  await sleep(2000)
  adb('shell', 'wm', 'dismiss-keyguard')
  adb('shell', 'am', 'start', '-n', ACTIVITY)
  await sleep(8000)
  state = JSON.parse(await cdp.evaluate(STATE))
  check('return: the video plays again, shadow muted, mute restored',
    state.video && !state.video.paused && state.video.muted === false &&
      (!state.shadow || state.shadow.muted === true),
    `paused=${state.video?.paused} muted=${state.video?.muted} ct=${state.video?.ct}`)
  check('return: playback continues near where the audio stopped',
    state.video && later.shadow && state.video.ct >= later.shadow.ct - 2,
    `video=${state.video?.ct} audio stopped at ${later.shadow?.ct}`)

  // 4. A second lock must work (this is what used to die after starvation).
  adb('shell', 'input', 'keyevent', 'KEYCODE_POWER')
  await sleep(8000)
  state = JSON.parse(await cdp.evaluate(STATE))
  check('second lock: the shadow is audible again', shadowAudible(state),
    `audible=${state.shadow && !state.shadow.muted} readyState=${state.shadow?.readyState} disabled=${state.shadowState?.disabled}`)

  // 5. Transport pause ends the session and silences everything.
  adb('shell', 'cmd', 'media_session', 'dispatch', 'pause')
  await sleep(6000)
  const afterPause = JSON.parse(await cdp.evaluate(STATE))
  check('transport pause ends the background session', afterPause.armed === false,
    `armed=${afterPause.armed} shadowPresent=${Boolean(afterPause.shadow)}`)

  // 6. No crash anywhere in the run.
  const logcat = adb('logcat', '-d', '-t', '2000')
  check('no crash during the run', !logcat.includes('FATAL EXCEPTION'))
  const appLog = logcat.split('\n').filter((line) => line.includes('AdVoid')).join('\n')
  const shadowFailures = (appLog.match(/audio shadow failed/g) || []).length
  check('no shadow failure cascade', shadowFailures <= 2, `${shadowFailures} failure line(s)`)

  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
  cdp.close()

  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
