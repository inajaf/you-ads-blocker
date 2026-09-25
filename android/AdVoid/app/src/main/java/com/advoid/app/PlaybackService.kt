package com.advoid.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat

/** Transport action requested by the notification, lock screen, or a media key. */
enum class MediaAction { PLAY, PAUSE, STOP }

/**
 * Foreground `mediaPlayback` service that keeps AdVoid's WebView audio running
 * when the activity is not visible, and exposes the playback session to the
 * system (notification, lock screen, media keys).
 *
 * Why it is needed: Android 17 "background audio hardening" silences audio and
 * ignores audio-focus requests from background apps that are not running a
 * foreground service (`AudioHardening ... level: partial` in `dumpsys audio`),
 * and Android may freeze the backgrounded WebView process. See
 * docs/decisions.md.
 *
 * The service deliberately does NOT request audio focus or hold a wake lock.
 * Chromium's own `AudioFocusDelegate` owns focus for the WebView's media
 * pipeline; a second app-level focus request would fight it, and the earlier
 * removed attempt (2026-08-25) proved that keeping the process alive without
 * addressing the page/visibility and hardening causes did not produce audio.
 *
 * The service is only ever started from the foreground (while the activity is
 * visible) because while-in-use capability is what exempts the app from the
 * hardening rules; [updatePlayback] is a no-op when the service is not running.
 */
class PlaybackService : Service() {
    private var session: MediaSession? = null
    private var playing = false
    private var title: String? = null
    private var artist: String? = null
    private var positionMs = 0L
    private var durationMs = 0L

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        ensureSession()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.let { readState(it) }
        // Always become foreground before any early return: a service launched
        // with startForegroundService that never calls startForeground is killed
        // by the platform (and would crash the app).
        startForegroundCompat()
        publishState()
        // Transport actions from the notification are explicit user intent.
        when (intent?.action) {
            ACTION_PLAY -> dispatch(MediaAction.PLAY)
            ACTION_PAUSE -> dispatch(MediaAction.PAUSE)
        }
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiping the task away is a user decision to end the session; do not
        // leave an orphaned media notification behind.
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        session?.isActive = false
        session?.release()
        session = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        // Belt and braces: some Android builds keep the FGS notification record
        // after stopForeground, which would leave a dead playback notification.
        getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Called by [updatePlayback] whenever the page reports a new media state. */
    fun applyPlayback(
        playing: Boolean,
        positionMs: Long,
        durationMs: Long,
        title: String?,
        artist: String?,
    ) {
        this.playing = playing
        this.positionMs = positionMs.coerceAtLeast(0L)
        this.durationMs = durationMs.coerceAtLeast(0L)
        if (!title.isNullOrBlank()) this.title = title
        if (!artist.isNullOrBlank()) this.artist = artist
        publishState()
    }

