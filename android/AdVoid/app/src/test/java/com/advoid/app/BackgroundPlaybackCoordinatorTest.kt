package com.advoid.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The coordinator encodes the measured platform behaviour that makes background
 * audio work (or not) on Android 17 — see docs/decisions.md and the KDoc on
 * [BackgroundPlaybackCoordinator]. These tests pin the decisions, not the UI.
 */
class BackgroundPlaybackCoordinatorTest {
    private val coordinator = BackgroundPlaybackCoordinator()

    private fun foregroundPlayback() {
        coordinator.onActivityStarted(true)
        coordinator.onActivityResumed(true)
        coordinator.onMediaStateChanged(playing = true, ended = false)
    }

    @Test
    fun `playback started in the foreground starts the service and arms the bridge`() {
        coordinator.onActivityStarted(true)
        coordinator.onActivityResumed(true)

        val state = coordinator.onMediaStateChanged(playing = true, ended = false)

        assertTrue(state.startForegroundService)
        assertFalse(state.stopForegroundService)
        assertTrue(state.visibilitySpoof)
        assertFalse("a resumed activity must keep its own pauses", state.suppressPagePause)
        assertTrue(coordinator.isServiceRunning())
    }

    @Test
    fun `the service is started once per playback session`() {
        foregroundPlayback()

        assertFalse(coordinator.onMediaStateChanged(playing = true, ended = false).startForegroundService)
        assertFalse(coordinator.onActivityStarted(true).startForegroundService)
    }

    @Test
    fun `leaving the app keeps the service running and the bridge armed`() {
        foregroundPlayback()

        val state = coordinator.onActivityStarted(false)

        assertFalse(state.startForegroundService)
        assertFalse(state.stopForegroundService)
        assertTrue(state.visibilitySpoof)
        assertTrue(coordinator.isServiceRunning())
    }

    @Test
    fun `pausing the activity suppresses page pauses without ending the session`() {
        foregroundPlayback()

        // Picture-in-Picture and backgrounding both land here: the activity is
        // paused while the page (and the audio) must keep running.
        val state = coordinator.onActivityResumed(false)

        assertTrue(state.visibilitySpoof)
        assertTrue(state.suppressPagePause)
        assertFalse(state.stopForegroundService)
        assertTrue(coordinator.isServiceRunning())
    }

    @Test
    fun `resuming releases page pause suppression`() {
        foregroundPlayback()
        coordinator.onActivityResumed(false)

        val state = coordinator.onActivityResumed(true)

        assertFalse(state.suppressPagePause)
        assertTrue(state.visibilitySpoof)
    }

    @Test
    fun `a pause report from a paused activity does not end the session`() {
        foregroundPlayback()
        coordinator.onActivityResumed(false)

        val state = coordinator.onMediaStateChanged(playing = false, ended = false)

        assertFalse(state.stopForegroundService)
        assertTrue(state.visibilitySpoof)
        assertTrue(state.suppressPagePause)
        assertTrue(coordinator.isServiceRunning())
    }

    @Test
    fun `a pause report from a resumed activity stops the service`() {
        foregroundPlayback()

        val state = coordinator.onMediaStateChanged(playing = false, ended = false)

        assertTrue(state.stopForegroundService)
        assertFalse(state.visibilitySpoof)
        assertFalse(state.suppressPagePause)
        assertFalse(coordinator.isServiceRunning())
    }

    @Test
    fun `a finished video stops the session even while the activity is paused`() {
        foregroundPlayback()
        coordinator.onActivityResumed(false)

        val state = coordinator.onMediaStateChanged(playing = false, ended = true)

        assertTrue(state.stopForegroundService)
        assertFalse(state.visibilitySpoof)
        assertFalse(state.suppressPagePause)
    }

    @Test
    fun `an explicit system pause stops the session while paused`() {
        foregroundPlayback()
        coordinator.onActivityResumed(false)

        val state = coordinator.onUserPlaybackRequest(false)

        assertTrue(state.stopForegroundService)
        assertFalse(state.visibilitySpoof)
    }

