import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// Background audio is a three-layer feature (docs/decisions.md):
//   Layer A - PlaybackService.kt: a mediaPlayback foreground service + the
//             platform MediaSession, started while the activity is visible, so
//             Android 17's audio hardening does not silence background playback.
//   Layer B - BACKGROUND_AUDIO_SCRIPT: a flag-gated page visibility bridge that
//             stops YouTube's player from unloading the video on
//             visibilitychange, plus a bounded media keep-alive.
//   Layer C - Picture-in-Picture: the guaranteed path, which Android 17
//             explicitly exempts from the hardening rules.
// These tests pin all three; the emulator verification is what proves them.

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const KT_PATH = fileURLToPath(
  new URL('../android/AdVoid/app/src/main/java/com/advoid/app/MainActivity.kt', import.meta.url),
)
const mainActivity = readFileSync(KT_PATH, 'utf8')
const manifest = readFileSync(
  new URL('../android/AdVoid/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
)
const playbackService = readFileSync(
  new URL('../android/AdVoid/app/src/main/java/com/advoid/app/PlaybackService.kt', import.meta.url),
  'utf8',
)

function extractScript(constName) {
  const match = mainActivity.match(
    new RegExp(`internal const val ${constName} = """([\\s\\S]*?)"""`),
  )
  assert.ok(match, `${constName} not found in MainActivity.kt`)
  return match[1].replace(/\r\n/g, '\n')
}

const BACKGROUND_SCRIPT = extractScript('BACKGROUND_AUDIO_SCRIPT')
const PIP_SCRIPT = extractScript('PIP_PRESENTATION_SCRIPT')

describe('Android background audio wiring', () => {
  it('ships the mediaPlayback foreground service and its permissions', () => {
    assert.equal(
      existsSync(`${ROOT}/android/AdVoid/app/src/main/java/com/advoid/app/PlaybackService.kt`),
      true,
    )
    // The declared permission set is an allowlist, not an open door.
    const declared = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)]
      .map((match) => match[1])
      .sort()
    assert.deepEqual(declared, [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.INTERNET',
      'android.permission.POST_NOTIFICATIONS',
    ])
    assert.match(
      manifest,
      /<service[\s\S]*android:name="\.PlaybackService"[\s\S]*foregroundServiceType="mediaPlayback"/,
    )
    // No broad extra permissions: the service must not take audio focus or hold
    // a wake lock itself (Chromium owns focus, and the removed 2026-08-25
    // attempt proved a wake lock alone does not produce audio).
    assert.doesNotMatch(manifest, /WAKE_LOCK/)
    assert.doesNotMatch(manifest, /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/)
    assert.doesNotMatch(playbackService, /WakeLock|requestAudioFocus/)
  })

  it('supports Picture-in-Picture as the guaranteed background path', () => {
    assert.match(manifest, /android:supportsPictureInPicture="true"/)
    assert.match(mainActivity, /onUserLeaveHint/)
    assert.match(mainActivity, /enterPictureInPictureMode\(/)
    assert.match(mainActivity, /onPictureInPictureModeChanged/)
    assert.match(mainActivity, /_advoidSetPipPresentation/)
    // Launching the system browser fires onUserLeaveHint too; it must not shrink
    // a playing video into PiP.
    assert.match(mainActivity, /leavingForInternalActivity = true/)
  })

  it('lets the system own the PiP transition on Android 12+', () => {
    // Measured on a real device: the system's PiP transition keeps the WebView
    // surface alive (audio keeps playing), while entering PiP from
    // onUserLeaveHint hides the WebView and Chromium pauses the media natively.
    assert.match(
      mainActivity,
      /if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S\) \{[\s\S]{0,400}builder\.setAutoEnterEnabled\(autoEnter\)/,
    )
    assert.match(mainActivity, /backgroundPlayback\.shouldAutoEnterPictureInPicture\(/)
    assert.match(mainActivity, /private fun updatePictureInPictureParams\(\)/)
  })

  it('nudges playback back after a PiP transition, within a bound', () => {
    assert.match(mainActivity, /window\._advoidEnsurePlaying && window\._advoidEnsurePlaying\(\)/)
    assert.match(mainActivity, /private fun nudgePlayback\(reason: String\)/)
    assert.match(mainActivity, /if \(pipNudges >= MAX_PIP_NUDGES\) return/)
    // A user pause must stop the nudges instead of being fought.
    assert.match(
      mainActivity,
      /MediaAction\.PAUSE -> \{[\s\S]{0,300}cancelPipNudges\(\)/,
    )
    assert.match(
      mainActivity,
      /!playing && pipActive && !activityResumed/,
    )
    // A user pause ends the session, and a nudge must then never undo it.
    assert.match(
      mainActivity,
      /!playing && pipActive && !activityResumed &&\r?\n\s+backgroundPlayback\.isServiceRunning\(\)/,
    )
  })

  it('keeps the YouTube filter chip row out of the viewport overlay', () => {
    const style = mainActivity.match(/private const val STYLE_SCRIPT = """([\s\S]*?)"""/)
    assert.ok(style, 'STYLE_SCRIPT not found in MainActivity.kt')
    // YouTube pins this row as `position: fixed` so it follows the scroll and
    // covers feed content right under AdVoid's bar.
    assert.match(style[1], /ytm-feed-filter-chip-bar-renderer#filter-chip-bar/)
    assert.match(style[1], /position: static !important/)
    assert.match(style[1], /z-index: auto !important/)
    // The Shorts rules must stay untouched, and the YouTube top bar may only be
    // hidden inside the PiP window, never globally.
    assert.match(style[1], /html\.advoid-shorts ytm-searchbox/)
    assert.doesNotMatch(style[1], /^\s*'ytm-mobile-topbar-renderer/m)
  })

  it('starts and stops the service from the coordinator decision, never unconditionally', () => {
    // Anchored to the decision branches: a bare start/stop anywhere in the
    // activity must not satisfy this.
    assert.match(mainActivity, /if \(state\.startForegroundService\) \{/)
    assert.match(
      mainActivity,
      /\} else \{\r?\n\s+requestNotificationPermissionIfNeeded\(\)/,
    )
    assert.match(
      mainActivity,
      /if \(state\.stopForegroundService && !serviceStopPending\) \{/,
    )
    assert.match(mainActivity, /backgroundPlayback\.onActivityStarted/)
    assert.match(mainActivity, /backgroundPlayback\.onActivityResumed/)
    assert.match(mainActivity, /backgroundPlayback\.onMediaStateChanged/)
    assert.match(mainActivity, /_advoidSetPagePauseSuppression/)
    // A refused foreground start must roll the coordinator back, not crash.
    assert.match(
      mainActivity,
      /catch \(e: RuntimeException\) \{\r?\n\s+\/\/ [\s\S]*?Log\.w\(TAG, "playback service refused to start/,
    )
    assert.match(
      mainActivity,
      /if \(!started\) \{\r?\n\s+applyBackgroundPlaybackState\(backgroundPlayback\.onSessionEnded\(\)\)/,
    )
    // The old, disproven mechanisms must not come back: the injected page
    // visibility override plus a resume-time play/reload recovery that lost the
    // playback position and fought the platform.
    assert.doesNotMatch(mainActivity, /RECOVER_STUCK_SCRIPT|_advoidBgPlayback|playingAtBackground/)
    assert.doesNotMatch(mainActivity, /backgroundColor.*reload/i)
  })

  it('keeps the service in the foreground with a media session and real controls', () => {
    assert.match(playbackService, /FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK/)
    assert.match(playbackService, /MediaSession\(this, SESSION_TAG\)/)
    assert.match(playbackService, /Notification\.MediaStyle/)
    assert.match(playbackService, /onTaskRemoved/)
    assert.match(playbackService, /START_NOT_STICKY/)
    // API 26-32 render only the actions the notification itself carries.
    assert.match(playbackService, /builder\.addAction\(action\)/)
    assert.match(playbackService, /ACTION_PLAY -> dispatch\(MediaAction\.PLAY\)/)
    assert.match(playbackService, /R\.drawable\.ic_advoid_playback/)
  })

  it('wires the media-card scrubber back into the page', () => {
    // Without ACTION_SEEK_TO + duration the media card shows "00:00 / 00:00".
    assert.match(playbackService, /PlaybackState\.ACTION_SEEK_TO/)
    assert.match(playbackService, /METADATA_KEY_DURATION/)
    assert.match(playbackService, /override fun onSeekTo\(positionMs: Long\)/)
    assert.match(playbackService, /var seekListener: \(\(Long\) -> Unit\)\? = null/)
    assert.match(mainActivity, /PlaybackService\.seekListener = \{ positionMs ->/)
    assert.match(mainActivity, /evaluateMediaAction\("seek", positionMs\)/)
  })

  it('enters PiP explicitly as well as leaving auto-enter armed', () => {
    // Measured on Xiaomi/HyperOS: auto-enter alone produced no PiP window, so
    // the explicit entry must stay on every API level.
    assert.match(
      mainActivity,
      /schedulePipNudges\(\)\r?\n\s+try \{\r?\n\s+enterPictureInPictureMode\(pipParams\(autoEnter = true\)\)/,
    )
  })

  it('explains a blocked PiP instead of silently stopping the audio', () => {
    // Without a PiP window the WebView is suspended by the platform, so tell the
    // user once (MIUI needs its "Display pop-up windows" permission).
    assert.match(mainActivity, /PIP_ENTRY_CHECK_DELAY_MS/)
    assert.match(mainActivity, /if \(pipActive \|\| !backgroundPlayback\.isBackgroundAudioEnabled\(\)\) return@Runnable/)
    assert.match(mainActivity, /PREFERENCE_PIP_HINT_SHOWN/)
    assert.match(mainActivity, /Display pop-up windows while running in the background/)
    assert.match(mainActivity, /postDelayed\(pipEntryCheckRunnable, PIP_ENTRY_CHECK_DELAY_MS\)/)
  })

  it('stands down while the screen is locked, then resumes once', () => {
    // Locking the phone stops the activity, hides PiP and makes Chromium suspend
    // the video element natively (measured: 21 pause events in 17 s from our own
    // retries, and a lock-screen card flapping between playing and paused).
    assert.match(mainActivity, /Intent\.ACTION_SCREEN_OFF -> setScreenInteractive\(false\)/)
    assert.match(mainActivity, /Intent\.ACTION_SCREEN_ON -> setScreenInteractive\(true\)/)
    assert.match(mainActivity, /registerScreenStateReceiver\(\)/)
    assert.match(mainActivity, /unregisterReceiver\(screenStateReceiver\)/)
    assert.match(mainActivity, /if \(!screenInteractive\) return/)
    assert.match(
      mainActivity,
      /window\._advoidSetScreenInteractive && window\._advoidSetScreenInteractive\(\$interactive\)/,
    )
    assert.match(mainActivity, /nudgePlayback\("screen on"\)/)
  })

  it('never stops and restarts the foreground service in quick succession', () => {
    // Measured: a transport pause followed by YouTube flapping pause/play made
    // the app call stopService and startForegroundService within milliseconds,
    // and the platform killed it with
    // RemoteServiceException$ForegroundServiceDidNotStartInTimeException.
    assert.match(mainActivity, /private var serviceStopPending = false/)
    assert.match(
      mainActivity,
      /if \(state\.stopForegroundService && !serviceStopPending\) \{[\s\S]{0,600}postDelayed\(stopServiceRunnable, SERVICE_STOP_GRACE_MS\)/,
    )
    assert.match(
      mainActivity,
      /if \(serviceStopPending\) \{[\s\S]{0,1000}keeping the service/,
    )
    // The deferred stop must be cancelled when the activity goes away.
    assert.match(mainActivity, /webView\.removeCallbacks\(stopServiceRunnable\)/)
  })

  it('asks for the notification permission at most once per install', () => {
    // A dialog on top of the activity is an activity itself, so Home never
    // reaches us and PiP would not engage while it is up. Audio must also work
    // when the permission is denied, so this is asked once and then dropped.
    assert.match(mainActivity, /PREFERENCE_NOTIFICATION_ASKED/)
    assert.match(mainActivity, /getSharedPreferences\(PREFERENCES_NAME, MODE_PRIVATE\)/)
    assert.match(mainActivity, /NotificationPermissionGate\.shouldRequest\(/)
    assert.match(mainActivity, /askedBefore = preferences\.getBoolean\(PREFERENCE_NOTIFICATION_ASKED, false\)/)
  })
})

// ---------------------------------------------------------------------------
// Layer B: the injected visibility bridge. The script is a self-contained IIFE,
// so it runs against a minimal shim: a Document whose real visibility is
// "hidden" while the bridge is armed.
// ---------------------------------------------------------------------------

let urlCounter = 1

/** Every SourceBuffer the page creates, so mirrored copies can be asserted. */
const sourceBuffers = []

/** Minimal MSE stand-in so the audio-shadow hooks can be driven. */
class FakeSourceBuffer {
  constructor(mime) {
    this.mime = mime
    this.updating = false
    this.appends = []
    this.removes = []
    sourceBuffers.push(this)
  }
  appendBuffer(data) {
    this.appends.push(data)
  }
  remove(start, end) {
    this.removes.push([start, end])
  }
  addEventListener() {}
}

class FakeMediaSource {
  constructor() {
    this.readyState = 'open'
    this.sourceBuffers = []
    this.listeners = new Map()
  }
  addSourceBuffer(mime) {
    const buffer = new FakeSourceBuffer(mime)
    this.sourceBuffers.push(buffer)
    return buffer
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
    // The shim fires sourceopen immediately (a real MediaSource fires it on the
    // next task) so the shadow SourceBuffer exists by the first append.
    if (type === 'sourceopen') listener()
  }
  endOfStream() {
    this.readyState = 'ended'
  }
}

function makeBackgroundEnv({ videos = [] } = {}) {
  const real = { hidden: true, visibilityState: 'hidden' }
  const windowListeners = new Map()
  const pageEvents = []
  const timers = []

  class Document {}
  Object.defineProperty(Document.prototype, 'hidden', {
    configurable: true,
    get: () => real.hidden,
  })
  Object.defineProperty(Document.prototype, 'visibilityState', {
    configurable: true,
    get: () => real.visibilityState,
  })

  // Videos are HTMLMediaElement instances so the script's prototype-level pause
  // wrapper is what intercepts them, exactly like in the WebView.
  class HTMLMediaElement {
    constructor({ inPlayer = true } = {}) {
      this.tagName = 'VIDEO'
      this.paused = true
      this.ended = false
      this.readyState = 4
      this.currentTime = 12
      this.duration = 100
      this.playCalls = 0
      this.pauseCalls = 0
      this.inPlayer = inPlayer
    }
    play() {
      this.playCalls += 1
      this.paused = false
      return { catch() {} }
    }
    pause() {
      this.pauseCalls += 1
      this.paused = true
    }
    closest(selector) {
      return selector === '.html5-video-player' && this.inPlayer ? { tagName: 'DIV' } : null
    }
  }

  const document = new Document()
  const players = []
  document.querySelectorAll = (selector) => {
    if (selector === '.html5-video-player video') return videos
    if (selector === '.html5-video-player') return players
    return []
  }
  document.title = 'A video'

  // --- Locked-screen audio shadow fakes (MediaSource + a shadow element) -----
  const createdElements = []
  class ShadowElement {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase()
      this.id = ''
      this.muted = true
      this.volume = 1
      this.paused = true
      this.currentTime = 0
      this.duration = 100
      this.readyState = 4
      this.buffered = { length: 0, start: () => 0, end: () => 0 }
      this.style = {}
      this.listeners = new Map()
      this.parentNode = null
      this.playCalls = 0
      this.src = ''
    }
    play() {
      this.playCalls += 1
      this.paused = false
      return { catch() {} }
    }
    pause() {
      this.paused = true
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, [])
      this.listeners.get(type).push(listener)
    }
  }
  document.createElement = (tag) => {
    const element = new ShadowElement(tag)
    createdElements.push(element)
    return element
  }
  document.getElementById = (id) =>
    createdElements.find(
      (element) => element.id === id && element.parentNode === document.documentElement,
    ) || null
  document.documentElement = {
    appendChild: (element) => {
      element.parentNode = document.documentElement
      return element
    },
    removeChild: (element) => {
      element.parentNode = null
      return element
    },
  }

  const sandbox = {
    Document,
    HTMLMediaElement,
    document,
    location: { pathname: '/watch' },
    console,
    Number,
    Math,
    JSON,
    Date,
    setTimeout: (callback) => {
      timers.push(callback)
      return timers.length
    },
    clearTimeout: (timerId) => {
      timers[timerId - 1] = null
    },
    // The bridge's keep-warm interval for the audio shadow.
    setInterval: () => 0,
    clearInterval: () => {},
    MediaSource: FakeMediaSource,
    SourceBuffer: FakeSourceBuffer,
    URL: { createObjectURL: (value) => value.__advoidUrl || (value.__advoidUrl = `blob:${urlCounter++}`) },
  }
  sandbox.window = sandbox
  sandbox.window.addEventListener = (type, listener) => {
    if (!windowListeners.has(type)) windowListeners.set(type, [])
    windowListeners.get(type).push(listener)
  }

  const context = vm.createContext(sandbox)
  return {
    real,
    document,
    window: sandbox.window,
    videos,
    players,
    makeVideo: (options) => new HTMLMediaElement(options),
    setup: () => vm.runInContext(BACKGROUND_SCRIPT, context),
    setArmed: (armed) =>
      vm.runInContext(`window._advoidSetBackgroundAudio(${armed});`, context),
    setArmedRaw: (literal) =>
      vm.runInContext(`window._advoidSetBackgroundAudio(${literal});`, context),
    setSuppression: (on) =>
      vm.runInContext(`window._advoidSetPagePauseSuppression(${on});`, context),
    makeSourceBuffer: (mime) => {
      const mediaSource = new FakeMediaSource()
      return mediaSource.addSourceBuffer(mime)
    },
    /**
     * Attaches a fresh MediaSource to `video` the way YouTube does (blob URL
     * first, SourceBuffer second) and returns both handles. Must be called after
     * setup(), or the bridge's hooks will not see it.
     */
    attachLiveAudioSource: (video, mime = 'audio/webm; codecs="opus"') => {
      sandbox.window.__advoidTestVideo = video
      return vm.runInContext(
        `(() => {
          var mediaSource = new MediaSource();
          var url = URL.createObjectURL(mediaSource);
          if (window.__advoidTestVideo) window.__advoidTestVideo.src = url;
          var sourceBuffer = mediaSource.addSourceBuffer(${JSON.stringify(mime)});
          return { mediaSource: mediaSource, sourceBuffer: sourceBuffer };
        })()`,
        context,
      )
    },
    setScreenInteractive: (on) =>
      vm.runInContext(`window._advoidSetScreenInteractive(${on});`, context),
    shadowElement: () => document.getElementById('advoid-shadow-audio'),
    shadowSourceBuffers: (origin) =>
      sourceBuffers.filter((buffer) => buffer !== origin),
    shadowPlaying: () => vm.runInContext('window._advoidShadowPlaying();', context),
    ensurePlaying: () => vm.runInContext('window._advoidEnsurePlaying();', context),
    // Freezes the page clock so the tap allowance can be aged out.
    freezeNowAt: (value) =>
      vm.runInContext(`Date.now = function() { return ${value}; };`, context),
    mediaAction: (action) =>
      vm.runInContext(`window._advoidMediaAction(${JSON.stringify(action)});`, context),
    seek: (positionMs) =>
      vm.runInContext(`window._advoidMediaAction('seek', ${positionMs});`, context),
    // A real finger tap: the script records the gesture and allows the pause.
    tap: () => {
      for (const listener of windowListeners.get('pointerdown') || []) {
        listener({ type: 'pointerdown', isTrusted: true })
      }
    },
    // YouTube synthesises its own click events around player state changes; they
    // must never count as user intent.
    syntheticClick: () => {
      for (const listener of windowListeners.get('click') || []) {
        listener({ type: 'click', isTrusted: false })
      }
    },
    // Dispatches like a real page would: window capture first, then the page's
    // own listener unless propagation was stopped.
    dispatch: (type) => {
      const stopped = { value: false }
      const event = {
        type,
        stopImmediatePropagation() {
          stopped.value = true
        },
      }
      for (const listener of windowListeners.get(type) || []) listener(event)
      if (!stopped.value) pageEvents.push(type)
      return stopped.value
    },
    pageEvents,
    pendingTimerCount: () => timers.filter(Boolean).length,
    runNextTimer: () => {
      let callback
      while (timers.length && !callback) callback = timers.shift()
      callback?.()
    },
    realVisibilityRead: () => document.visibilityState,
  }
}

function fakeVideo(options = {}) {
  // Kept for the tests that only need the keep-alive's shape checks.
  return {
    paused: options.paused ?? true,
    ended: options.ended ?? false,
    readyState: options.readyState ?? 4,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.playCalls += 1
      this.paused = false
      return { catch() {} }
    },
    pause() {
      this.pauseCalls += 1
      this.paused = true
    },
  }
}

describe('AdVoid background audio bridge (BACKGROUND_AUDIO_SCRIPT)', () => {
  it('reports the document as visible only while a session is armed', () => {
    const env = makeBackgroundEnv()
    env.setup()

    // Nothing is armed yet: YouTube must still see the real page state.
    assert.equal(env.realVisibilityRead(), 'hidden')
    assert.equal(env.document.hidden, true)

    env.setArmed(true)
    assert.equal(env.realVisibilityRead(), 'visible')
    assert.equal(env.document.hidden, false)
    assert.equal(env.document.visibilityState, 'visible')

    env.setArmed(false)
    assert.equal(env.realVisibilityRead(), 'hidden')
    assert.equal(env.document.hidden, true)
  })

  it('swallows YouTube lifecycle events while armed and lets them through once disarmed', () => {
    const env = makeBackgroundEnv()
    env.setup()

    env.setArmed(true)
    assert.equal(env.dispatch('visibilitychange'), true)
    // pagehide/freeze drive Chromium's page-lifecycle teardown as well.
    assert.equal(env.dispatch('pagehide'), true)
    assert.equal(env.dispatch('freeze'), true)
    assert.deepEqual(env.pageEvents, [])

    env.setArmed(false)
    assert.equal(env.dispatch('visibilitychange'), false)
    assert.deepEqual(env.pageEvents, ['visibilitychange'])
  })

  it('keeps armed state across SPA re-injection', () => {
    const env = makeBackgroundEnv()
    env.setup()
    env.setArmed(true)

    // Every SPA navigation re-runs the injected script.
    env.setup()

    assert.equal(env.realVisibilityRead(), 'visible')
  })

  it('resumes a paused main player that still has data loaded', () => {
    const video = fakeVideo({ paused: true, readyState: 4 })
    const env = makeBackgroundEnv({ videos: [video] })
    env.setup()
    env.setArmed(true)

    env.runNextTimer()

    assert.equal(video.playCalls, 1)
  })

  it('never resumes a video YouTube unloaded, and stops retrying', () => {
    const unloaded = fakeVideo({ paused: true, readyState: 0 })
    const env = makeBackgroundEnv({ videos: [unloaded] })
    env.setup()
    env.setArmed(true)

    // The keep-alive is bounded: exhaust every scheduled attempt (the budget is
    // KEEP_ALIVE_ATTEMPTS, currently 20).
    for (let i = 0; i < 25; i += 1) env.runNextTimer()

    assert.equal(unloaded.playCalls, 0)
    // "Stops retrying" is half the contract: no attempt may stay queued.
    assert.equal(env.pendingTimerCount(), 0)
  })

  it('never resumes a video that already ended', () => {
    const ended = fakeVideo({ paused: true, readyState: 4, ended: true })
    const env = makeBackgroundEnv({ videos: [ended] })
    env.setup()
    env.setArmed(true)

    for (let i = 0; i < 4; i += 1) env.runNextTimer()

    assert.equal(ended.playCalls, 0)
  })

  it('stops the keep-alive when the session is disarmed', () => {
    const video = fakeVideo({ paused: true, readyState: 4 })
    const env = makeBackgroundEnv({ videos: [video] })
    env.setup()
    env.setArmed(true)
    env.setArmed(false)

    assert.equal(env.pendingTimerCount(), 0)

    env.runNextTimer()

    assert.equal(video.playCalls, 0)
  })

  it('coerces a non-boolean arm value to disarmed', () => {
    const env = makeBackgroundEnv()
    env.setup()

    env.setArmedRaw("'yes'")
    assert.equal(env.window._advoidBgAudioArmed, false)

    env.setArmedRaw('1')
    assert.equal(env.window._advoidBgAudioArmed, false)

    env.setArmedRaw('true')
    assert.equal(env.window._advoidBgAudioArmed, true)
  })

  it('drives the main player for system play/pause actions', () => {
    const video = fakeVideo({ paused: true, readyState: 4 })
    const env = makeBackgroundEnv({ videos: [video] })
    env.setup()

    env.mediaAction('play')
    assert.equal(video.playCalls, 1)

    env.mediaAction('pause')
    assert.equal(video.pauseCalls, 1)
  })
})

// ---------------------------------------------------------------------------
// Page pause suppression. Measured in Picture-in-Picture: the activity is paused
// but visible, and YouTube's player calls pauseVideo() roughly four times a
// second from its own state machine, so the video never plays even though the
// media pipeline is healthy. Suppression must be narrow: only the main watch
// player, only while the app cannot be interacted with, and never for a tap or
// an explicit notification/lock-screen/PiP action.
// ---------------------------------------------------------------------------

describe('AdVoid page pause suppression', () => {
  function envWithVideo(options = {}) {
    const env = makeBackgroundEnv()
    const video = env.makeVideo(options)
    env.videos.push(video)
    env.setup()
    return { env, video }
  }

  it('ignores page pauses while the app is not interactively resumed', () => {
    const { env, video } = envWithVideo()
    env.setArmed(true)
    env.setSuppression(true)

    video.pause()

    assert.equal(video.pauseCalls, 0)
  })

  it('lets page pauses through while the app is interactive', () => {
    const { env, video } = envWithVideo()
    env.setArmed(true)
    env.setSuppression(false)

    video.pause()

    assert.equal(video.pauseCalls, 1)
  })

  it('lets a real tap pause playback', () => {
    const { env, video } = envWithVideo()
    env.setArmed(true)
    env.setSuppression(true)
    env.freezeNowAt(1_000_000)

    env.tap()
    video.pause()

    assert.equal(video.pauseCalls, 1)
  })

  it('suppresses a pause that happens long after the last tap', () => {
    const { env, video } = envWithVideo()
    env.setArmed(true)
    env.setSuppression(true)
    env.freezeNowAt(1_000_000)
    env.tap()

    // The gesture allowance is a short window, not a permanent bypass.
    env.freezeNowAt(1_060_000)
    video.pause()

    assert.equal(video.pauseCalls, 0)
  })

  it('re-syncs the player state when suppression is released', () => {
    const { env, video } = envWithVideo()
    // YouTube's player believes it is paused while the element kept playing.
    const player = {
      state: 2,
      playVideoCalls: 0,
      getPlayerState() {
        return this.state
      },
      playVideo() {
        this.playVideoCalls += 1
        this.state = 1
      },
    }
    env.players.push(player)
    env.setArmed(true)
    env.setSuppression(true)
    video.paused = false

    env.setSuppression(false)

    assert.equal(player.playVideoCalls, 1)
  })

  it('does not resume on release a video that is legitimately paused', () => {
    const { env, video } = envWithVideo()
    const player = {
      playVideoCalls: 0,
      getPlayerState() {
        return 2
      },
      playVideo() {
        this.playVideoCalls += 1
      },
    }
    env.players.push(player)
    env.setArmed(true)
    env.setSuppression(true)
    // Arming may have resumed the element; the case under test is the release.
    video.paused = true
    const callsAfterArming = player.playVideoCalls

    env.setSuppression(false)

    assert.equal(player.playVideoCalls, callsAfterArming)
  })

  it('ignores a media action when there is no player video', () => {
    const env = makeBackgroundEnv()
    env.setup()

    // Must not throw while YouTube is between videos.
    env.mediaAction('pause')
    env.mediaAction('play')
  })

  it('always honours an explicit system pause', () => {
    const { env, video } = envWithVideo()
    env.setArmed(true)
    env.setSuppression(true)

    env.mediaAction('pause')

    assert.equal(video.pauseCalls, 1)
    assert.equal(video.paused, true)
  })

  it('arms pause suppression the moment the page really goes hidden', () => {
    const { env, video } = envWithVideo()
    env.setArmed(true)
    // Native has not round-tripped yet; the page must protect itself, or
    // YouTube's first pauseVideo() would look like a user pause.
    assert.equal(env.window._advoidSuppressPagePause, undefined)

    env.dispatch('visibilitychange')
    video.pause()

    assert.equal(env.window._advoidSuppressPagePause, true)
    assert.equal(video.pauseCalls, 0)
  })

  it('does not treat a synthetic page click as a user pause', () => {
    const { env, video } = envWithVideo()
    env.setArmed(true)
    env.setSuppression(true)
    env.freezeNowAt(1_000_000)

    // YouTube synthesises clicks around its own player state changes.
    env.syntheticClick()
    video.pause()

    assert.equal(video.pauseCalls, 0)
  })

  it('resumes the main player when the page becomes visible again', () => {
    const { env, video } = envWithVideo()
    env.setArmed(true)
    // The PiP transition paused the media while the WebView was hidden; the
    // window is on screen again but the activity is still paused.
    video.paused = true
    env.real.hidden = false

    env.dispatch('visibilitychange')

    assert.equal(video.playCalls, 1)
    // The retry budget is re-armed, so a slow YouTube state machine still gets
    // more attempts instead of inheriting an exhausted timer.
    assert.ok(env.pendingTimerCount() > 0)
  })

  it('does not resume on a visible transition while no session is armed', () => {
    const { env, video } = envWithVideo()
    env.setArmed(false)
    video.paused = true
    env.real.hidden = false

    env.dispatch('visibilitychange')

    assert.equal(video.playCalls, 0)
  })

  it('exposes an ensure-playing hook for the native PiP nudge', () => {
    const { env, video } = envWithVideo()
    video.paused = true

    env.ensurePlaying()

    assert.equal(video.playCalls, 1)
  })

  it('seeks the main player from a media-card scrub', () => {
    const { env, video } = envWithVideo()

    env.seek(60_000)

    assert.equal(video.currentTime, 60)
  })

  it('ignores an out-of-range scrub request', () => {
    const { env, video } = envWithVideo()
    const before = video.currentTime

    env.seek(-5_000)

    assert.equal(video.currentTime, before)
  })

  it('never suppresses videos outside the main watch player', () => {
    const { env } = envWithVideo()
    const preview = env.makeVideo({ inPlayer: false })
    env.videos.push(preview)
    env.setArmed(true)
    env.setSuppression(true)

    preview.pause()

    assert.equal(preview.pauseCalls, 1)
  })

  it('stops suppressing as soon as the session disarms', () => {
    const { env, video } = envWithVideo()
    env.setArmed(true)
    env.setSuppression(true)
    env.setArmed(false)

    video.pause()

    assert.equal(video.pauseCalls, 1)
  })
})


// ---------------------------------------------------------------------------
// Layer D: the locked-screen audio shadow. While the screen is off Chromium
// suspends the <video> element but keeps playing media without a video track,
// so the bridge mirrors YouTube's audio SourceBuffer into a shadow element.
// ---------------------------------------------------------------------------

describe('AdVoid locked-screen audio shadow (BACKGROUND_AUDIO_SCRIPT)', () => {
  function shadowEnv() {
    const env = makeBackgroundEnv()
    const video = env.makeVideo()
    video.muted = false
    video.paused = false
    env.videos.push(video)
    env.setup()
    env.setArmed(true)
    return { env, video }
  }

  it('copies the live audio SourceBuffer into a shadow element', () => {
    const { env, video } = shadowEnv()
    const { sourceBuffer } = env.attachLiveAudioSource(video)

    sourceBuffer.appendBuffer({ slice: () => 'init-segment' })

    assert.ok(env.shadowElement(), 'shadow element was created')
    const mirrored = env.shadowSourceBuffers(sourceBuffer)
    assert.equal(mirrored.length, 1, 'exactly one shadow SourceBuffer')
    assert.deepEqual(mirrored[0].appends, ['init-segment'])
  })

  it('ignores MediaSources the player is not attached to', () => {
    // YouTube builds throwaway MediaSources to probe codec support.
    const { env, video } = shadowEnv()
    env.attachLiveAudioSource(video)
    const probe = env.makeSourceBuffer('audio/webm; codecs="opus"')

    probe.appendBuffer({ slice: () => 'probe-data' })

    assert.equal(env.shadowElement(), null)
  })

  it('mirrors nothing while background audio is switched off', () => {
    const env = makeBackgroundEnv()
    const video = env.makeVideo()
    env.videos.push(video)
    env.setup()
    const { sourceBuffer } = env.attachLiveAudioSource(video)

    sourceBuffer.appendBuffer({ slice: () => 'data' })

    assert.equal(env.shadowElement(), null)
  })

  it('unmutes the shadow and silences the video when the screen locks', () => {
    const { env, video } = shadowEnv()
    const { sourceBuffer } = env.attachLiveAudioSource(video)
    sourceBuffer.appendBuffer({ slice: () => 'init' })
    const shadow = env.shadowElement()
    assert.equal(shadow.muted, true, 'silent while the screen is on')

    env.setScreenInteractive(false)

    assert.equal(shadow.muted, false)
    assert.equal(shadow.volume, 1)
    assert.equal(video.muted, true)
    assert.equal(env.shadowPlaying(), true)
  })

  it('restores the video and silences the shadow when the screen returns', () => {
    const { env, video } = shadowEnv()
    const { sourceBuffer } = env.attachLiveAudioSource(video)
    sourceBuffer.appendBuffer({ slice: () => 'init' })
    const shadow = env.shadowElement()
    env.setScreenInteractive(false)

    env.setScreenInteractive(true)

    assert.equal(shadow.muted, true)
    assert.equal(video.muted, false)
    assert.equal(env.shadowPlaying(), false)
  })

  it('stops the shadow when the user pauses from the lock screen', () => {
    const { env, video } = shadowEnv()
    const { sourceBuffer } = env.attachLiveAudioSource(video)
    sourceBuffer.appendBuffer({ slice: () => 'init' })
    const shadow = env.shadowElement()
    env.setScreenInteractive(false)
    assert.equal(shadow.paused, false)

    env.mediaAction('pause')

    assert.equal(shadow.paused, true)
  })

  it('tears the shadow down when background audio is switched off', () => {
    const { env, video } = shadowEnv()
    const { sourceBuffer } = env.attachLiveAudioSource(video)
    sourceBuffer.appendBuffer({ slice: () => 'init' })
    assert.ok(env.shadowElement())

    env.setArmed(false)

    assert.equal(env.shadowElement(), null)
    assert.equal(env.shadowPlaying(), false)
  })

  it('ships the shadow wiring in the bridge and the state report', () => {
    assert.match(BACKGROUND_SCRIPT, /window\._advoidShadowPlaying = function/)
    assert.match(BACKGROUND_SCRIPT, /shadowElement\.muted = false/)
    assert.match(BACKGROUND_SCRIPT, /shadowNativeAddSourceBuffer/)
    assert.match(BACKGROUND_SCRIPT, /data\.slice\(0\)/)
    // The native session must follow the shadow while it is the audible source,
    // or it would report a paused player over playing audio and stop the
    // foreground service that keeps the audio unmuted.
    assert.match(mainActivity, /window\._advoidShadowPlaying/)
    assert.match(mainActivity, /shadowPlaying \|\| isMainPlayerPlaying\(\)/)
    assert.match(mainActivity, /_advoidShadowPositionMs/)
  })
})



// ---------------------------------------------------------------------------
// Layer C: the PiP presentation is a class toggle and must never write inline
// styles. The inline-styling version made YouTube cache a hidden-video offset
// (`top: -<height>` on the <video>), which left a black, untappable player.
// ---------------------------------------------------------------------------

function makePipEnv() {
  const classes = new Set()
  const sandbox = {
    document: {
      documentElement: {
        classList: {
          toggle(name, on) {
            if (on) classes.add(name)
            else classes.delete(name)
            return Boolean(on)
          },
        },
      },
    },
    console,
  }
  sandbox.window = sandbox
  const context = vm.createContext(sandbox)
  return {
    classes,
    setup: () => vm.runInContext(PIP_SCRIPT, context),
    setPip: (on) => vm.runInContext(`window._advoidSetPipPresentation(${on});`, context),
    pipActive: () => vm.runInContext('window._advoidPipActive === true;', context),
  }
}

describe('AdVoid PiP presentation (PIP_PRESENTATION_SCRIPT)', () => {
  it('adds and removes the PiP class', () => {
    const env = makePipEnv()
    env.setup()

    env.setPip(true)
    assert.equal(env.classes.has('advoid-pip'), true)
    assert.equal(env.pipActive(), true)

    env.setPip(false)
    assert.equal(env.classes.has('advoid-pip'), false)
    assert.equal(env.pipActive(), false)
  })

  it('coerces a non-boolean argument to off', () => {
    const env = makePipEnv()
    env.setup()

    env.setPip("'yes'")
    assert.equal(env.classes.has('advoid-pip'), false)
    assert.equal(env.pipActive(), false)
  })

  it('never writes inline styles anywhere', () => {
    // A class toggle cannot leak player styling into the page.
    assert.doesNotMatch(PIP_SCRIPT, /\.style\./)
    assert.doesNotMatch(PIP_SCRIPT, /setProperty/)
    assert.match(PIP_SCRIPT, /classList\.toggle\('advoid-pip'/)
  })

  it('ships the PiP presentation as a class rule', () => {
    const style = mainActivity.match(/private const val STYLE_SCRIPT = """([\s\S]*?)"""/)
    assert.ok(style, 'STYLE_SCRIPT not found in MainActivity.kt')
    assert.match(style[1], /html\.advoid-pip ytm-mobile-topbar-renderer/)
    assert.match(style[1], /html\.advoid-pip ytm-pivot-bar-renderer/)
  })
})