    private fun readState(intent: Intent) {
        playing = intent.getBooleanExtra(EXTRA_PLAYING, playing)
        positionMs = intent.getLongExtra(EXTRA_POSITION_MS, positionMs)
        durationMs = intent.getLongExtra(EXTRA_DURATION_MS, durationMs)
        intent.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() }?.let { title = it }
        intent.getStringExtra(EXTRA_ARTIST)?.takeIf { it.isNotBlank() }?.let { artist = it }
    }

    private fun ensureSession() {
        if (session != null) return
        session = MediaSession(this, SESSION_TAG).apply {
            setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = dispatch(MediaAction.PLAY)
                override fun onPause() = dispatch(MediaAction.PAUSE)
                override fun onStop() = dispatch(MediaAction.STOP)
            })
            setSessionActivity(openAppIntent())
            isActive = true
        }
    }

    private fun dispatch(action: MediaAction) {
        val listener = actionListener
        if (listener == null) {
            // No activity left to drive the WebView: never leave a phantom
            // notification claiming playback that nothing can control.
            Log.w(TAG, "media action $action with no attached listener; stopping")
            stopSelf()
            return
        }
        listener(action)
    }

    private fun publishState() {
        val mediaSession = session ?: return
        // No duration/seek metadata: the session does not expose ACTION_SEEK_TO,
        // so advertising a length would render a lock-screen scrubber that
        // cannot move the WebView's playback position.
        val metadata = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title ?: DEFAULT_TITLE)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist ?: DEFAULT_ARTIST)
        mediaSession.setMetadata(metadata.build())
        mediaSession.setPlaybackState(
            PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY or
                        PlaybackState.ACTION_PAUSE or
                        PlaybackState.ACTION_PLAY_PAUSE or
                        PlaybackState.ACTION_STOP
                )
                .setState(
                    if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    positionMs,
                    if (playing) 1f else 0f,
                )
                .build()
        )
        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun startForegroundCompat() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Keeps AdVoid audio playing while the app is in the background"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun openAppIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).setAction(ACTION_OPEN_APP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun buildNotification(): Notification {
        val style = Notification.MediaStyle()
        session?.let { style.setMediaSession(it.sessionToken) }
        val builder = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_advoid_playback)
            .setContentTitle(title ?: DEFAULT_TITLE)
            .setContentText(artist ?: DEFAULT_ARTIST)
            .setContentIntent(openAppIntent())
            .setStyle(style)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        // API 33+ renders media controls from the MediaSession, but older
        // platforms (minSdk 26) only show what the notification itself carries.
        transportAction(
            if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
            if (playing) "Pause" else "Play",
            if (playing) ACTION_PAUSE else ACTION_PLAY,
            REQUEST_PLAY_PAUSE,
        ).let { action ->
            builder.addAction(action)
            style.setShowActionsInCompactView(0)
        }
        return builder.build()
    }

    private fun transportAction(
        iconRes: Int,
        label: String,
        action: String,
        requestCode: Int,
    ): Notification.Action {
        val intent = Intent(this, PlaybackService::class.java)
            .setAction(action)
            .setPackage(packageName)
        val pending = PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Action.Builder(
            Icon.createWithResource(this, iconRes),
            label,
            pending,
        ).build()
    }

    companion object {
        private const val TAG = "AdVoid"
        private const val CHANNEL_ID = "advoid_playback"
        private const val NOTIFICATION_ID = 1
        private const val SESSION_TAG = "AdVoidPlayback"
        private const val DEFAULT_TITLE = "AdVoid"
        private const val DEFAULT_ARTIST = "Playing in the background"

        const val ACTION_START = "com.advoid.app.action.START_PLAYBACK"
        const val ACTION_PLAY = "com.advoid.app.action.PLAY"
        const val ACTION_PAUSE = "com.advoid.app.action.PAUSE"
        const val ACTION_OPEN_APP = "com.advoid.app.action.OPEN_APP"
        private const val REQUEST_PLAY_PAUSE = 31
        private const val EXTRA_PLAYING = "playing"
        private const val EXTRA_POSITION_MS = "positionMs"
        private const val EXTRA_DURATION_MS = "durationMs"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_ARTIST = "artist"

        /** The running service, if any. Same process, so no IPC is needed. */
        @Volatile
        private var instance: PlaybackService? = null

        /**
         * Receives transport actions from the system. Owned by MainActivity
         * (set while the activity exists, cleared with it); a null listener
         * makes the service stop itself rather than strand the notification.
         */
        @Volatile
        var actionListener: ((MediaAction) -> Unit)? = null

        fun start(
            context: Context,
            playing: Boolean,
            positionMs: Long,
            durationMs: Long,
            title: String?,
            artist: String?,
        ) {
            val intent = Intent(context, PlaybackService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_PLAYING, playing)
                .putExtra(EXTRA_POSITION_MS, positionMs)
                .putExtra(EXTRA_DURATION_MS, durationMs)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_ARTIST, artist)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, PlaybackService::class.java))
        }

        /** No-op unless the service is already running (never starts it). */
        fun updatePlayback(
            playing: Boolean,
            positionMs: Long,
            durationMs: Long,
            title: String?,
            artist: String?,
        ) {
            instance?.applyPlayback(playing, positionMs, durationMs, title, artist)
        }
    }
}
