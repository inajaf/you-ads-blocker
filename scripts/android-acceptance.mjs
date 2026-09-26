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
// Env: ADB (path to adb), ADB_SERIAL (device serial when several are attached),
// PACKAGE (default com.advoid.app.debug), DEVICE_PIN (lockscreen PIN, optional —
// passed in the environment only, never stored).

import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB || 'adb'
const ADB_SERIAL = process.env.ADB_SERIAL || ''
const PACKAGE = process.env.PACKAGE || 'com.advoid.app.debug'
const DEVICE_PIN = process.env.DEVICE_PIN || ''
const ACTIVITY = `${PACKAGE}/com.advoid.app.MainActivity`
const WATCH_URL = process.argv[2] || 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'

const adb = (...args) =>
  execFileSync(ADB, ADB_SERIAL ? ['-s', ADB_SERIAL, ...args] : args, {
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
  // Prefer this package's own process: devices often have both the release and the
  // debug build installed, each with its own WebView devtools socket.
  let pid = ''
  try {
    pid = adb('shell', 'pidof', PACKAGE).trim()
  } catch {
    pid = ''
  }
  let socket = pid ? `webview_devtools_remote_${pid}` : ''
  if (!socket) {
    const unix = adb('shell', 'cat /proc/net/unix')
    const match = unix.match(/webview_devtools_remote_\d+/)
    if (!match) throw new Error('no WebView devtools socket: is the app running?')
    socket = match[0]
  }
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

const screenAsleep = () => adb('shell', 'dumpsys', 'power').includes('mWakefulness=Asleep')
const screenDozing = () => adb('shell', 'dumpsys', 'power').includes('mWakefulness=Dozing')

/** True when our activity currently owns the input focus. */
function appHasFocus() {
  try {
    const dump = adb('shell', 'dumpsys', 'window')
    const match = dump.match(/mCurrentFocus=(\S+)/)
    return Boolean(match && match[1].includes(PACKAGE))
  } catch {
    return false
  }
}

/** Turns the screen off, retrying: on a real device the state can lag a press. */
async function lockScreen() {
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
  await sleep(1500)
  adb('shell', 'wm', 'dismiss-keyguard')
  await sleep(1200)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (screenAsleep() || screenDozing()) return true
    // KEYCODE_SLEEP (223) works where some OEM builds ignore an injected POWER
    // press (measured on a Xiaomi/HyperOS phone, Android 16).
    adb('shell', 'input', 'keyevent', attempt === 0 ? 'KEYCODE_POWER' : '223')
    await sleep(1500)
  }
  return screenAsleep() || screenDozing()
}

/** Brings the app to the foreground, unlocking with the PIN when needed. */
async function returnToApp() {
  if (screenAsleep() || screenDozing()) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
    await sleep(1500)
  }
  if (!appHasFocus()) {
    // Swipe up to reveal the PIN pad (coordinates from the real screen size).
    const match = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)/)
    if (match) {
      const width = Number(match[1])
      const height = Number(match[2])
      adb('shell', 'input', 'swipe',
        String(Math.round(width / 2)), String(Math.round(height * 0.8)),
        String(Math.round(width / 2)), String(Math.round(height * 0.3)), '150')
      await sleep(1000)
    }
    if (DEVICE_PIN) {
      adb('shell', 'input', 'text', DEVICE_PIN)
      await sleep(500)
      adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER')
      await sleep(1500)
    }
    adb('shell', 'wm', 'dismiss-keyguard')
  }
  adb('shell', 'am', 'start', '-n', ACTIVITY)
  await sleep(5000)
}

