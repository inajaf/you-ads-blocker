package com.advoid.app

/**
 * What the activity must do about background audio after a state change.
 *
 * [startForegroundService] / [stopForegroundService] are one-shot transitions
 * (true only on the call that crosses the boundary); [visibilitySpoof] and
 * [suppressPagePause] are desired armed states and are safe to apply
 * idempotently.
 */
data class BackgroundPlaybackState(
    val startForegroundService: Boolean = false,
    val stopForegroundService: Boolean = false,
    val visibilitySpoof: Boolean = false,
    val suppressPagePause: Boolean = false,
)

/**
 * Decides when AdVoid runs its `mediaPlayback` foreground service, arms the
 * page-side visibility bridge, and suppresses the page's own pauses.
 *
 * Measured behaviour that shapes this state machine (API 37 emulator, see
 * docs/decisions.md):
 *  - YouTube's mobile player reacts to `visibilitychange` by calling
 *    `jmr.stopVideo()` -> `HTMLMediaElement.load()`, which resets the current
 *    position to 0 and unloads the media. The spoof therefore has to be armed
 *    for the whole playback session, not once the app is already hidden, or
 *    YouTube wins the race.
 *  - Android 17 "background audio hardening" silences playback and ignores
 *    audio-focus requests unless the app runs a foreground service that was
 *    started while it was visible (while-in-use capability). A background start
 *    produces `AudioHardening ... level: full` and stays muted, so a service is
 *    never (re)started from the background — only kept alive.
 *  - In Picture-in-Picture the activity is *paused* but still visible, and
 *    YouTube's player calls `pauseVideo()` continuously (roughly four times a
 *    second) from its own state machine, so audio stops even though the media
 *    pipeline is healthy. Those script pauses have to be suppressed while the
 *    app is not interactively resumed, while real user taps still pause.
 *  - A `playing=false` report received while the app is not resumed is therefore
 *    not trusted to end the session: it is either the platform pausing the
 *    media (this feature's whole reason to exist) or YouTube's own PiP pause.
 *    Reports received while resumed, explicit system actions, and the `ended`
 *    flag are authoritative and do end it.
 *
 * No Android imports: pure logic, unit-tested like PlaybackUiCoordinator.
 */
class BackgroundPlaybackCoordinator {
    /** Started = on screen to the user; resumed = interactive right now. */
    private var activityStarted = false
    private var activityResumed = false
    private var userPlaybackActive = false
    private var backgroundAudioEnabled = true
    private var serviceRunning = false

    fun onActivityStarted(started: Boolean): BackgroundPlaybackState {
        activityStarted = started
        return currentState()
    }

    fun onActivityResumed(resumed: Boolean): BackgroundPlaybackState {
        activityResumed = resumed
        return currentState()
    }

    /** Rich playback state pushed from the page (see AdVoidBridge.onMediaStateChanged). */
    fun onMediaStateChanged(playing: Boolean, ended: Boolean): BackgroundPlaybackState {
        when {
            ended -> userPlaybackActive = false
            activityResumed -> userPlaybackActive = playing
            playing -> userPlaybackActive = true
            // Not resumed and not playing: the platform or YouTube's own PiP
            // state machine paused the media. Keep the session armed so the
            // keep-alive and the pause suppression can carry it; the next report
            // received while the activity is resumed is authoritative.
        }
        return currentState()
    }

    /** The user paused/resumed explicitly (in-app control, notification, media key). */
    fun onUserPlaybackRequest(playing: Boolean): BackgroundPlaybackState {
        userPlaybackActive = playing
        return currentState()
    }

    fun onBackgroundAudioEnabledChanged(enabled: Boolean): BackgroundPlaybackState {
        backgroundAudioEnabled = enabled
        return currentState()
    }

    /** The activity is being torn down (task removed or finished). */
    fun onSessionEnded(): BackgroundPlaybackState {
        userPlaybackActive = false
        return currentState()
    }

    /**
     * Picture-in-Picture is the guaranteed path: Google's Android 17 hardening
     * doc explicitly exempts apps whose only background audio happens while an
     * activity is visible, "including using Picture in Picture (PiP) mode".
     */
    fun shouldEnterPictureInPicture(pipSupported: Boolean): Boolean =
        pipSupported && backgroundAudioEnabled && userPlaybackActive && activityStarted

    /**
     * On API 31+ the system should own the PiP transition (`setAutoEnterEnabled`).
     * Measured on a real device: collapsing with the system transition keeps the
     * WebView surface alive and the audio playing, while entering PiP from
     * `onUserLeaveHint` hides the WebView for a moment and Chromium pauses the
     * media natively. The legacy call therefore stays for API 26-30 only.
     */
    fun shouldAutoEnterPictureInPicture(pipSupported: Boolean, apiLevel: Int): Boolean =
        apiLevel >= AUTO_ENTER_API_LEVEL && shouldEnterPictureInPicture(pipSupported)

    fun isServiceRunning(): Boolean = serviceRunning

    fun isBackgroundAudioEnabled(): Boolean = backgroundAudioEnabled

    private fun currentState(): BackgroundPlaybackState {
        val shouldRun = backgroundAudioEnabled && userPlaybackActive

        // Start only from the foreground, and never twice.
        val start = shouldRun && activityStarted && !serviceRunning
        if (start) serviceRunning = true

        // Stop when playback is finished/disabled; a backgrounded app that stops
        // reporting playback keeps the session (see onMediaStateChanged).
        val stop = !shouldRun && serviceRunning
        if (stop) serviceRunning = false

        return BackgroundPlaybackState(
            startForegroundService = start,
            stopForegroundService = stop,
            visibilitySpoof = shouldRun,
            suppressPagePause = shouldRun && !activityResumed,
        )
    }

    companion object {
        /** Android 12 (S) is the first release with setAutoEnterEnabled. */
        const val AUTO_ENTER_API_LEVEL = 31
    }
}
