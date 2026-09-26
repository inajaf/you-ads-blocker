package com.advoid.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Source guards for the injected background-audio and PiP scripts. They are
 * self-contained IIFEs, so the behavioural tests live in Node
 * (tests/advoid-background-playback.test.mjs); these pin the invariants that
 * keep the scripts safe to inject on every page.
 */
class BackgroundAudioScriptTest {
    private val script = MainActivity.BACKGROUND_AUDIO_SCRIPT
    private val pipScript = MainActivity.PIP_PRESENTATION_SCRIPT

    @Test
    fun `visibility spoof only applies while a playback session is armed`() {
        // A permanently visible document would change YouTube's behaviour even
        // when the user never leaves the app, so every spoofed read has to be
        // gated on the armed flag.
        assertTrue(
            "spoofed reads must consult the armed flag",
            script.contains("return window._advoidBgAudioArmed"),
        )
        assertTrue(
            "the armed flag starts disarmed",
            script.contains("window._advoidBgAudioArmed = false"),
        )
        assertTrue(
            "the page visibility API is spoofed",
            script.contains("spoof('visibilityState', 'visible')"),
        )
    }

    @Test
    fun `lifecycle events are swallowed before any page listener sees them`() {
        // YouTube's player stops and unloads the video from its
        // visibilitychange handler (jmr.stopVideo -> HTMLMediaElement.load),
        // resetting the position to 0. Window capture runs first and
        // stopImmediatePropagation stops every downstream listener — but only
        // for a genuine background transition, so in-app navigation keeps
        // YouTube's own pagehide/freeze cleanup.
        assertTrue(script.contains("window.addEventListener(type, function(event)"))
        assertTrue(script.contains("event.stopImmediatePropagation()"))
        assertTrue(script.contains("reallyHidden()"))
        assertTrue(script.contains(", true);"))
        assertTrue(script.contains("'visibilitychange'"))
        assertTrue(script.contains("'pagehide'"))
    }

    @Test
    fun `only the main watch player is ever driven`() {
        assertTrue(script.contains(".html5-video-player video"))
        // Shorts and feed previews must never arm background audio: the guard is
        // the watch-page pathname plus the .html5-video-player wrapper, and the
        // media-state report derives playback from the same element.
        assertTrue(script.contains("location.pathname.indexOf('/watch') !== 0"))
        assertTrue(script.contains("element.closest('.html5-video-player')"))
        // A bounded keep-alive that only touches an element with data left.
        assertTrue(script.contains("video.readyState > 0"))
        assertTrue(script.contains("keepAliveLeft"))
        // A rejected play() is this feature's failure mode: it must be visible.
        assertTrue(script.contains("console.warn('[AdVoid] background play() rejected:"))
    }

    @Test
    fun `media actions drive play and pause on the main player`() {
        assertTrue(script.contains("window._advoidMediaAction = function(action, positionMs)"))
        assertTrue(script.contains("action === 'play'"))
        assertTrue(script.contains("action === 'pause'"))
        assertTrue(script.contains("video.pause()"))
        // The page's player must follow the element, or it keeps believing it is
        // playing and pauses again at the next sync.
        assertTrue(script.contains("player.pauseVideo()"))
        // Lock-screen/media-card scrubbing is wired back into the page.
        assertTrue(script.contains("action === 'seek'"))
        assertTrue(script.contains("video.currentTime = seconds"))
        assertTrue(script.contains("seekPlayer.seekTo(seconds, true)"))
    }

    @Test
    fun `a permitted pause is reported to native`() {
        assertTrue(script.contains("window._advoidNotifyUserPause()"))
    }

    @Test
    fun `the page resumes when it becomes visible again`() {
        // The PiP transition can pause the media while the WebView is hidden,
        // and Chromium throttles hidden-page timers, so the retry budget is
        // re-armed on every real visibility transition, not just at arming time.
        assertTrue(script.contains("// Back on screen"))
        assertTrue(script.contains("window._advoidEnsurePlaying = ensurePlaying"))
        assertTrue(script.contains("function armKeepAlive()"))
        assertTrue(script.contains("KEEP_ALIVE_ATTEMPTS = 20"))
        // pagehide/freeze keep their swallow-only handling.
        assertTrue(script.contains("function swallowWhileHidden(event)"))
    }