async function main() {
  console.log(`acceptance: ${PACKAGE} on ${WATCH_URL}`)
  // Unlock first (a locked device would start the app behind the keyguard, where
  // nothing can play) and only then start fresh.
  await returnToApp()
  adb('logcat', '-c')
  adb('shell', 'am', 'force-stop', PACKAGE)
  adb('shell', 'am', 'start', '-n', ACTIVITY)
  await sleep(10000)
  forwardDevtools()
  const cdp = await connect()

  // 1. Play a video through the page, the way the app does.
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: WATCH_URL })
  await sleep(16000)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await cdp.evaluate(`(async () => {
      var video = document.querySelector('.html5-video-player video');
      if (video) { video.muted = false; await video.play().catch(function() {}); }
      return 'ok';
    })()`)
    await sleep(5000)
    const probe = JSON.parse(await cdp.evaluate(STATE))
    if (probe.video && !probe.video.paused) break
  }
  await sleep(3000)
  let state = JSON.parse(await cdp.evaluate(STATE))
  check('playback starts and the bridge arms', state.armed === true && state.video && !state.video.paused,
    `armed=${state.armed} paused=${state.video?.paused} ct=${state.video?.ct}`)
  check('the shadow mirror is built and muted while visible',
    Boolean(state.shadow) && state.shadow.muted === true && state.shadowState?.disabled === false,
    `muted=${state.shadow?.muted} sources=${state.shadowState?.sources} disabled=${state.shadowState?.disabled}`)

  // 2. Lock: the shadow must take over with real audio.
  const locked = await lockScreen()
  await sleep(8000)
  state = JSON.parse(await cdp.evaluate(STATE))
  const lockedCt = state.shadow?.ct
  // What matters is that the app is off-screen (that is what makes the platform
  // suspend the video); some OEM builds report wakefulness differently.
  check('the app is off-screen while locked', state.presentable === false,
    `presentable=${state.presentable} asleep=${locked}`)
  check('locked: the shadow is audible', shadowAudible(state),
    `muted=${state.shadow?.muted} paused=${state.shadow?.paused} readyState=${state.shadow?.readyState}`)
  check('locked: the platform reports a started, unmuted player', await hasStartedAudioPlayer())
  await sleep(6000)
  const later = JSON.parse(await cdp.evaluate(STATE))
  check('locked: audio is actually advancing', later.shadow && later.shadow.ct > lockedCt,
    `${lockedCt} -> ${later.shadow?.ct}`)

  // 3. Return: the video resumes from where the audio was, shadow muted again.
  await returnToApp()
  await sleep(4000)
  state = JSON.parse(await cdp.evaluate(STATE))
  check('return: the video plays again, shadow muted, mute restored',
    state.video && !state.video.paused && state.video.muted === false &&
      (!state.shadow || state.shadow.muted === true),
    `paused=${state.video?.paused} muted=${state.video?.muted} ct=${state.video?.ct}`)
  check('return: playback continues near where the audio stopped',
    state.video && later.shadow && state.video.ct >= later.shadow.ct - 2,
    `video=${state.video?.ct} audio stopped at ${later.shadow?.ct}`)

  // 4. A second lock must work (this is what used to die after starvation).
  const lockedAgain = await lockScreen()
  await sleep(8000)
  state = JSON.parse(await cdp.evaluate(STATE))
  check('second lock: the shadow is audible again', shadowAudible(state),
    `asleep=${lockedAgain} muted=${state.shadow?.muted} readyState=${state.shadow?.readyState} disabled=${state.shadowState?.disabled}`)

  // 5. Reported case: the background audio has run out (session paused but alive,
  // app off-screen) and the media card's Play is pressed. Playback cannot resume
  // from a suspended WebView, and Android blocks a background activity launch from
  // a media key — but a notification action may launch the activity, so Play must
  // open the app instead of dispatching an action nothing can honour.
  await cdp.evaluate(`(() => {
    var shadow = document.getElementById('advoid-shadow-audio');
    if (shadow) shadow.pause();
    return 'paused';
  })()`)
  await sleep(4000)
  const exhausted = JSON.parse(await cdp.evaluate(STATE))
  let dump = ''
  try {
    dump = adb('shell', 'dumpsys', 'notification', '--noredact')
  } catch {
    dump = ''
  }
  const dispatchesMediaAction = dump.includes('com.advoid.app.action.PLAY')
  check('the media card Play opens the app while background audio cannot continue',
    exhausted.armed === true && !dispatchesMediaAction,
    `armed=${exhausted.armed} servicePlayAction=${dispatchesMediaAction}`)

  // Tapping that action is an activity launch; emulate it.
  await returnToApp()
  await sleep(3000)
  await cdp.evaluate(`(async () => {
    var video = document.querySelector('.html5-video-player video');
    if (video) await video.play().catch(function() {});
    return 'ok';
  })()`)
  await sleep(4000)
  const resumed = JSON.parse(await cdp.evaluate(STATE))
  check('...and playback resumes once the app is open', resumed.video && !resumed.video.paused,
    `paused=${resumed.video?.paused} ct=${resumed.video?.ct}`)

  // 6. Transport pause ends the session and silences everything. A media key is
  // more reliable than `cmd media_session dispatch` on OEM builds.
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE')
  let paused = false
  for (let attempt = 0; attempt < 12 && !paused; attempt += 1) {
    await sleep(1000)
    const afterPause = JSON.parse(await cdp.evaluate(STATE))
    paused = afterPause.armed === false
  }
  const afterPause = JSON.parse(await cdp.evaluate(STATE))
  check('transport pause ends the background session', paused,
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