    @Test
    fun `the service is never started from the background`() {
        coordinator.onActivityStarted(false)
        coordinator.onActivityResumed(false)
        coordinator.onMediaStateChanged(playing = true, ended = false)

        assertFalse(coordinator.isServiceRunning())
    }

    @Test
    fun `playback that started while backgrounded is picked up on return`() {
        coordinator.onActivityStarted(false)
        coordinator.onMediaStateChanged(playing = true, ended = false)
        assertFalse(coordinator.isServiceRunning())

        // Returning to the app is the first moment a while-in-use foreground
        // service can legally be started (Android 17 hardening).
        val state = coordinator.onActivityStarted(true)

        assertTrue(state.startForegroundService)
        assertTrue(coordinator.isServiceRunning())
    }

    @Test
    fun `disabling background audio stops the service and disarms the bridge`() {
        foregroundPlayback()

        val state = coordinator.onBackgroundAudioEnabledChanged(false)

        assertTrue(state.stopForegroundService)
        assertFalse(state.visibilitySpoof)
        assertFalse(state.suppressPagePause)
        assertFalse(coordinator.isServiceRunning())
        assertFalse(coordinator.isBackgroundAudioEnabled())
    }

    @Test
    fun `disabling background audio while paused still stops the session`() {
        foregroundPlayback()
        coordinator.onActivityResumed(false)

        val state = coordinator.onBackgroundAudioEnabledChanged(false)

        assertTrue(state.stopForegroundService)
        assertFalse(state.visibilitySpoof)
        assertFalse(state.suppressPagePause)
    }

    @Test
    fun `picture in picture needs a supported device, a visible activity and playback`() {
        foregroundPlayback()

        assertTrue(coordinator.shouldEnterPictureInPicture(pipSupported = true))
        assertFalse(coordinator.shouldEnterPictureInPicture(pipSupported = false))

        coordinator.onActivityStarted(false)
        assertFalse(coordinator.shouldEnterPictureInPicture(pipSupported = true))
    }

    @Test
    fun `picture in picture is refused when background audio is disabled`() {
        foregroundPlayback()
        coordinator.onBackgroundAudioEnabledChanged(false)

        assertFalse(coordinator.shouldEnterPictureInPicture(pipSupported = true))
    }

    @Test
    fun `the system owns the pip transition from Android 12`() {
        foregroundPlayback()

        assertTrue(
            coordinator.shouldAutoEnterPictureInPicture(
                pipSupported = true,
                apiLevel = BackgroundPlaybackCoordinator.AUTO_ENTER_API_LEVEL,
            ),
        )
        // Older platforms have no setAutoEnterEnabled and keep the legacy call.
        assertFalse(
            coordinator.shouldAutoEnterPictureInPicture(
                pipSupported = true,
                apiLevel = BackgroundPlaybackCoordinator.AUTO_ENTER_API_LEVEL - 1,
            ),
        )
    }

    @Test
    fun `auto-enter follows the same gates as the legacy pip entry`() {
        foregroundPlayback()

        assertFalse(
            coordinator.shouldAutoEnterPictureInPicture(pipSupported = false, apiLevel = 34),
        )

        coordinator.onBackgroundAudioEnabledChanged(false)
        assertFalse(
            coordinator.shouldAutoEnterPictureInPicture(pipSupported = true, apiLevel = 34),
        )
    }

    @Test
    fun `auto-enter stays off while nothing is playing`() {
        coordinator.onActivityStarted(true)
        coordinator.onActivityResumed(true)

        assertFalse(
            coordinator.shouldAutoEnterPictureInPicture(pipSupported = true, apiLevel = 34),
        )
    }

    @Test
    fun `ending the session stops the service`() {
        foregroundPlayback()

        val state = coordinator.onSessionEnded()

        assertTrue(state.stopForegroundService)
        assertFalse(coordinator.isServiceRunning())
    }
}
