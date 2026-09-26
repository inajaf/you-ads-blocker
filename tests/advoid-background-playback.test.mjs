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
    // The YouTube top bar and the Shorts rules must stay untouched.
    assert.match(style[1], /html\.advoid-shorts ytm-searchbox/)
    assert.doesNotMatch(style[1], /ytm-mobile-topbar-renderer/)
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

  it('never stops and restarts the foreground service in quick succession', () => {    // Measured: a transport pause followed by YouTube flapping pause/play made
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
// Layer C: the PiP presentation must be reversible and must not depend on
// YouTube's class names.
// ---------------------------------------------------------------------------

class FakeNode {
  constructor(classes = []) {
    this.classes = new Set(classes)
    this.children = []
    this.parentElement = null
    this.style = {}
    this.tagName = 'DIV'
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  closest(selector) {
    const wanted = selector.startsWith('.') ? selector.slice(1) : null
    let node = this
    while (node) {
      if (wanted && node.classes.has(wanted)) return node
      node = node.parentElement
    }
    return null
  }
}

function makePipEnv({ withVideo = true } = {}) {
  const html = new FakeNode()
  const body = new FakeNode()
  const masthead = new FakeNode()
  const app = new FakeNode()
  const playerContainer = new FakeNode(['player-container'])
  const player = new FakeNode(['html5-video-player'])
  const video = new FakeNode()
  video.tagName = 'VIDEO'
  video.closest = FakeNode.prototype.closest.bind(video)

  html.appendChild(body)
  body.appendChild(masthead)
  body.appendChild(app)
  app.appendChild(playerContainer)
  app.appendChild(new FakeNode(['comments']))
  playerContainer.appendChild(player)
  player.appendChild(video)
  video.parentElement = player

  // Mutable so a test can simulate YouTube replacing the player subtree on an
  // SPA navigation inside PiP.
  const videos = withVideo ? [video] : []
  const windowListeners = new Map()
  const document = {
    documentElement: html,
    querySelectorAll: (selector) =>
      selector === '.html5-video-player video' ? videos : [],
  }
  const sandbox = { document, console }
  sandbox.window = sandbox
  sandbox.window.addEventListener = (type, listener) => {
    if (!windowListeners.has(type)) windowListeners.set(type, [])
    windowListeners.get(type).push(listener)
  }
  const context = vm.createContext(sandbox)
  return {
    nodes: { body, masthead, app, playerContainer, comments: app.children[1] },
    videos,
    addVideo: (element) => {
      element.closest = FakeNode.prototype.closest.bind(element)
      player.appendChild(element)
      element.parentElement = player
      videos.push(element)
      return element
    },
    replacePlayerContainer: () => {
      const nextContainer = new FakeNode(['player-container'])
      const nextPlayer = new FakeNode(['html5-video-player'])
      const nextVideo = new FakeNode()
      nextVideo.tagName = 'VIDEO'
      nextVideo.closest = FakeNode.prototype.closest.bind(nextVideo)
      nextContainer.appendChild(nextPlayer)
      nextPlayer.appendChild(nextVideo)
      nextVideo.parentElement = nextPlayer
      nextContainer.parentElement = app
      app.appendChild(nextContainer)
      videos.length = 0
      videos.push(nextVideo)
      return nextContainer
    },
    setup: () => vm.runInContext(PIP_SCRIPT, context),
    setPip: (on) =>
      vm.runInContext(`window._advoidSetPipPresentation(${on});`, context),
    navigate: () => {
      for (const listener of windowListeners.get('yt-navigate-finish') || []) {
        listener({ type: 'yt-navigate-finish' })
      }
    },
    pipActive: () => vm.runInContext('window._advoidPipActive === true;', context),
  }
}

describe('AdVoid PiP presentation (PIP_PRESENTATION_SCRIPT)', () => {
  it('hides the page chrome around the player and restores it on exit', () => {
    const env = makePipEnv()
    env.setup()

    env.setPip(true)
    assert.equal(env.nodes.masthead.style.display, 'none')
    assert.equal(env.nodes.comments.style.display, 'none')
    assert.equal(env.nodes.playerContainer.style.position, 'fixed')
    assert.equal(env.nodes.playerContainer.style.zIndex, '2147483000')

    env.setPip(false)
    assert.equal(env.nodes.masthead.style.display, undefined)
    assert.equal(env.nodes.comments.style.display, undefined)
    assert.equal(env.nodes.playerContainer.style.position, undefined)
    assert.equal(env.nodes.playerContainer.style.zIndex, undefined)
  })

  it('is idempotent across repeated PiP transitions', () => {
    const env = makePipEnv()
    env.setup()

    env.setPip(true)
    env.setPip(true)
    env.setPip(false)

    assert.equal(env.nodes.masthead.style.display, undefined)
    assert.equal(env.nodes.playerContainer.style.position, undefined)
  })

  it('does nothing when the PiP window has no watch player yet', () => {
    const env = makePipEnv({ withVideo: false })
    env.setup()

    // Must not throw while YouTube is still building the player.
    env.setPip(true)
    assert.equal(env.nodes.masthead.style.display, undefined)
    assert.equal(env.pipActive(), true)
  })

  it('re-isolates the player after an SPA navigation inside PiP', () => {
    const env = makePipEnv()
    env.setup()
    env.setPip(true)

    const nextContainer = env.replacePlayerContainer()
    env.navigate()

    assert.equal(env.nodes.masthead.style.display, 'none')
    assert.equal(nextContainer.style.position, 'fixed')
  })

  it('stops re-applying once PiP is left', () => {
    const env = makePipEnv()
    env.setup()
    env.setPip(true)
    env.setPip(false)

    env.navigate()

    assert.equal(env.nodes.masthead.style.display, undefined)
    assert.equal(env.pipActive(), false)
  })
})