    @Test
    fun `page pauses are suppressed only for the main player and only without a recent tap`() {
        // Measured in PiP: YouTube's player calls pauseVideo() about four times
        // a second while the activity is paused, which is what stopped the audio
        // even though the media pipeline was healthy. Suppression has to be
        // narrow, or the user loses the ability to pause.
        assertTrue(script.contains("window._advoidSetPagePauseSuppression = function(on)"))
        assertTrue(
            script.contains("window._advoidBgAudioArmed && window._advoidSuppressPagePause"),
        )
        assertTrue(script.contains("isMainPlayerVideo(this)"))
        assertTrue(script.contains("element.tagName !== 'VIDEO'"))
        assertTrue(script.contains("location.pathname.indexOf('/watch') !== 0"))
        // Only a gesture or an explicit action counts as user intent; anything
        // else is the platform pause this feature exists to defeat.
        assertTrue(script.contains("var userInitiated = window._advoidAllowPause === true"))
        assertTrue(script.contains("Date.now() - lastUserGestureAt <= 3000"))
        assertTrue(script.contains("'pointerdown', 'touchstart', 'mousedown', 'click', 'keydown'"))
        // Only trusted input is user intent: YouTube synthesises clicks itself.
        assertTrue(script.contains("event.isTrusted !== true"))
        // An explicit notification/lock-screen/PiP pause must always win.
        assertTrue(script.contains("window._advoidAllowPause = true"))
        assertTrue(script.contains("window._advoidAllowPause = false"))
        // The page arms suppression itself the moment it really goes hidden, so
        // YouTube's first pauseVideo() cannot be mistaken for a user pause.
        assertTrue(
            script.contains("window._advoidSuppressPagePause = true;"),
        )
        // The original implementation stays reachable, never dropped.
        assertTrue(script.contains("var nativePause = HTMLMediaElement.prototype.pause"))
        assertTrue(script.contains("var result = nativePause.apply(this, arguments)"))
        assertTrue(script.contains("return result;"))
        // Arming suppression has to undo the pause that already landed, on both
        // the element and YouTube's own player state, or it stays stopped.
        assertTrue(script.contains("function ensurePlaying()"))
        assertTrue(script.contains("function syncPlayerState()"))
        assertTrue(script.contains("if (state !== null && state !== 1)"))
        assertTrue(script.contains("player.playVideo()"))
    }

    @Test
    fun `stands down while the screen is locked`() {
        // Measured on a locked screen: Chromium suspends the video element
        // natively and re-pauses it on every play() attempt (21 pause events in
        // 17 s, lock-screen card flapping between playing and paused), while a
        // plain <audio> element in the same page keeps playing. Nothing the page
        // can do brings the video back, so the retry loop waits for the screen
        // instead of fighting it.
        assertTrue(script.contains("window._advoidSetScreenInteractive = function(on)"))
        assertTrue(script.contains("window._advoidScreenInteractive = true"))
        assertTrue(script.contains("if (window._advoidScreenInteractive === false) return"))
        assertTrue(script.contains("if (interactive && window._advoidBgAudioArmed)"))
        assertTrue(script.contains("armKeepAlive();"))
    }

    @Test
    fun `the pip presentation is a reversible class toggle`() {
        assertTrue(pipScript.contains("window._advoidSetPipPresentation = function(on)"))
        assertTrue(pipScript.contains("classList.toggle('advoid-pip'"))
        assertTrue(pipScript.contains("window._advoidPipActive = on === true"))
        // Inline styling is what made YouTube cache a hidden-video offset on the
        // <video> element, which left a black, untappable player behind.
        assertFalse(pipScript.contains(".style."))
        assertFalse(pipScript.contains("position"))
    }
}
