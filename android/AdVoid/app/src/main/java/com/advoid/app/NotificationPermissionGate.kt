package com.advoid.app

/**
 * Pure decision for the one-time `POST_NOTIFICATIONS` request.
 *
 * The permission only controls whether the ongoing playback notification is
 * visible — the `mediaPlayback` foreground service runs either way — so asking
 * more than once per install would be user-hostile, and a dialog on top of the
 * activity is itself an activity, which keeps Home from reaching AdVoid and
 * stops Picture-in-Picture from engaging.
 */
object NotificationPermissionGate {
    fun shouldRequest(
        apiLevel: Int,
        granted: Boolean,
        askedThisSession: Boolean,
        askedBefore: Boolean,
    ): Boolean {
        if (apiLevel < MIN_API_WITH_NOTIFICATION_PERMISSION) return false
        if (granted) return false
        if (askedThisSession) return false
        return !askedBefore
    }

    private const val MIN_API_WITH_NOTIFICATION_PERMISSION = 33
}
