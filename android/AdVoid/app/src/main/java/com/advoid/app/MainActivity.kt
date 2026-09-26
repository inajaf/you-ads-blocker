package com.advoid.app

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.graphics.*
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.util.Rational
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import android.app.Activity
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var rootLayout: LinearLayout
    private lateinit var webView: WebView
    private lateinit var adBlocker: AdBlocker
    private val playbackUiCoordinator = PlaybackUiCoordinator()
    private lateinit var refreshIndicator: ProgressBar

    // Background audio (see BackgroundPlaybackCoordinator / docs/decisions.md).
    private val backgroundPlayback = BackgroundPlaybackCoordinator()
    private var appMenuBar: LinearLayout? = null
    private var visibilitySpoofArmed = false
    private var pauseSuppressionArmed = false
    private var notificationPermissionRequested = false
    private var leavingForInternalActivity = false
    private var pipActive = false
    /** Screen on/off, tracked natively: locked screens cannot play WebView video. */
    private var screenInteractive = true
    private var screenReceiverRegistered = false
    private var activityResumed = false

    /** Last value handed to the system, so params are only pushed on changes. */
    private var autoEnterEnabled = false
    private var pipNudges = 0
    private var lastNudgeAt = 0L
    private var pipNudgeRunnable: Runnable? = null

    /**
     * Stops are deferred: a pause followed by a resume a moment later must not
     * tear the foreground service down and bring it straight back up.
     */
    private var serviceStopPending = false
    private val stopServiceRunnable = Runnable {
        if (!serviceStopPending) return@Runnable
        serviceStopPending = false
        PlaybackService.stop(this)
        Log.i(TAG, "background playback service stopped")
    }
    private var pipActionReceiverRegistered = false

    // Latest media state reported by the page; mirrored into the playback
    // service (notification/lock screen) and the PiP action button.
    private var mediaPlaying = false
    private var mediaTitle: String? = null
    private var mediaArtist: String? = null
    private var mediaPositionMs = 0L
    private var mediaDurationMs = 0L

    // Fullscreen video support
    private var customViewContainer: FrameLayout? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var originalSystemUiVisibility = 0

    private val green = Color.parseColor("#5FCA6B")
    private val darkBg = Color.parseColor("#0F0F0F")
    private val videoWatchScript by lazy {
        val logo = resources.openRawResource(R.drawable.advoid_loading_logo).use { stream ->
            Base64.encodeToString(stream.readBytes(), Base64.NO_WRAP)
        }
        VIDEO_WATCH_SCRIPT_TEMPLATE.replace(
            "__ADVOID_LOGO_DATA_URI__",
            "data:image/png;base64,$logo",
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Registered for the activity's whole life: the PiP action button is
        // only reachable while the activity is in PiP (still started), but the
        // registration must not race the PiP transition.
        registerPipActions()
        registerScreenStateReceiver()
        screenInteractive = (getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive

        // Expose the WebView to chrome://inspect on every build (debug and
        // release) so QA can verify page state without a debug-only socket.
        WebView.setWebContentsDebuggingEnabled(true)

        adBlocker = AdBlocker(this)
        adBlocker.loadAssets()

        rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(darkBg)
            fitsSystemWindows = true
        }

        // WebView
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

            // JavaScript reports aggregate playback state. Native code combines it
            // with the Activity lifecycle before changing window flags.
            addJavascriptInterface(object {
                @JavascriptInterface
                fun onPlaybackStateChanged(playing: Boolean) {
                    runOnUiThread {
                        applyPlaybackUiState(
                            playbackUiCoordinator.onVideoPlaybackChanged(playing)
                        )
                    }
                }
                @JavascriptInterface
                fun onMediaStateChanged(stateJson: String) {
                    val state = try {
                        JSONObject(stateJson)
                    } catch (e: Exception) {
                        Log.e(TAG, "media state parse failed: ${e.message}")
                        return
                    }
                    runOnUiThread {
                        applyMediaState(
                            playing = state.optBoolean("playing", false),
                            ended = state.optBoolean("ended", false),
                            userPaused = state.optBoolean("userPaused", false),
                            title = state.optString("title").takeIf { it.isNotEmpty() },
                            artist = state.optString("artist").takeIf { it.isNotEmpty() },
                            positionMs = state.optLong("positionMs", 0L),
                            durationMs = state.optLong("durationMs", 0L),
                        )
                    }
                }
                @JavascriptInterface
                fun onRefreshPulled() {
                    runOnUiThread {
                        refreshIndicator.visibility = View.VISIBLE
                    }
                }
                @JavascriptInterface
                fun onRefreshRelease(shouldRefresh: Boolean) {
                    runOnUiThread {
                        refreshIndicator.visibility = View.GONE
                        if (shouldRefresh) {
                            webView.reload()
                        }
                    }
                }
                @JavascriptInterface
                fun onRotationAutoFullscreen(x: Int, y: Int) {
                    runOnUiThread {
                        // requestFullscreen() needs transient user activation, which
                        // rotation alone doesn't provide. The prep script first lays a
                        // transparent overlay across the viewport (see
                        // FULLSCREEN_PREP_SCRIPT), then hands us a visible point on it;
                        // injecting a synthetic tap there is a real input event from the
                        // WebView's perspective, so the subsequent requestFullscreen()
                        // is accepted.
                        injectRotationTap(x, y)
                        webView.evaluateJavascript(AUTO_FULLSCREEN_SCRIPT, null)
                    }
                }
                @JavascriptInterface
                fun onRotationError(msg: String) {
                    Log.e(TAG, "auto-fullscreen: $msg")
                }
            }, "AdVoidBridge")

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    if (request?.url != null && adBlocker.shouldBlock(request.url.toString())) {
                        return WebResourceResponse("text/plain", "utf-8", "".byteInputStream())
                    }
                    return super.shouldInterceptRequest(view, request)
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val scheme = request?.url?.scheme ?: return false
                    // Keep browsing inside the app: drop intent:// and other
                    // external-app links (YouTube's "Open App" upsell) instead of
                    // erroring out or launching the YouTube app.
                    return scheme != "http" && scheme != "https"
                }

                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    applyPlaybackUiState(
                        playbackUiCoordinator.onVideoPlaybackChanged(false)
                    )
                    // A full page load rebuilds the player from scratch, so the
                    // previous playback session cannot continue across it.
                    applyBackgroundPlaybackState(
                        backgroundPlayback.onMediaStateChanged(playing = false, ended = true)
                    )
                    adBlocker.injectScripts(view)
                    // Best-effort earliest injection (the new document usually
                    // does not exist yet, so this evaluate can be dropped). The
                    // bridge stays correct regardless: its window-capture
                    // listeners run ahead of any document-level listener, and
                    // doUpdateVisitedHistory/onPageFinished re-inject it.
                    view?.evaluateJavascript(BACKGROUND_AUDIO_SCRIPT, null)
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    injectPageScripts(view)
                }

                override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                    super.doUpdateVisitedHistory(view, url, isReload)
                    // YouTube navigates via pushState, which never fires
                    // onPageFinished — re-apply the page scripts here so styling
                    // (Shorts tweaks, Open App removal) tracks SPA navigation.
                    // All scripts are guarded, so re-running them is cheap.
                    injectPageScripts(view)
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                    if (customView != null) {
                        callback.onCustomViewHidden()
                        return
                    }
                    val decor = window.decorView as FrameLayout
                    originalSystemUiVisibility = decor.systemUiVisibility

                    customViewContainer = FrameLayout(this@MainActivity).apply {
                        setBackgroundColor(Color.BLACK)
                        addView(view, ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        ))
                    }
                    decor.addView(customViewContainer, ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    ))
                    customView = view
                    customViewCallback = callback

                    // Defensive: never let a stale prep overlay outlive the
                    // fullscreen transition. AUTO_FULLSCREEN_SCRIPT already
                    // removes #advoid-fs-target on every path, but if one ever
                    // lingers (a failed/aborted prep retry), it would sit at
                    // z-index:2147483647 and swallow every real touch on the
                    // fullscreen view — making the seek bar dead on arrival.
                    webView.evaluateJavascript(
                        "var _o=document.getElementById('advoid-fs-target'); if(_o)_o.remove();",
                        null,
                    )
                    webView.visibility = View.GONE
                    decor.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
                }

                override fun onHideCustomView() {
                    hideCustomView()
                }
            }
            loadUrl("https://m.youtube.com")
        }

        addAppMenu(rootLayout)

        // WebView added directly — no SwipeRefreshLayout wrapper
        // (pull-to-refresh handled via JavaScript to avoid intercepting touches).
        // A FrameLayout hosts the refresh indicator as a top overlay so showing
        // it never shifts the page layout.
        val webContainer = FrameLayout(this)
        webContainer.addView(webView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        refreshIndicator = ProgressBar(this).apply {
            indeterminateTintList = android.content.res.ColorStateList.valueOf(green)
            visibility = View.GONE
        }
        webContainer.addView(refreshIndicator, FrameLayout.LayoutParams(dp(36), dp(36)).apply {
            gravity = Gravity.CENTER_HORIZONTAL or Gravity.TOP
            topMargin = dp(12)
        })
        rootLayout.addView(webContainer, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        // Transport controls (notification, lock screen, media keys) are routed
        // back into the WebView. Installed only now that the WebView exists: a
        // stale session's action delivered during onCreate would otherwise hit
        // an uninitialised lateinit field.
        PlaybackService.actionListener = { action ->
            runOnUiThread { handleMediaAction(action) }
        }
        // Lock-screen/media-card scrubber: forward the requested position into
        // the WebView player (the session advertises duration for this).
        PlaybackService.seekListener = { positionMs ->
            runOnUiThread { evaluateMediaAction("seek", positionMs) }
        }

        setContentView(rootLayout)
    }

    /** Keep the required privacy link above the WebView, clear of video controls. */
    private fun addAppMenu(host: LinearLayout) {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), 0, dp(8), 0)
            setBackgroundColor(darkBg)
        }
        bar.addView(TextView(this).apply {
            text = "AdVoid"
            textSize = 14f
            setTextColor(Color.parseColor("#AAB0B5"))
            gravity = Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
        val button = TextView(this).apply {
            text = "\u22ee"
            textSize = 24f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            contentDescription = "AdVoid options"
            isClickable = true
            isFocusable = true
            setOnClickListener { anchor ->
                PopupMenu(this@MainActivity, anchor).apply {
                    menu.add("Privacy policy").setOnMenuItemClickListener {
                        if (isValidPrivacyPolicyUrl(PRIVACY_POLICY_URL)) {
                            openInBrowser(PRIVACY_POLICY_URL, "privacy policy")
                        } else {
                            Log.e(TAG, "privacy policy URL is invalid or unavailable; refusing to open it")
                        }
                        true
                    }
                    // Background audio is on by default (the app's point is to
                    // keep the video's sound running when the user leaves). This
                    // is the escape hatch: turning it off restores plain WebView
                    // suspension and disarms the page-side visibility bridge.
                    menu.add("Background audio").apply {
                        isCheckable = true
                        isChecked = backgroundPlayback.isBackgroundAudioEnabled()
                    }.setOnMenuItemClickListener { item ->
                        item.isChecked = !item.isChecked
                        applyBackgroundPlaybackState(
                            backgroundPlayback.onBackgroundAudioEnabledChanged(item.isChecked)
                        )
                        updatePictureInPictureParams()
                        Log.i(TAG, "background audio enabled=${item.isChecked}")
                        true
                    }
                    show()
                }
            }
        }
        bar.addView(button, LinearLayout.LayoutParams(dp(48), dp(48)))
        appMenuBar = bar
        host.addView(bar, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(48)))
    }

    private fun openInBrowser(url: String, what: String) {
        try {
            // Starting another activity fires onUserLeaveHint; flag it so opening
            // the privacy policy never shrinks a playing video into PiP.
            leavingForInternalActivity = true
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            leavingForInternalActivity = false
            Log.e(TAG, "open $what failed: ${e.message}", e)
        }
    }

    private fun injectPageScripts(view: WebView?) {
        view?.evaluateJavascript(STYLE_SCRIPT, null)
        view?.evaluateJavascript(FULLSCREEN_SETTINGS_SCRIPT, null)
        view?.evaluateJavascript(videoWatchScript, null)
        view?.evaluateJavascript(SHORTS_SEEK_SCRIPT, null)
        view?.evaluateJavascript(PULL_REFRESH_SCRIPT, null)
        view?.evaluateJavascript(LIVE_CHAT_SCRIPT, null)
        view?.evaluateJavascript(BACKGROUND_AUDIO_SCRIPT, null)
        view?.evaluateJavascript(PIP_PRESENTATION_SCRIPT, null)
        // Keep the page's screen state in step after every injection/navigation.
        view?.evaluateJavascript(
            "window._advoidSetScreenInteractive && window._advoidSetScreenInteractive($screenInteractive);",
            null,
        )
        // Keep the Shorts marker class + reel-entry tracking current on SPA navs.
        view?.evaluateJavascript("window._advoidTrackNav && window._advoidTrackNav();", null)
    }

    private fun hideCustomView() {
        if (customView == null) return
        val decor = window.decorView as FrameLayout
        decor.systemUiVisibility = originalSystemUiVisibility
        customViewContainer?.let { decor.removeView(it) }
        customViewContainer = null
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        webView.visibility = View.VISIBLE
    }

    private fun applyPlaybackUiState(state: PlaybackUiState) {
        if (state.keepScreenOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    /** Latest rich playback state pushed by the page's VIDEO_WATCH_SCRIPT. */
    private fun applyMediaState(
        playing: Boolean,
        ended: Boolean,
        userPaused: Boolean,
        title: String?,
        artist: String?,
        positionMs: Long,
        durationMs: Long,
    ) {
        mediaPlaying = playing
        if (title != null) mediaTitle = title
        if (artist != null) mediaArtist = artist
        mediaPositionMs = positionMs
        mediaDurationMs = durationMs

        if (userPaused) {
            // The page only sets this when a real tap or transport action let a
            // pause through. That is explicit user intent, so it ends the
            // session even while the activity is paused (where platform pauses
            // are otherwise ignored).
            Log.i(TAG, "playback paused by the user; ending the background session")
            applyBackgroundPlaybackState(backgroundPlayback.onUserPlaybackRequest(false))
        } else {
            applyBackgroundPlaybackState(backgroundPlayback.onMediaStateChanged(playing, ended))
            if (playing && pipActive) {
                // Playback is confirmed healthy inside PiP: stop nudging. The
                // per-session budget is deliberately not reset, so an oscillating
                // player cannot keep the loop alive forever.
                cancelPipNudges()
            }
            // Inside PiP the window is on screen, so a "paused" report that the
            // user did not ask for is the platform's pause during the PiP
            // transition. Nudge playback back — but only while the coordinator
            // still has a session to defend: after an explicit user pause the
            // session is already ended, and nudging there would undo the pause
            // (measured: YouTube reports playing=false again without the
            // one-shot userPaused flag).
            if (!playing && pipActive && !activityResumed &&
                backgroundPlayback.isServiceRunning() &&
                backgroundPlayback.isBackgroundAudioEnabled()
            ) {
                nudgePlayback("pip reported no playback")
            }
        }
        PlaybackService.updatePlayback(playing, positionMs, durationMs, mediaTitle, mediaArtist)
        updatePictureInPictureParams()
    }

    /**
     * Applies the coordinator's decisions: start the `mediaPlayback` foreground
     * service, stop it, and arm/disarm the page-side visibility bridge.
     *
     * The bridge is idempotent and re-arms itself on every page injection, so
     * the JS round trip only happens when the desired state changes.
     */
    private fun applyBackgroundPlaybackState(state: BackgroundPlaybackState) {
        if (state.startForegroundService) {
            if (serviceStopPending) {
                // Playback resumed inside the stop grace period, so the service
                // is still alive: refresh it and never restart it. A
                // startForegroundService immediately after a stop makes the
                // platform kill the app with
                // ForegroundServiceDidNotStartInTimeException (measured in the
                // emulator when YouTube's state flapped pause/play twice after a
                // transport pause).
                serviceStopPending = false
                webView.removeCallbacks(stopServiceRunnable)
                Log.i(TAG, "playback resumed during the stop grace period; keeping the service")
                PlaybackService.updatePlayback(
                    mediaPlaying,
                    mediaPositionMs,
                    mediaDurationMs,
                    mediaTitle,
                    mediaArtist,
                )
            } else {
                requestNotificationPermissionIfNeeded()
                val started = try {
                    PlaybackService.start(
                        this,
                        mediaPlaying,
                        mediaPositionMs,
                        mediaDurationMs,
                        mediaTitle,
                        mediaArtist,
                    )
                    true
                } catch (e: RuntimeException) {
                    // IllegalStateException covers
                    // ForegroundServiceStartNotAllowedException; RuntimeException
                    // also covers RemoteServiceException, which the platform
                    // throws when it refuses to bring a service up. Either way,
                    // roll the coordinator back so a later foreground attempt can
                    // retry instead of latching "already running".
                    Log.w(TAG, "playback service refused to start: ${e.message}")
                    false
                }
                if (!started) {
                    applyBackgroundPlaybackState(backgroundPlayback.onSessionEnded())
                    return
                }
                Log.i(TAG, "background playback service started")
            }
        }
        if (state.stopForegroundService && !serviceStopPending) {
            // Stop on a grace period, never synchronously: a pause that is
            // followed by a resume a moment later must not stop and start the
            // foreground service in quick succession. The notification already
            // reflects the paused state through updatePlayback().
            serviceStopPending = true
            webView.postDelayed(stopServiceRunnable, SERVICE_STOP_GRACE_MS)
            Log.i(TAG, "background playback service stop scheduled")
        }
        if (state.visibilitySpoof != visibilitySpoofArmed) {
            visibilitySpoofArmed = state.visibilitySpoof
            webView.evaluateJavascript(
                "window._advoidSetBackgroundAudio && window._advoidSetBackgroundAudio(${state.visibilitySpoof});",
                null,
            )
        }
        if (state.suppressPagePause != pauseSuppressionArmed) {
            pauseSuppressionArmed = state.suppressPagePause
            webView.evaluateJavascript(
                "window._advoidSetPagePauseSuppression && window._advoidSetPagePauseSuppression(${state.suppressPagePause});",
                null,
            )
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        val preferences = getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
        val shouldRequest = NotificationPermissionGate.shouldRequest(
            apiLevel = Build.VERSION.SDK_INT,
            granted = checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED,
            askedThisSession = notificationPermissionRequested,
            askedBefore = preferences.getBoolean(PREFERENCE_NOTIFICATION_ASKED, false),
        )
        notificationPermissionRequested = true
        if (!shouldRequest) return
        // Asked at most once per install, while the activity is visible at the
        // first in-app playback. Android remembers a denial, but re-requesting on
        // every launch would still pop the dialog over the app (and a dialog on
        // top is an activity that keeps Home from reaching us, so PiP would not
        // engage). The foreground service runs either way: the permission only
        // decides whether the playback notification is visible.
        preferences.edit().putBoolean(PREFERENCE_NOTIFICATION_ASKED, true).apply()
        requestPermissions(
            arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
            REQUEST_NOTIFICATIONS,
        )
    }

    /** Transport controls from the notification, lock screen, or a media key. */
    private fun handleMediaAction(action: MediaAction) {
        when (action) {
            MediaAction.PLAY -> {
                val state = backgroundPlayback.onUserPlaybackRequest(true)
                pipNudges = 0
                evaluateMediaAction("play")
                applyBackgroundPlaybackState(state)
                updatePictureInPictureParams()
            }
            MediaAction.PAUSE -> {
                val state = backgroundPlayback.onUserPlaybackRequest(false)
                // Explicit user intent: stop nudging so the pause is never fought.
                cancelPipNudges()
                pipNudges = 0
                evaluateMediaAction("pause")
                applyBackgroundPlaybackState(state)
                updatePictureInPictureParams()
            }
            MediaAction.STOP -> {
                cancelPipNudges()
                evaluateMediaAction("pause")
                applyBackgroundPlaybackState(backgroundPlayback.onUserPlaybackRequest(false))
                // STOP is explicit: do not wait out the stop grace period.
                webView.removeCallbacks(stopServiceRunnable)
                serviceStopPending = false
                PlaybackService.stop(this)
                Log.i(TAG, "background playback service stopped")
                updatePictureInPictureParams()
            }
        }
    }

    private fun togglePlaybackFromSystem() {
        handleMediaAction(if (mediaPlaying) MediaAction.PAUSE else MediaAction.PLAY)
    }

    private fun evaluateMediaAction(action: String, positionMs: Long = 0L) {
        val argument = if (action == "seek") positionMs.toString() else "null"
        webView.evaluateJavascript(
            "window._advoidMediaAction && window._advoidMediaAction('$action', $argument);",
            null,
        )
    }

    private fun pipSupported(): Boolean =
        packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun pipParams(autoEnter: Boolean): PictureInPictureParams {
        val label = if (mediaPlaying) "Pause" else "Play"
        val icon = Icon.createWithResource(
            this,
            if (mediaPlaying) {
                android.R.drawable.ic_media_pause
            } else {
                android.R.drawable.ic_media_play
            },
        )
        val toggle = PendingIntent.getBroadcast(
            this,
            REQUEST_PIP_TOGGLE,
            Intent(ACTION_TOGGLE_PLAYBACK).setPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .setActions(listOf(RemoteAction(icon, label, label, toggle)))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Let the system own the transition (API 31+): measured on a real
            // device, the system's PiP transition keeps the WebView surface
            // alive and the audio playing, while entering PiP ourselves hides
            // the WebView for a moment and Chromium pauses the media natively.
            builder.setAutoEnterEnabled(autoEnter)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    /**
     * Keeps the system's PiP parameters in sync with playback. Auto-enter is
     * only armed while leaving the app should shrink a *playing* video into
     * PiP, so Home never produces a PiP window around a paused or stale player.
     *
     * The system call only happens when the decision changes (or while in PiP,
     * where the play/pause action icon has to follow playback).
     */
    private fun updatePictureInPictureParams() {
        if (!::webView.isInitialized) return
        val autoEnter = backgroundPlayback.shouldAutoEnterPictureInPicture(
            pipSupported(),
            Build.VERSION.SDK_INT,
        )
        if (!pipActive && autoEnter == autoEnterEnabled) return
        autoEnterEnabled = autoEnter
        try {
            setPictureInPictureParams(pipParams(autoEnter))
        } catch (e: IllegalStateException) {
            Log.w(TAG, "picture-in-picture params rejected: ${e.message}")
        }
        if (!pipActive) {
            Log.i(TAG, "picture-in-picture: auto-enter enabled=$autoEnter")
        }
    }

    /**
     * Asks the page to resume the main player after a PiP transition, with a few
     * bounded retries because YouTube's own player state settles asynchronously.
     * A user pause resets the budget, so this can never fight a deliberate pause.
     */
    private fun nudgePlayback(reason: String) {
        if (!::webView.isInitialized) return
        if (!backgroundPlayback.isBackgroundAudioEnabled()) return
        if (pipNudges >= MAX_PIP_NUDGES) return
        // With the screen off Chromium suspends the video element natively and
        // re-pauses it on every attempt, so retrying only churns the lock screen.
        if (!screenInteractive) return
        // Rate limit: a page report with playing=false used to trigger a nudge,
        // and the nudge itself produced another report — measured as ten nudges
        // in 400 ms (each one a JS evaluation plus a play attempt) while the
        // platform was pausing the media.
        val now = SystemClock.elapsedRealtime()
        if (now - lastNudgeAt < PIP_NUDGE_INTERVAL_MS) return
        lastNudgeAt = now
        pipNudges++
        Log.i(TAG, "picture-in-picture: nudging playback (attempt $pipNudges, $reason)")
        webView.evaluateJavascript(
            "window._advoidEnsurePlaying && window._advoidEnsurePlaying();",
            null,
        )
    }

    /**
     * Screen on/off. Locking the phone stops the activity, PiP is hidden and
     * Chromium suspends video media natively, so nothing can keep the audio
     * alive from the page; the bridge is told to stand down instead of retrying
     * forever, and playback is resumed once when the screen comes back.
     */
    private val screenStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> setScreenInteractive(false)
                Intent.ACTION_SCREEN_ON -> setScreenInteractive(true)
            }
        }
    }

    private fun setScreenInteractive(interactive: Boolean) {
        if (screenInteractive == interactive) return
        screenInteractive = interactive
        Log.i(TAG, "screen interactive=$interactive")
        if (!::webView.isInitialized) return
        if (!interactive) {
            cancelPipNudges()
        }
        webView.evaluateJavascript(
            "window._advoidSetScreenInteractive && window._advoidSetScreenInteractive($interactive);",
            null,
        )
        if (interactive && backgroundPlayback.isServiceRunning()) {
            // One attempt, not a budget: the page resumes on the screen-on signal
            // itself, this covers the report that arrives a moment later.
            lastNudgeAt = 0L
            nudgePlayback("screen on")
        }
    }

    private fun registerScreenStateReceiver() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(screenStateReceiver, filter)
        }
        screenReceiverRegistered = true
    }

    private fun schedulePipNudges() {
        // The WebView is hidden for part of the manual PiP transition, so the
        // immediate nudge can land too early; repeat while the PiP window is up.
        pipNudgeRunnable = Runnable {
            if (!pipActive) return@Runnable
            nudgePlayback("PiP transition")
            if (pipNudges < MAX_PIP_NUDGES) {
                webView.postDelayed(pipNudgeRunnable, PIP_NUDGE_INTERVAL_MS)
            }
        }
        webView.postDelayed(pipNudgeRunnable, PIP_NUDGE_FIRST_DELAY_MS)
    }

    private fun cancelPipNudges() {
        val pending = pipNudgeRunnable ?: return
        Log.d(TAG, "picture-in-picture: stopping pending nudges")
        webView.removeCallbacks(pending)
        pipNudgeRunnable = null
    }

    private val pipActionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_TOGGLE_PLAYBACK) togglePlaybackFromSystem()
        }
    }

    private fun registerPipActions() {
        if (pipActionReceiverRegistered) return
        val filter = IntentFilter(ACTION_TOGGLE_PLAYBACK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(pipActionReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(pipActionReceiver, filter)
        }
        pipActionReceiverRegistered = true
    }

    private fun unregisterPipActions() {
        if (!pipActionReceiverRegistered) return
        unregisterReceiver(pipActionReceiver)
        pipActionReceiverRegistered = false
    }

    @Suppress("DEPRECATION", "MissingSuperCall")
    override fun onBackPressed() {
        when {
            customView != null -> hideCustomView()
            webView.canGoBack() -> webView.goBack()
            else -> super.onBackPressed()
        }
    }

    override fun onStart() {
        super.onStart()
        applyPlaybackUiState(
            playbackUiCoordinator.onActivityVisibilityChanged(true)
        )
        applyBackgroundPlaybackState(
            backgroundPlayback.onActivityStarted(true)
        )
        updatePictureInPictureParams()
    }

    override fun onResume() {
        super.onResume()
        activityResumed = true
        // The user is back: stop nudging and let the page report the real state.
        cancelPipNudges()
        pipNudges = 0
        lastNudgeAt = 0L
        // Resumed means the user is actually interacting with the app: page
        // pause suppression is released and page reports become authoritative.
        applyBackgroundPlaybackState(
            backgroundPlayback.onActivityResumed(true)
        )
        updatePictureInPictureParams()
        // Defensive: re-assert the PiP presentation from the truth we know. On
        // some OEM builds onPictureInPictureModeChanged(false) is not delivered
        // when PiP closes, and a stale "in PiP" presentation would leave the page
        // carrying PiP-only styling.
        webView.evaluateJavascript(
            "window._advoidSetPipPresentation && window._advoidSetPipPresentation($pipActive);",
            null,
        )
        webView.evaluateJavascript(
            "window._advoidSyncVideoState && window._advoidSyncVideoState();",
            null,
        )
    }

    override fun onPause() {
        activityResumed = false
        // PiP and backgrounding both pause the activity while the page keeps
        // running; from here on YouTube's own pauses must not stop the audio.
        applyBackgroundPlaybackState(
            backgroundPlayback.onActivityResumed(false)
        )
        super.onPause()
    }

    override fun onStop() {
        applyPlaybackUiState(
            playbackUiCoordinator.onActivityVisibilityChanged(false)
        )
        applyBackgroundPlaybackState(
            backgroundPlayback.onActivityStarted(false)
        )
        super.onStop()
    }

    /**
     * Leaving via Home/Recents while a video plays promotes playback into
     * Picture-in-Picture. That keeps the activity (and therefore the WebView
     * page) visible, which is the one background-audio path Android's hardening
     * rules explicitly exempt, and it keeps the video itself on screen.
     */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (leavingForInternalActivity) {
            // AdVoid itself is launching the system browser (privacy policy):
            // the user did not leave the app, so do not shrink it into PiP.
            leavingForInternalActivity = false
            return
        }
        if (!backgroundPlayback.shouldEnterPictureInPicture(pipSupported())) return
        // Enter PiP explicitly on every API level, and keep auto-enter armed as
        // well. Measured on a Xiaomi/HyperOS phone: auto-enter alone produced no
        // PiP window at all, so the backgrounded WebView was suspended and the
        // audio died. The explicit call is what MIUI honours; where the system
        // transition is used instead, our call either wins first or is ignored.
        schedulePipNudges()
        try {
            enterPictureInPictureMode(pipParams(autoEnter = true))
        } catch (e: IllegalStateException) {
            Log.w(TAG, "picture-in-picture entry failed: ${e.message}")
        }
        // If no PiP window appears, background audio cannot work in a WebView
        // (the platform suspends hidden media). Say so once instead of leaving
        // the user with a silent player and no explanation.
        webView.postDelayed(pipEntryCheckRunnable, PIP_ENTRY_CHECK_DELAY_MS)
    }

    private val pipEntryCheckRunnable = Runnable {
        if (pipActive || !backgroundPlayback.isBackgroundAudioEnabled()) return@Runnable
        Log.w(
            TAG,
            "picture-in-picture did not start; background audio cannot continue in a WebView",
        )
        val preferences = getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
        if (preferences.getBoolean(PREFERENCE_PIP_HINT_SHOWN, false)) return@Runnable
        preferences.edit().putBoolean(PREFERENCE_PIP_HINT_SHOWN, true).apply()
        Toast.makeText(
            this,
            "AdVoid could not show Picture-in-Picture, so background audio stops. " +
                "Allow \"Display pop-up windows while running in the background\" for AdVoid.",
            Toast.LENGTH_LONG,
        ).show()
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        Log.i(TAG, "picture-in-picture mode changed: inPip=$isInPictureInPictureMode")
        pipActive = isInPictureInPictureMode
        // The PiP window is only as big as the video: drop the native bar so the
        // player gets every pixel, and let the page hide its own chrome.
        appMenuBar?.visibility = if (isInPictureInPictureMode) View.GONE else View.VISIBLE
        webView.evaluateJavascript(
            "window._advoidSetPipPresentation && window._advoidSetPipPresentation($isInPictureInPictureMode);",
            null,
        )
        updatePictureInPictureParams()
        if (isInPictureInPictureMode) {
            // The platform may have paused the media while the WebView was
            // hidden for the transition; ask the page to resume it.
            pipNudges = 0
            lastNudgeAt = 0L
            nudgePlayback("PiP entered")
            schedulePipNudges()
        } else {
            cancelPipNudges()
            pipNudges = 0
        }
    }

    override fun onDestroy() {
        // Persist login cookies and release the WebView so it can't leak and
        // keep running after the activity is gone.
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        cancelPipNudges()
        if (screenReceiverRegistered) {
            unregisterReceiver(screenStateReceiver)
            screenReceiverRegistered = false
        }
        webView.removeCallbacks(stopServiceRunnable)
        serviceStopPending = false
        unregisterPipActions()
        PlaybackService.actionListener = null
        PlaybackService.seekListener = null
        // The WebView is the only thing that can produce the audio, and it is
        // about to be destroyed: never strand a media notification over silence.
        PlaybackService.stop(this)
        android.webkit.CookieManager.getInstance().flush()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (!::webView.isInitialized) return
        // Rotation auto-fullscreen is a user-facing affordance, and its
        // activation tap is a real injected touch. In Picture-in-Picture the
        // "landscape" is only the PiP window's aspect, and a paused activity
        // means the user is not interacting: running the flow there would both
        // shrink PiP and feed a phantom gesture to the background-audio bridge.
        if (pipActive || !activityResumed) return
        when (newConfig.orientation) {
            Configuration.ORIENTATION_LANDSCAPE -> {
                Log.d(TAG, "onConfigurationChanged landscape, customView=${customView != null}")
                // No videoPlaying gate here: the coordinator flag is fed by JS
                // events that can lag a fresh SPA navigation, so it is unreliable
                // at the instant of rotation. FULLSCREEN_PREP_SCRIPT re-checks the
                // page for a playing video itself and does nothing when there is
                // none, so letting it run unconditionally is safe and robust.
                if (customView == null) {
                    requestAutoFullscreen()
                }
            }
            Configuration.ORIENTATION_PORTRAIT -> {
                Log.d(TAG, "onConfigurationChanged portrait, customView=${customView != null}")
                if (customView != null) {
                    hideCustomView()
                }
            }
        }
    }

    private fun requestAutoFullscreen() {
        // FULLSCREEN_PREP_SCRIPT covers the viewport with a transparent overlay,
        // hands a visible point back through the bridge, and retries until the
        // landscape layout has settled so the synthetic activation tap always
        // lands on a live, neutral element.
        webView.evaluateJavascript(FULLSCREEN_PREP_SCRIPT, null)
    }

    private fun injectRotationTap(x: Int, y: Int) {
        val now = SystemClock.uptimeMillis()
        val down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x.toFloat(), y.toFloat(), 0)
        val up = MotionEvent.obtain(now, now + 40, MotionEvent.ACTION_UP, x.toFloat(), y.toFloat(), 0)
        webView.dispatchTouchEvent(down)
        webView.dispatchTouchEvent(up)
        down.recycle()
        up.recycle()
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    companion object {
        private const val TAG = "AdVoid"

        /** PiP / local broadcast action that toggles playback (see pipParams). */
        private const val ACTION_TOGGLE_PLAYBACK = "com.advoid.app.action.TOGGLE_PLAYBACK"
        private const val REQUEST_PIP_TOGGLE = 21
        private const val REQUEST_NOTIFICATIONS = 22

        /** Bounded playback nudges after a PiP transition (never a user pause). */
        private const val MAX_PIP_NUDGES = 10
        private const val PIP_NUDGE_FIRST_DELAY_MS = 250L
        private const val PIP_NUDGE_INTERVAL_MS = 1500L

        /** Grace period before a pause actually tears the service down. */
        private const val SERVICE_STOP_GRACE_MS = 2000L

        /** On-device only; see public/privacy.html ("AdVoid app preferences"). */
        private const val PREFERENCES_NAME = "advoid"
        private const val PREFERENCE_NOTIFICATION_ASKED = "notificationPermissionAsked"
        private const val PREFERENCE_PIP_HINT_SHOWN = "pipBlockedHintShown"

        /** How long to wait for a PiP window before telling the user it failed. */
        private const val PIP_ENTRY_CHECK_DELAY_MS = 1200L

        /**
         * Element to fullscreen for rotation auto-fullscreen. Must be the
         * `.player-container` wrapper — the same element YouTube's own expand
         * button fullscreens — because the mobile controls (seek bar) are mounted
         * there. Fullscreening the bare `.html5-video-player` pushes those
         * controls outside the fullscreen view (the wrapper collapses to zero
         * height in the top layer) and the seek bar becomes unreachable. The bare
         * player/video remain fallbacks for pages without the wrapper.
         */
        internal const val FULLSCREEN_TARGET_EXPRESSION =
            "video.closest('.player-container') || video.closest('.html5-video-player') || video"

        /**
         * Auto-fullscreen on landscape rotation. The page fullscreens the YouTube
         * player (not the bare <video>: a bare video keeps YouTube's in-page
         * `object-fit: cover` and gets cropped in the fullscreen view, whereas the
         * player letterboxes it to 16:9 exactly like YouTube's expand button).
         * That triggers the existing WebChromeClient#onShowCustomView path (custom
         * fullscreen view + immersive system bars). Shorts are excluded: the
         * native YouTube app never expands a 9:16 Short to fullscreen on rotation,
         * so neither do we.
         *
         * Prep step: requestFullscreen() needs transient user activation, which a
         * bare rotation never provides, so the page first covers the viewport with
         * a transparent overlay. The tap coordinate comes from the overlay, not
         * from the video: after rotation the player is frequently scrolled out of
         * view, and a tap computed from its off-screen rect would land outside the
         * window and activate nothing. The overlay guarantees the synthetic tap
         * always lands on a visible, neutral element; it is removed again by
         * AUTO_FULLSCREEN_SCRIPT. The tap is deferred until the renderer reports a
         * landscape viewport — a tap injected while the WebView is mid-relayout is
         * silently dropped, so fullscreen only engages on a settled layout.
         *
         * Target element: the mobile controls (seek bar) are mounted in
         * `.player-container`, a wrapper around `.html5-video-player`. YouTube's
         * own expand button fullscreens that wrapper, and so do we — fullscreening
         * the bare player would push the controls out of the fullscreen view (the
         * wrapper collapses to zero height in the top layer), leaving the user
         * unable to scrub the seek bar. Fullscreening the wrapper keeps both the
         * 16:9 letterboxing and the controls.
         */
        private const val FULLSCREEN_PREP_SCRIPT = """
            (function() {
                var stale = document.getElementById('advoid-fs-target');
                if (location.pathname.indexOf('/shorts') === 0) { if (stale) stale.remove(); return; }
                if (document.fullscreenElement) { if (stale) stale.remove(); return; }
                var video = Array.prototype.find.call(
                    document.querySelectorAll('video'),
                    function(v) { return !v.paused && !v.ended; }
                );
                if (!video) { if (stale) stale.remove(); return; }

                function attemptTap(retries) {
                    if (document.fullscreenElement) return;
                    var overlay = document.getElementById('advoid-fs-target');
                    if (!overlay) {
                        overlay = document.createElement('div');
                        overlay.id = 'advoid-fs-target';
                        overlay.style.cssText =
                            'position:fixed;left:0;top:0;width:100vw;height:100vh;' +
                            'z-index:2147483647;background:transparent;';
                        document.documentElement.appendChild(overlay);
                    }
                    // Half the shorter edge fits inside the window in any
                    // orientation, so the tap point is never off-screen.
                    var m = Math.round(Math.min(window.innerWidth, window.innerHeight) / 2);
                    AdVoidBridge.onRotationAutoFullscreen(m, m);
                    // A tap injected mid-relayout can be dropped by the renderer;
                    // retry a few times so fullscreen reliably engages once the
                    // landscape layout has settled.
                    if (retries > 0) {
                        setTimeout(function() { attemptTap(retries - 1); }, 300);
                    }
                }

                if (window.innerWidth > window.innerHeight) { attemptTap(3); return; }
                // Relayout is still in flight: poll until the viewport settles in
                // landscape (or give up after ~2s), then tap.
                var waited = 0;
                var timer = setInterval(function() {
                    waited += 100;
                    if (window.innerWidth > window.innerHeight || waited >= 2000) {
                        clearInterval(timer);
                        attemptTap(3);
                    }
                }, 100);
            })();
        """

        private const val AUTO_FULLSCREEN_SCRIPT = """
            (function() {
                var overlay = document.getElementById('advoid-fs-target');
                if (location.pathname.indexOf('/shorts') === 0) {
                    if (overlay) overlay.remove();
                    return;
                }
                if (document.fullscreenElement) {
                    if (overlay) overlay.remove();
                    return;
                }
                var video = Array.prototype.find.call(
                    document.querySelectorAll('video'),
                    function(v) { return !v.paused && !v.ended; }
                );
                if (!video) {
                    if (overlay) overlay.remove();
                    return;
                }
                // Fullscreen the wrapper YouTube's expand button uses so the
                // letterboxed player AND the mobile controls (seek bar) are both
                // inside the fullscreen view; fall back to the bare player/video
                // if the wrapper is absent.
                var target = $FULLSCREEN_TARGET_EXPRESSION;
                try {
                    var p = target.requestFullscreen();
                    if (p && p.catch) p.catch(function(e) {
                        AdVoidBridge.onRotationError('requestFullscreen rejected: ' + (e && e.message));
                    });
                } catch (e) {
                    AdVoidBridge.onRotationError('requestFullscreen failed: ' + e.message);
                } finally {
                    if (overlay) overlay.remove();
                }
            })();
        """

        /**
         * YouTube mounts its playback-settings bottom sheet under <ytm-app>,
         * outside `.player-container`. Android fullscreen only renders the
         * fullscreen element and its descendants, so the gear receives the tap
         * but the resulting sheet is invisible. Temporarily move YouTube's
         * singleton bottom-sheet host into the fullscreen player, then restore
         * it to the exact original DOM position when fullscreen ends.
         */
        internal const val FULLSCREEN_SETTINGS_SCRIPT = """
            (function() {
                function restoreSheet() {
                    var sheet = window._advoidFullscreenSettingsSheet;
                    var marker = window._advoidFullscreenSettingsMarker;
                    if (sheet && marker && marker.parentNode) {
                        marker.parentNode.insertBefore(sheet, marker.nextSibling);
                        marker.remove();
                    }
                    window._advoidFullscreenSettingsSheet = null;
                    window._advoidFullscreenSettingsMarker = null;
                }

                function mountSheet() {
                    var fullscreen = document.fullscreenElement;
                    if (!fullscreen) { restoreSheet(); return false; }
                    var sheet = document.querySelector('bottom-sheet-container');
                    if (!sheet || fullscreen.contains(sheet)) return !!sheet;

                    restoreSheet();
                    var marker = document.createComment('advoid-settings-sheet');
                    sheet.parentNode.insertBefore(marker, sheet);
                    window._advoidFullscreenSettingsSheet = sheet;
                    window._advoidFullscreenSettingsMarker = marker;
                    fullscreen.appendChild(sheet);
                    return true;
                }

                function mountSheetWhenReady(retries) {
                    if (!document.fullscreenElement) return;
                    var sheet = document.querySelector('bottom-sheet-container');
                    // YouTube may populate the sheet asynchronously. Moving an
                    // empty host too early disconnects it from the delegated
                    // <ytm-app> update path and leaves a blank menu.
                    if (sheet && sheet.childElementCount > 0) {
                        mountSheet();
                    } else if (retries > 0) {
                        setTimeout(function() {
                            mountSheetWhenReady(retries - 1);
                        }, 16);
                    }
                }

                function reportFailure(error) {
                    if (window.AdVoidBridge && AdVoidBridge.onRotationError) {
                        AdVoidBridge.onRotationError(
                            'fullscreen settings failed: ' + (error && error.message)
                        );
                    }
                }

                function replayClickInPage(clicked, fullscreen, isGear) {
                    document.exitFullscreen().then(function() {
                        // fullscreenchange normally restores first; do it here
                        // too so the replay always bubbles through <ytm-app>.
                        restoreSheet();
                        if (isGear) {
                            clicked = document.querySelector('button.player-settings-icon') || clicked;
                        }
                        window._advoidReplayingSettingsClick = true;
                        try { clicked.click(); }
                        finally { window._advoidReplayingSettingsClick = false; }

                        // The trusted outer click keeps transient activation for
                        // this microtask, allowing us to return to fullscreen.
                        var request = fullscreen.requestFullscreen();
                        if (request && request.then) {
                            request.then(function() {
                                mountSheetWhenReady(30);
                            }).catch(reportFailure);
                        } else {
                            mountSheetWhenReady(30);
                        }
                    }).catch(reportFailure);
                }

                window._advoidMountFullscreenSettings = mountSheet;
                if (window._advoidFullscreenSettingsSetup) return;
                window._advoidFullscreenSettingsSetup = true;

                document.addEventListener('click', function(event) {
                    if (window._advoidReplayingSettingsClick) return;
                    var gear = event.target && event.target.closest
                        ? event.target.closest('button.player-settings-icon')
                        : null;
                    var fullscreen = document.fullscreenElement;
                    var sheet = window._advoidFullscreenSettingsSheet;
                    var sheetClick = !!(
                        fullscreen && sheet && fullscreen.contains(sheet) &&
                        sheet.contains(event.target)
                    );
                    if (!fullscreen || (!gear && !sheetClick)) return;

                    // YouTube's settings handlers are delegated under <ytm-app>
                    // and do nothing while their sheet is in the fullscreen
                    // player. Briefly leave fullscreen, replay the click through
                    // YouTube's expected tree, then immediately return and mount
                    // the populated sheet in the visible fullscreen top layer.
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    replayClickInPage(gear || event.target, fullscreen, !!gear);
                }, true);
                document.addEventListener('fullscreenchange', function() {
                    if (!document.fullscreenElement) restoreSheet();
                });
            })();
        """

        /** Loading/player lifecycle script; the round logo data URI is injected at runtime. */
        private const val VIDEO_WATCH_SCRIPT_TEMPLATE = """
            (function() {
                if (window._advoidVideoSetup) {
                    if (window._advoidSyncVideoState) window._advoidSyncVideoState();
                    return;
                }
                window._advoidVideoSetup = true;

                var lastReportedPlaying = null;

                // Throttling for the media-state mirror that feeds the native
                // playback service (notification, lock screen, PiP action).
                var lastMediaStateJson = null;
                var lastMediaStateAt = 0;
                // Set only when the page lets a real pause through (a tap or a
                // transport control), so native can end the session even while
                // the activity is paused.
                var userPauseHint = false;

                // Loading overlay. YouTube shows the grey centre play button both
                // for an explicit pause and while a video is still loading; only
                // real loading should be replaced by the AdVoid logo + spinner.
                // readyState (not the paused flag) tells the two apart, so a
                // paused video with a frame on screen keeps its normal button.
                var HAVE_CURRENT_DATA = 2;

                function isOnWatchPage() {
                    return location.pathname.indexOf('/watch') === 0;
                }

                function playerOf(video) {
                    return video.closest ? video.closest('.html5-video-player') : null;
                }

                function createOverlay(player) {
                    // Build with DOM APIs, not innerHTML: m.youtube.com enforces a
                    // Trusted Types policy, so an innerHTML assignment throws
                    // ("This document requires 'TrustedHTML' assignment") before
                    // the .advoid-loading class is ever added, leaving the grey
                    // play button visible during loading.
                    var el = document.createElement('div');
                    el.id = 'advoid-loading-overlay';
                    var mark = document.createElement('div');
                    mark.className = 'advoid-loading-mark';
                    var img = document.createElement('img');
                    img.src = '__ADVOID_LOGO_DATA_URI__';
                    img.alt = 'AdVoid';
                    img.draggable = false;
                    var spinner = document.createElement('div');
                    spinner.className = 'advoid-spinner';
                    spinner.setAttribute('aria-hidden', 'true');
                    // Keep the round emblem and its orbit perfectly concentric;
                    // the previous independent spinner could appear detached.
                    mark.appendChild(img);
                    mark.appendChild(spinner);
                    el.appendChild(mark);
                    player.appendChild(el);
                    return el;
                }

                function setPlayerLoading(player, loading) {
                    if (!player) return;
                    // YouTube reuses player nodes across SPA routes. Never leave
                    // a loading class from /watch attached after navigation to
                    // Shorts, the feed, or another non-watch surface.
                    if (!isOnWatchPage()) {
                        player.classList.remove('advoid-loading');
                        return;
                    }
                    if (loading) {
                        if (!player.querySelector('#advoid-loading-overlay')) {
                            createOverlay(player);
                        }
                        player.classList.add('advoid-loading');
                        monitorVisibleLoading(player);
                    } else {
                        player.classList.remove('advoid-loading');
                        if (player._advoidLoadingTimer) {
                            clearTimeout(player._advoidLoadingTimer);
                            player._advoidLoadingTimer = null;
                        }
                    }
                }

                function videosForPlayer(player) {
                    return player ? Array.prototype.slice.call(player.querySelectorAll('video')) : [];
                }

                function shouldShowLoading(player) {
                    if (!player || !isOnWatchPage()) return false;

                    var videos = videosForPlayer(player);
                    var activeVideos = videos.filter(function(video) {
                        return !video.paused && !video.ended;
                    });
                    var currentVideo = activeVideos[activeVideos.length - 1] ||
                        videos[videos.length - 1];
                    if (currentVideo && currentVideo.seeking) return false;

                    // YouTube's own player state is the source of truth. A late
                    // `waiting`/`loadstart` from a video element that was just
                    // replaced must not cover a new video that is already
                    // playing. During a real stall YouTube keeps playing-mode
                    // but also adds buffering-mode, so buffering wins here.
                    if (player.classList.contains('buffering-mode')) return true;
                    if (player.classList.contains('playing-mode')) return false;

                    if (activeVideos.length > 0) return false;

                    // Cold start fallback before YouTube has assigned its mode
                    // classes: show only when no playable frame exists yet.
                    return videos.some(function(video) {
                        return video.readyState < HAVE_CURRENT_DATA && !video.seeking;
                    });
                }

                function refreshPlayerLoading(player) {
                    setPlayerLoading(player, shouldShowLoading(player));
                }

                function monitorVisibleLoading(player) {
                    if (!player || player._advoidLoadingTimer) return;
                    player._advoidLoadingTimer = setTimeout(function checkPlayerMode() {
                        player._advoidLoadingTimer = null;
                        if (!player.isConnected ||
                                !player.classList.contains('advoid-loading')) {
                            return;
                        }
                        if (!shouldShowLoading(player)) {
                            setPlayerLoading(player, false);
                            return;
                        }
                        monitorVisibleLoading(player);
                    }, 50);
                }

                function refreshVideoLoading(video) {
                    var player = playerOf(video);
                    refreshPlayerLoading(player);
                }

                function refreshAfterPlayerStateSettles(video) {
                    refreshVideoLoading(video);
                    // YouTube may assign buffering-mode just after dispatching
                    // the media event. Reconcile once more on the next task.
                    setTimeout(function() { refreshVideoLoading(video); }, 0);
                }

                function isAnyVideoPlaying() {
                    return Array.prototype.some.call(
                        document.querySelectorAll('video'),
                        function(video) {
                            return !video.paused && !video.ended;
                        }
                    );
                }

                // The main watch player's video. Feed previews and Shorts live
                // outside .html5-video-player, so they can never be mirrored
                // into the native playback session.
                function currentWatchVideo() {
                    var videos = document.querySelectorAll('.html5-video-player video');
                    var fallback = null;
                    for (var i = 0; i < videos.length; i++) {
                        if (!videos[i].paused) return videos[i];
                        if (!fallback) fallback = videos[i];
                    }
                    return fallback;
                }

                function playerVideoData() {
                    // Only the player API knows the title/author; the <video>
                    // element does not expose them. Guarded because YouTube can
                    // replace the player mid-navigation.
                    try {
                        var players = document.querySelectorAll('.html5-video-player');
                        var player = players && players.length ? players[0] : null;
                        if (player && typeof player.getVideoData === 'function') {
                            return player.getVideoData() || null;
                        }
                    } catch (e) { /* player is being replaced */ }
                    return null;
                }

                // The main watch player is the only element that may drive the
                // native session: Shorts, feed previews and channel trailers all
                // live inside their own players, and none of them should start
                // background audio or PiP.
                function isMainPlayerPlaying() {
                    if (!isOnWatchPage()) return false;
                    var video = currentWatchVideo();
                    return !!(video && !video.paused && !video.ended);
                }

                function currentMediaState() {
                    var video = currentWatchVideo();
                    var data = playerVideoData();
                    var duration = video && Number.isFinite(video.duration) ? video.duration : 0;
                    var position = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
                    // While the screen is locked the video element is suspended
                    // and the audio shadow is the audible source, so it owns the
                    // position — even when it has starved, or the notification
                    // would jump back to where the video froze. It also owns the
                    // playing flag, or the native session would report a paused
                    // player over playing audio and stop the foreground service
                    // that keeps the audio unmuted.
                    var shadowAudible = typeof window._advoidShadowAudible === 'function' &&
                        window._advoidShadowAudible();
                    var shadowPlaying = typeof window._advoidShadowPlaying === 'function' &&
                        window._advoidShadowPlaying();
                    if (shadowAudible) {
                        var shadowPositionMs = typeof window._advoidShadowPositionMs === 'function'
                            ? window._advoidShadowPositionMs()
                            : null;
                        if (shadowPositionMs !== null) {
                            position = shadowPositionMs / 1000;
                        }
                    }
                    return {
                        playing: shadowPlaying || isMainPlayerPlaying(),
                        ended: shadowAudible ? false : !!(video && video.ended),
                        userPaused: userPauseHint,
                        title: (data && data.title) || document.title || 'AdVoid',
                        artist: (data && data.author) || 'YouTube',
                        positionMs: Math.round(position * 1000),
                        durationMs: Math.round(duration * 1000)
                    };
                }

                // Mirrors playback into native code, which owns the foreground
                // service, the notification and the Picture-in-Picture action.
                // Background audio depends on this staying fresh, but 1 Hz
                // position churn is pointless: property changes are sent
                // immediately from the media events, position is sampled.
                function reportMediaState(force) {
                    var now = Date.now();
                    if (!force && now - lastMediaStateAt < 3000) return;
                    lastMediaStateAt = now;
                    var json = JSON.stringify(currentMediaState());
                    // A forced report (media event, resume-time sync) must always
                    // reach native: the state may be identical while native's
                    // session state is not.
                    if (!force && json === lastMediaStateJson) return;
                    lastMediaStateJson = json;
                    userPauseHint = false;
                    try {
                        if (window.AdVoidBridge &&
                                typeof AdVoidBridge.onMediaStateChanged === 'function') {
                            AdVoidBridge.onMediaStateChanged(json);
                        }
                    } catch (e) { /* bridge unavailable during teardown */ }
                }

                // Called by BACKGROUND_AUDIO_SCRIPT when it lets a pause through.
                window._advoidNotifyUserPause = function() {
                    userPauseHint = true;
                    reportMediaState(true);
                };

                function reportPlaybackState(force) {
                    var playing = isAnyVideoPlaying();
                    if (!force && playing === lastReportedPlaying) return;
                    lastReportedPlaying = playing;
                    if (window.AdVoidBridge) {
                        AdVoidBridge.onPlaybackStateChanged(playing);
                    }
                }

                function reportPlaybackEvent() {
                    reportPlaybackState(false);
                    // Media events are the authoritative, immediate signal for
                    // the native playback session (pause must stop the service
                    // at once, play must start it while still in the foreground).
                    reportMediaState(true);
                }

                function setupVideoListeners() {
                    var videos = document.querySelectorAll('video');
                    videos.forEach(function(video) {
                        if (video._advoidListeners) return;
                        video._advoidListeners = true;
                        video.addEventListener('play', reportPlaybackEvent);
                        video.addEventListener('playing', reportPlaybackEvent);
                        video.addEventListener('pause', reportPlaybackEvent);
                        video.addEventListener('ended', reportPlaybackEvent);
                        video.addEventListener('emptied', reportPlaybackEvent);

                        // Media events that signal an in-flight load replace the
                        // grey play button with the AdVoid loading overlay.
                        video.addEventListener('emptied', function() {
                            refreshAfterPlayerStateSettles(video);
                        });
                        video.addEventListener('loadstart', function() {
                            refreshAfterPlayerStateSettles(video);
                        });
                        video.addEventListener('waiting', function() {
                            // A stalled seek keeps the current frame on screen;
                            // only genuine buffering gets the overlay.
                            refreshAfterPlayerStateSettles(video);
                        });
                        video.addEventListener('loadeddata', function() {
                            refreshAfterPlayerStateSettles(video);
                        });
                        video.addEventListener('canplay', function() {
                            refreshAfterPlayerStateSettles(video);
                        });
                        video.addEventListener('playing', function() {
                            refreshAfterPlayerStateSettles(video);
                        });
                        video.addEventListener('seeking', function() {
                            setPlayerLoading(playerOf(video), false);
                        });
                        video._advoidLastMediaTime = Number(video.currentTime);
                        video.addEventListener('timeupdate', function() {
                            var previousTime = video._advoidLastMediaTime;
                            var currentTime = Number(video.currentTime);
                            video._advoidLastMediaTime = currentTime;
                            if (!video.paused && Number.isFinite(previousTime) &&
                                    Number.isFinite(currentTime) && currentTime > previousTime) {
                                refreshVideoLoading(video);
                            }
                        });

                        // Fresh element (new video or SPA navigation): not ready
                        // yet means it is loading, so show the overlay now.
                        refreshVideoLoading(video);
                    });
                }

                function refreshAllLoading() {
                    if (!isOnWatchPage()) {
                        document.querySelectorAll('.html5-video-player.advoid-loading')
                            .forEach(function(player) {
                                player.classList.remove('advoid-loading');
                            });
                        return;
                    }
                    // Only the main player video drives the overlay; feed preview
                    // thumbnails (readyState 0) live outside .html5-video-player
                    // and must never trigger it.
                    var players = [];
                    document.querySelectorAll('.html5-video-player video').forEach(function(video) {
                        var player = playerOf(video);
                        if (player && players.indexOf(player) < 0) players.push(player);
                    });
                    players.forEach(function(player) {
                        refreshPlayerLoading(player);
                    });
                }

                /**
                 * Repairs the "invisible player" state: YouTube caches an inline
                 * `top: -<height>` on the <video> element when it believes the
                 * video should not be shown, which leaves the player black,
                 * off-screen and untappable until a full page reload (the
                 * reported "player is not playing, forcing play does nothing").
                 * Only the exact signature is repaired, and never in the
                 * mini-player (a scrolled page legitimately hides the video).
                 */
                function repairHiddenVideo() {
                    if (!isOnWatchPage() || window.scrollY > 0) return;
                    var video = currentWatchVideo();
                    if (!video) return;
                    var player = playerOf(video);
                    if (!player) return;
                    var videoRect = video.getBoundingClientRect();
                    var playerRect = player.getBoundingClientRect();
                    if (playerRect.height <= 0 || videoRect.height <= 0) return;
                    if (videoRect.bottom > playerRect.top + 1) return;
                    video.style.top = '0px';
                    if (parseFloat(video.style.left || '0') < 0) {
                        video.style.left = '0px';
                    }
                    console.warn('[AdVoid] repaired a hidden video offset');
                }

                window._advoidSyncVideoState = function() {
                    setupVideoListeners();
                    refreshAllLoading();
                    repairHiddenVideo();
                    reportPlaybackState(true);
                    reportMediaState(true);
                };

                window._advoidSyncVideoState();
                var observer = new MutationObserver(function() {
                    setupVideoListeners();
                    refreshAllLoading();
                    reportPlaybackState(false);
                    reportMediaState(false);
                });
                observer.observe(document.documentElement, { childList: true, subtree: true });

                // Safety net: reconcile the overlay with the real video state on
                // a short interval. A media event can be missed when YouTube
                // swaps the <video> element mid-load, which would otherwise leave
                // the spinner running over a playing video.
                setInterval(refreshAllLoading, 1000);
                // Self-heal the invisible-player state even if the native side
                // never gets a chance to re-sync (see repairHiddenVideo).
                setInterval(repairHiddenVideo, 1000);
                // Sampled progress for the notification/lock screen; property
                // changes still arrive immediately through reportMediaState(true).
                setInterval(reportMediaState, 1000);
            })();
        """

        /**
         * Background audio bridge.
         *
         * Measured cause (see docs/decisions.md): YouTube's mobile player calls
         * `jmr.stopVideo()` -> `HTMLMediaElement.load()` from its
         * `visibilitychange` handler, which unloads the media and resets the
         * position to 0 the moment the page becomes hidden. While a playback
         * session is armed this script (a) reports the document as visible and
         * (b) swallows the lifecycle events on window capture, before any page
         * listener can see them.
         *
         * The spoof is gated on `window._advoidBgAudioArmed`, which native code
         * sets from BackgroundPlaybackCoordinator, so in-app behaviour is
         * unchanged whenever there is no playback session.
         *
         * It also keeps a bounded keep-alive for platforms that pause the media
         * element itself, and exposes `_advoidMediaAction` for the notification,
         * lock screen and PiP controls. Shorts and feed previews are never
         * touched: only `.html5-video-player` videos are eligible.
         */
        internal const val BACKGROUND_AUDIO_SCRIPT = """
            (function() {
                if (window._advoidBgAudioSetup) {
                    // Re-injected after an SPA navigation: keep the same session.
                    if (window._advoidSetBackgroundAudio) {
                        window._advoidSetBackgroundAudio(window._advoidBgAudioArmed === true);
                    }
                    return;
                }
                window._advoidBgAudioSetup = true;
                window._advoidBgAudioArmed = false;

                // Visibility spoof. The real accessors are kept and used whenever
                // no playback session is armed, so nothing in the app sees a
                // permanently-visible document.
                var proto = Document.prototype;
                var realHiddenGetter = null;
                function spoof(name, spoofed) {
                    var descriptor = Object.getOwnPropertyDescriptor(proto, name);
                    if (!descriptor || typeof descriptor.get !== 'function') return;
                    if (name === 'hidden') realHiddenGetter = descriptor.get;
                    Object.defineProperty(proto, name, {
                        configurable: true,
                        enumerable: descriptor.enumerable,
                        get: function() {
                            return window._advoidBgAudioArmed
                                ? spoofed
                                : descriptor.get.call(this);
                        }
                    });
                }
                spoof('hidden', false);
                spoof('visibilityState', 'visible');
                spoof('webkitHidden', false);
                spoof('webkitVisibilityState', 'visible');

                function reallyHidden() {
                    try {
                        return realHiddenGetter
                            ? realHiddenGetter.call(document) === true
                            : false;
                    } catch (e) {
                        return false;
                    }
                }

                // Window-capture runs before any listener the page can register,
                // and stopImmediatePropagation prevents every downstream one.
                // Only a genuine background transition is swallowed: an in-app
                // navigation must keep YouTube's own unload/pagehide cleanup.
                // Detecting the transition here also arms pause suppression
                // immediately, in the same task as the event: waiting for the
                // native round trip would let YouTube's first pauseVideo() slip
                // through as if it were a user pause.
                function swallowWhileHidden(event) {
                    if (!window._advoidBgAudioArmed || !reallyHidden()) return;
                    window._advoidSuppressPagePause = true;
                    event.stopImmediatePropagation();
                }

                ['pagehide', 'freeze'].forEach(function(type) {
                    window.addEventListener(type, swallowWhileHidden, true);
                });

                ['visibilitychange', 'webkitvisibilitychange'].forEach(function(type) {
                    window.addEventListener(type, function(event) {
                        if (!window._advoidBgAudioArmed) return;
                        if (reallyHidden()) {
                            swallowWhileHidden(event);
                            return;
                        }
                        // Back on screen: in PiP (and after a background hop) the
                        // document is visible again even though the activity may
                        // still be paused. The transition can have paused the
                        // media while the WebView was hidden — and Chromium's
                        // hidden-page throttling can starve the keep-alive — so
                        // resume here and re-arm the retry budget.
                        ensurePlaying();
                        armKeepAlive();
                    }, true);
                });

                function mainPlayerVideo() {
                    var videos = document.querySelectorAll('.html5-video-player video');
                    var fallback = null;
                    for (var i = 0; i < videos.length; i++) {
                        if (!videos[i].paused) return videos[i];
                        if (!fallback) fallback = videos[i];
                    }
                    return fallback;
                }

                // Bounded keep-alive: some platforms pause the media element
                // itself when the WebView is hidden. Retry a bounded number of
                // times, then give up rather than fight the platform forever or
                // restart playback from the beginning (readyState 0 means
                // YouTube unloaded it). Every real visibility transition and
                // every PiP entry re-arms the budget.
                var keepAliveTimer = null;
                var keepAliveLeft = 0;
                var KEEP_ALIVE_ATTEMPTS = 20;
                function resume(video) {
                    // A rejected play() is this feature's failure mode, so it is
                    // never swallowed: it shows up in logcat for QA.
                    return video.play().catch(function(error) {
                        console.warn('[AdVoid] background play() rejected: ' + error);
                    });
                }
                function clearKeepAlive() {
                    if (keepAliveTimer) {
                        clearTimeout(keepAliveTimer);
                        keepAliveTimer = null;
                    }
                }
                function armKeepAlive() {
                    keepAliveLeft = KEEP_ALIVE_ATTEMPTS;
                    clearKeepAlive();
                    tickKeepAlive();
                }
                function tickKeepAlive() {
                    if (!window._advoidBgAudioArmed || keepAliveLeft <= 0) return;
                    // With the screen off Chromium suspends the video element
                    // natively (measured: a plain <audio> element in the same
                    // page keeps playing, the <video> does not) and re-pauses it
                    // on every play() we attempt. Retrying there achieved nothing
                    // but 21 pause events in 17 s and a lock-screen card that
                    // flapped between playing and paused. Wait for the screen.
                    if (window._advoidScreenInteractive === false) return;
                    keepAliveLeft--;
                    keepAliveTimer = setTimeout(function() {
                        keepAliveTimer = null;
                        if (!window._advoidBgAudioArmed) return;
                        // ensurePlaying also repairs YouTube's own player state,
                        // which a bare play() on the element would not.
                        ensurePlaying();
                        tickKeepAlive();
                    }, 1000);
                }

                window._advoidSetBackgroundAudio = function(armed) {
                    armed = armed === true;
                    if (window._advoidBgAudioArmed === armed) return;
                    window._advoidBgAudioArmed = armed;
                    clearKeepAlive();
                    if (armed) {
                        armKeepAlive();
                    } else {
                        // Toggling background audio off must also stop the shadow
                        // renderer: it exists only to keep audio alive off-screen.
                        teardownShadow();
                    }
                };

                // Screen state, pushed by the native side (ACTION_SCREEN_ON/OFF).
                // Locked screens suspend the <video> element natively, so the retry
                // loop stands down; what keeps the audio alive instead is the
                // shadow renderer below.
                window._advoidScreenInteractive = true;
                window._advoidSetScreenInteractive = function(on) {
                    var interactive = on !== false;
                    if (window._advoidScreenInteractive === interactive) return;
                    window._advoidScreenInteractive = interactive;
                    if (interactive) {
                        setShadowAudible(false);
                        if (window._advoidBgAudioArmed) {
                            ensurePlaying();
                            armKeepAlive();
                        }
                    } else {
                        clearKeepAlive();
                        setShadowAudible(true);
                    }
                };

                // ---- Locked-screen audio shadow ------------------------------
                // Measured: with the screen off Chromium suspends the <video>
                // element natively (paused, position frozen, no JS pause involved)
                // but keeps playing media that has NO video track. YouTube's MSE
                // runs on the main thread with a separate audio SourceBuffer, so
                // every audio segment it appends is copied into a shadow element
                // that only ever receives that audio SourceBuffer. While the app
                // is visible the shadow stays muted (the video's own audio is what
                // the user hears) and simply follows the position; when the screen
                // locks the shadow is unmuted and the video silenced, so the audio
                // plays on through the lock. Verified on the emulator: video
                // paused=true at 74.1 s while the shadow advanced to 89.4 s with
                // the screen asleep and the platform reporting state:started
                // mutedState:none.
                var shadowElement = null;
                var shadowMediaSource = null;
                var shadowSourceBuffer = null;
                var shadowMirroring = null;
                var shadowQueue = [];
                var shadowSources = 0;
                var shadowBuildTimes = [];
                var shadowDisabled = false;
                /** Rebuild churn guard: more than this many within the window is a bug. */
                var SHADOW_CHURN_WINDOW_MS = 60000;
                var SHADOW_MAX_REBUILDS_PER_WINDOW = 10;
                var shadowUrlOf = new WeakMap();
                var shadowVideoMutedBeforeLock = null;

                function shadowVideo() {
                    // The shadow only ever mirrors the main player's stream.
                    return isMainPlayerVideo(mainPlayerVideo()) ? mainPlayerVideo() : null;
                }

                function shadowFlush() {
                    if (!shadowSourceBuffer || !shadowMediaSource ||
                        shadowMediaSource.readyState !== 'open' ||
                        shadowSourceBuffer.updating) return;
                    var op = shadowQueue.shift();
                    if (!op) return;
                    try {
                        if (op.type === 'append') {
                            shadowSourceBuffer.appendBuffer(op.data);
                        } else {
                            shadowSourceBuffer.remove(op.start, op.end);
                        }
                    } catch (error) {
                        console.warn('[AdVoid] shadow ' + op.type + ' failed: ' + error);
                    }
                }

                function buildShadow(mime) {
                    shadowSources++;
                    // YouTube re-creates its MediaSource on quality switches, ads,
                    // post-seek reloads and every unlock (the shadow is rebuilt
                    // when its source changed), so a fixed lifetime cap would
                    // disable the feature after enough ordinary use. Guard against
                    // churn instead: too many rebuilds in a short window.
                    var now = Date.now();
                    shadowBuildTimes.push(now);
                    shadowBuildTimes = shadowBuildTimes.filter(function(at) {
                        return now - at < SHADOW_CHURN_WINDOW_MS;
                    });
                    if (shadowBuildTimes.length > SHADOW_MAX_REBUILDS_PER_WINDOW) {
                        shadowDisabled = true;
                        console.warn(
                            '[AdVoid] shadow audio disabled: ' + shadowBuildTimes.length +
                                ' rebuilds within ' + (SHADOW_CHURN_WINDOW_MS / 1000) + 's'
                        );
                        return;
                    }
                    if (shadowElement && shadowElement.parentNode) {
                        shadowElement.parentNode.removeChild(shadowElement);
                    }
                    shadowElement = document.createElement('video');
                    shadowElement.id = 'advoid-shadow-audio';
                    shadowElement.playsInline = true;
                    shadowElement.muted = true;
                    shadowElement.volume = 1;
                    shadowElement.style.cssText =
                        'position:fixed;left:0;bottom:0;width:2px;height:2px;' +
                        'opacity:0.01;pointer-events:none;z-index:-1;';
                    shadowElement.addEventListener('error', function() {
                        var code = shadowElement && shadowElement.error ? shadowElement.error.code : '?';
                        console.warn('[AdVoid] shadow element error: ' + code);
                        shadowDisabled = true;
                    });
                    // Starvation is expected once the pre-buffered audio runs out
                    // (nothing new arrives while the screen is off); say so rather
                    // than leaving a silent player marked as playing.
                    ['waiting', 'stalled'].forEach(function(type) {
                        shadowElement.addEventListener(type, function() {
                            if (!shadowElement || shadowElement.muted) return;
                            console.warn(
                                '[AdVoid] shadow audio starved: buffered audio is used up, ' +
                                    'playback resumes on unlock'
                            );
                        });
                    });
                    document.documentElement.appendChild(shadowElement);

                    shadowMediaSource = new MediaSource();
                    shadowMediaSource.addEventListener('sourceopen', function() {
                        try {
                            // The captured original: the shadow must not mirror
                            // itself through the patched prototype.
                            shadowSourceBuffer = shadowNativeAddSourceBuffer
                                .call(shadowMediaSource, mime);
                            shadowSourceBuffer.addEventListener('updateend', shadowFlush);
                            shadowFlush();
                        } catch (error) {
                            console.warn('[AdVoid] shadow addSourceBuffer failed: ' + error);
                            shadowDisabled = true;
                        }
                    });
                    shadowElement.src = shadowNativeCreateObjectURL.call(URL, shadowMediaSource);
                    // A rebuild that happens while the screen is still off (an ad
                    // or a quality switch mid-lock) must come back audible, or the
                    // audio goes silent until the user unlocks.
                    if (window._advoidScreenInteractive === false && window._advoidBgAudioArmed) {
                        shadowElement.__advoidAudible = false;
                        setShadowAudible(true);
                    }
                }

                var shadowNativeAddSourceBuffer = null;
                var shadowNativeAppendBuffer = null;
                var shadowNativeRemove = null;
                var shadowNativeCreateObjectURL = null;
                var shadowHooksInstalled = false;

                function installShadowHooks() {
                    if (shadowHooksInstalled) return;
                    if (!window.MediaSource || !window.SourceBuffer) return;
                    shadowHooksInstalled = true;
                    shadowNativeAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
                    shadowNativeAppendBuffer = SourceBuffer.prototype.appendBuffer;
                    shadowNativeRemove = SourceBuffer.prototype.remove;
                    shadowNativeCreateObjectURL = URL.createObjectURL;

                    URL.createObjectURL = function(value) {
                        var url = shadowNativeCreateObjectURL.apply(URL, arguments);
                        if (window.MediaSource && value instanceof MediaSource) {
                            shadowUrlOf.set(value, url);
                        }
                        return url;
                    };

                    MediaSource.prototype.addSourceBuffer = function(requested) {
                        var mime = String(requested);
                        var buffer = shadowNativeAddSourceBuffer.apply(this, arguments);
                        var owner = this;
                        if (mime.indexOf('audio/') !== 0) return buffer;

                        buffer.appendBuffer = function(data) {
                            var video = shadowVideo();
                            // Only the MediaSource the playing video is attached
                            // to: YouTube also builds throwaway ones to probe
                            // codec support.
                            var live = !!(video && video.src &&
                                video.src === shadowUrlOf.get(owner));
                            if (live && window._advoidBgAudioArmed && !shadowDisabled) {
                                if (shadowMirroring !== this) {
                                    shadowMirroring = this;
                                    shadowQueue = [];
                                    buildShadow(mime);
                                }
                                if (shadowQueue.length < 400) {
                                    try {
                                        shadowQueue.push({ type: 'append', data: data.slice(0) });
                                        shadowFlush();
                                    } catch (error) {
                                        console.warn('[AdVoid] shadow copy failed: ' + error);
                                    }
                                }
                            }
                            return shadowNativeAppendBuffer.apply(this, arguments);
                        };

                        buffer.remove = function(start, end) {
                            if (shadowMirroring === this && shadowQueue.length < 400) {
                                shadowQueue.push({ type: 'remove', start: start, end: end });
                                shadowFlush();
                            }
                            return shadowNativeRemove.apply(this, arguments);
                        };

                        return buffer;
                    };
                }

                function shadowPosition() {
                    // Both elements run the same timeline: the shadow is started
                    // at the video's position minus half a second and stays close,
                    // so a lock switches sources without an audible jump.
                    if (!shadowElement || !shadowElement.buffered || !shadowElement.buffered.length) {
                        return null;
                    }
                    return shadowElement.currentTime;
                }

                function setShadowAudible(on) {
                    if (!shadowElement || shadowDisabled) return;
                    if (on === shadowElement.__advoidAudible) return;
                    shadowElement.__advoidAudible = on;
                    var video = mainPlayerVideo();
                    if (on) {
                        if (video) {
                            shadowVideoMutedBeforeLock = video.muted;
                            video.muted = true;
                            // Keep one continuous timeline: the platform freezes
                            // the video, and the audio carries on from the same
                            // position (a small correction here, if any).
                            if (Math.abs(shadowElement.currentTime - video.currentTime) > 0.5) {
                                seekShadowTo(video.currentTime);
                            }
                        }
                        shadowElement.volume = 1;
                        shadowElement.muted = false;
                        resume(shadowElement);
                        console.log('[AdVoid] locked screen: playing the audio shadow');
                    } else {
                        shadowElement.muted = true;
                        // The video was frozen while the shadow kept playing, so
                        // take the video to where the audio actually is — the
                        // alternative is a backwards jump at unlock.
                        var position = shadowPosition();
                        if (video && position !== null &&
                            Math.abs(video.currentTime - position) > 0.5) {
                            try {
                                video.currentTime = position;
                            } catch (error) {
                                console.warn('[AdVoid] shadow sync seek failed: ' + error);
                            }
                            var player = playerApi();
                            if (player && typeof player.seekTo === 'function') {
                                try {
                                    player.seekTo(position, true);
                                } catch (error) {
                                    console.warn('[AdVoid] shadow sync player seek failed: ' + error);
                                }
                            }
                        }
                        if (video && shadowVideoMutedBeforeLock !== null) {
                            video.muted = shadowVideoMutedBeforeLock;
                        }
                        shadowVideoMutedBeforeLock = null;
                    }
                }

                function seekShadowTo(seconds) {
                    if (!shadowElement || !shadowElement.buffered || !shadowElement.buffered.length) {
                        return;
                    }
                    var start = shadowElement.buffered.start(0);
                    var end = shadowElement.buffered.end(shadowElement.buffered.length - 1);
                    if (seconds < start || seconds > end) return;
                    try {
                        shadowElement.currentTime = seconds;
                    } catch (error) {
                        console.warn('[AdVoid] shadow seek failed: ' + error);
                    }
                }

                /** True while the shadow (not the video) is the audible source. */
                window._advoidShadowAudible = function() {
                    return !!(shadowElement && !shadowElement.muted && !shadowDisabled);
                };

                /** QA/telemetry view of the renderer, also used by the probe script. */
                window._advoidShadowState = function() {
                    return {
                        sources: shadowSources,
                        disabled: shadowDisabled,
                        present: !!shadowElement,
                        audible: window._advoidShadowAudible(),
                        playing: window._advoidShadowPlaying(),
                        readyState: shadowElement ? shadowElement.readyState : null,
                        currentTime: shadowElement
                            ? Number(shadowElement.currentTime.toFixed(2))
                            : null
                    };
                };

                window._advoidShadowPlaying = function() {
                    if (!shadowElement || shadowElement.muted || shadowElement.paused) return false;
                    // An ended element is a play-queue boundary (readyState stays 4
                    // when ended): report it as stopped instead of claiming to
                    // play over silence.
                    if (shadowElement.ended) return false;
                    // Measured: while the screen is off YouTube fetches nothing (its
                    // player sits in BUFFERING and the platform has suspended the
                    // video element), and the page's timers are throttled or
                    // frozen, so the shadow can only play out the audio that was
                    // already buffered. A starved element (readyState 2) is NOT
                    // playing: reporting it as playing kept the session and the
                    // notification alive over silence.
                    return shadowElement.readyState >= 3;
                };

                function teardownShadow() {
                    if (shadowElement && shadowElement.parentNode) {
                        shadowElement.parentNode.removeChild(shadowElement);
                    }
                    shadowElement = null;
                    shadowMediaSource = null;
                    shadowSourceBuffer = null;
                    shadowMirroring = null;
                    shadowQueue = [];
                }

                window._advoidShadowPositionMs = function() {
                    var position = shadowPosition();
                    return position === null ? null : Math.round(position * 1000);
                };

                installShadowHooks();

                // Keep the shadow warm and in step while the screen is on: muted
                // playback costs little and means the lock switch is seamless.
                setInterval(function() {
                    if (!window._advoidBgAudioArmed || shadowDisabled) return;
                    if (!shadowElement || shadowElement.__advoidAudible) return;
                    var video = mainPlayerVideo();
                    if (!video || video.paused || !shadowElement.paused) return;
                    shadowElement.currentTime = Math.max(0, video.currentTime - 0.5);
                    resume(shadowElement);
                }, 5000);

                // Page-level pause suppression. Measured in Picture-in-Picture:
                // YouTube's player calls pauseVideo() about four times a second
                // while the activity is paused (its own state machine, not a
                // visibility/resize event), so the video never plays in the PiP
                // window even though the media pipeline is perfectly healthy.
                // While the app is not interactively resumed, script pauses of
                // the main watch player are ignored.
                //
                // A genuine tap must still pause: the gesture allowance below
                // covers YouTube's own controls, and _advoidMediaAction sets the
                // explicit flag for notification/lock-screen/PiP buttons. Only
                // trusted input counts: YouTube synthesises its own click/mouse
                // events around its player state changes, and treating those as
                // user intent ended the session on every PiP transition.
                var lastUserGestureAt = 0;
                ['pointerdown', 'touchstart', 'mousedown', 'click', 'keydown']
                    .forEach(function(type) {
                        window.addEventListener(type, function(event) {
                            if (!event || event.isTrusted !== true) return;
                            lastUserGestureAt = Date.now();
                        }, true);
                    });

                function isMainPlayerVideo(element) {
                    if (!element || element.tagName !== 'VIDEO') return false;
                    if (location.pathname.indexOf('/watch') !== 0) return false;
                    return !!(element.closest && element.closest('.html5-video-player'));
                }

                // YouTube's player keeps its own playback state, and a pause it
                // issued before suppression was armed leaves both the element
                // and the player stopped. Resuming means doing both: play the
                // element and, when the player's state disagrees, call its API
                // so YouTube does not immediately pause it again.
                function playerApi() {
                    var players = document.querySelectorAll('.html5-video-player');
                    for (var i = 0; i < players.length; i++) {
                        if (typeof players[i].playVideo === 'function') return players[i];
                    }
                    return null;
                }

                function playerState() {
                    var player = playerApi();
                    if (!player || typeof player.getPlayerState !== 'function') return null;
                    try {
                        return player.getPlayerState();
                    } catch (e) {
                        return null;
                    }
                }

                function ensurePlaying() {
                    var video = mainPlayerVideo();
                    if (!video || video.ended) return;
                    if (video.paused && video.readyState > 0) {
                        resume(video);
                    }
                    var state = playerState();
                    // 1 = PLAYING. A stale paused/idle state would let YouTube
                    // pause the resumed element straight back.
                    if (state !== null && state !== 1) {
                        var player = playerApi();
                        try {
                            player.playVideo();
                        } catch (e) {
                            console.warn('[AdVoid] player.playVideo() failed: ' + e);
                        }
                    }
                }

                function syncPlayerState() {
                    // Leaving suppression with the element still playing: make
                    // YouTube's own state agree so its next pause is meaningful.
                    var video = mainPlayerVideo();
                    if (!video || video.paused || video.ended) return;
                    var state = playerState();
                    if (state !== null && state !== 1) {
                        var player = playerApi();
                        try {
                            player.playVideo();
                        } catch (e) {
                            console.warn('[AdVoid] player.playVideo() failed: ' + e);
                        }
                    }
                }

                var nativePause = HTMLMediaElement.prototype.pause;
                HTMLMediaElement.prototype.pause = function() {
                    // Only a real gesture or an explicit transport action counts
                    // as user intent. A pause that merely slipped through before
                    // native armed suppression must NOT end the session: it is
                    // the platform/YouTube pause this feature compensates for.
                    var userInitiated = window._advoidAllowPause === true ||
                        Date.now() - lastUserGestureAt <= 3000;
                    if (window._advoidBgAudioArmed && window._advoidSuppressPagePause &&
                            !userInitiated &&
                            isMainPlayerVideo(this)) {
                        return;
                    }
                    var result = nativePause.apply(this, arguments);
                    if (userInitiated && isMainPlayerVideo(this) &&
                            window._advoidNotifyUserPause) {
                        window._advoidNotifyUserPause();
                    }
                    return result;
                };

                window._advoidSetPagePauseSuppression = function(on) {
                    var wasOn = window._advoidSuppressPagePause === true;
                    window._advoidSuppressPagePause = on === true;
                    if (window._advoidSuppressPagePause && !wasOn) {
                        // The pause that put us here already landed.
                        ensurePlaying();
                        armKeepAlive();
                    } else if (!window._advoidSuppressPagePause && wasOn) {
                        syncPlayerState();
                    }
                };

                // Native nudge after a PiP transition (see nudgePlayback).
                window._advoidEnsurePlaying = ensurePlaying;

                window._advoidMediaAction = function(action, positionMs) {
                    var video = mainPlayerVideo();
                    var shadow = document.getElementById('advoid-shadow-audio');
                    if (!video) return;
                    if (action === 'play') {
                        resume(video);
                        // Locked screen: the video element is suspended by the
                        // platform, so the audible player is the shadow.
                        if (shadow && window._advoidScreenInteractive === false) {
                            resume(shadow);
                        }
                    } else if (action === 'seek') {
                        // Lock screen / media card scrubber.
                        var seconds = Number(positionMs) / 1000;
                        if (!Number.isFinite(seconds) || seconds < 0) return;
                        if (Number.isFinite(video.duration) && video.duration > 0) {
                            seconds = Math.min(seconds, video.duration);
                        }
                        try {
                            video.currentTime = seconds;
                        } catch (e) {
                            console.warn('[AdVoid] seek failed: ' + e);
                        }
                        // While locked the shadow is what the user hears, so it
                        // has to move too.
                        if (shadow && !shadow.muted) {
                            try {
                                shadow.currentTime = seconds;
                            } catch (e) {
                                console.warn('[AdVoid] shadow seek failed: ' + e);
                            }
                        }
                        // Keep YouTube's own player in step with the element.
                        var seekPlayer = playerApi();
                        if (seekPlayer && typeof seekPlayer.seekTo === 'function') {
                            try {
                                seekPlayer.seekTo(seconds, true);
                            } catch (e) {
                                console.warn('[AdVoid] player.seekTo failed: ' + e);
                            }
                        }
                    } else if (action === 'pause') {
                        // The user asked for this explicitly: it must win over
                        // the suppression above, and the page's player state has
                        // to follow the element (otherwise YouTube still thinks
                        // it is playing and pauses again at the next sync).
                        window._advoidAllowPause = true;
                        try {
                            video.pause();
                            // A pause from the lock screen must silence the
                            // shadow as well, or the audio would keep playing
                            // while the notification says paused.
                            if (shadow && !shadow.paused) {
                                try {
                                    shadow.pause();
                                } catch (e) {
                                    console.warn('[AdVoid] shadow pause failed: ' + e);
                                }
                            }
                            var player = playerApi();
                            if (player && typeof player.pauseVideo === 'function') {
                                try {
                                    player.pauseVideo();
                                } catch (e) {
                                    console.warn('[AdVoid] player.pauseVideo() failed: ' + e);
                                }
                            }
                        } finally {
                            window._advoidAllowPause = false;
                        }
                    }
                };
            })();
        """

        /**
         * Picture-in-Picture presentation.
         *
         * One CSS class toggle on `<html>` (the rules live in STYLE_SCRIPT) and
         * deliberately nothing inline. The previous version forced
         * `position: fixed; inset: 0; width/height: 100%` on YouTube's player
         * plus per-sibling inline `display: none`; YouTube reacted by caching an
         * inline `top: -<height>` on the `<video>` element, leaving the player
         * invisible, off-screen and untappable until a full page reload (the
         * "player is not playing / taps do nothing" bug). A class toggle cannot
         * leak that state: dropping the class restores the page exactly.
         */
        internal const val PIP_PRESENTATION_SCRIPT = """
            (function() {
                if (window._advoidPipSetup) return;
                window._advoidPipSetup = true;
                window._advoidSetPipPresentation = function(on) {
                    window._advoidPipActive = on === true;
                    document.documentElement.classList.toggle('advoid-pip', on === true);
                };
            })();
        """

        /**
         * YouTube's mobile Shorts player does not consistently expose a
         * draggable progress control in WebView. Add a narrow native range at
         * the bottom of the active Short: horizontal drags seek, while the rest
         * of the viewport remains available for the normal vertical reel swipe.
         */
        private const val SHORTS_SEEK_SCRIPT = """
            (function() {
                function isOnShortsPage() {
                    return location.pathname.indexOf('/shorts/') === 0;
                }

                function removeControl() {
                    var old = document.getElementById('advoid-shorts-seek');
                    if (old) old.remove();
                }

                function visibleArea(video) {
                    var r = video.getBoundingClientRect();
                    var width = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
                    var height = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
                    return width * height;
                }

                function activeVideo() {
                    var best = null;
                    var bestScore = -1;
                    document.querySelectorAll('video').forEach(function(video) {
                        if (video.ended || !Number.isFinite(video.duration) || video.duration <= 0) return;
                        var area = visibleArea(video);
                        if (area <= 0) return;
                        // Prefer the currently playing reel; visible area breaks
                        // ties while YouTube keeps neighbouring Shorts mounted.
                        var score = area + (video.paused ? 0 : 1000000000);
                        if (score > bestScore) { best = video; bestScore = score; }
                    });
                    return best;
                }

                function createControl() {
                    var control = document.createElement('input');
                    control.id = 'advoid-shorts-seek';
                    control.type = 'range';
                    control.min = '0';
                    control.step = '0.05';
                    control.setAttribute('aria-label', 'Seek Short');
                    control.addEventListener('input', function() {
                        var video = control._advoidVideo;
                        var next = Number(control.value);
                        if (!video || !Number.isFinite(next) || !Number.isFinite(video.duration)) return;
                        video.currentTime = Math.max(0, Math.min(video.duration, next));
                    });
                    // Keep YouTube's reel carousel from interpreting a horizontal
                    // seek as navigation. The listener is passive: the range
                    // retains its native drag behaviour.
                    ['touchstart', 'pointerdown'].forEach(function(type) {
                        control.addEventListener(type, function(event) {
                            control._advoidDragging = true;
                            event.stopPropagation();
                        }, { passive: true });
                    });
                    control.addEventListener('touchmove', function(event) {
                        event.stopPropagation();
                    }, { passive: true });
                    ['touchend', 'touchcancel', 'pointerup', 'pointercancel', 'change']
                        .forEach(function(type) {
                            control.addEventListener(type, function(event) {
                                control._advoidDragging = false;
                                event.stopPropagation();
                                sync();
                            }, { passive: true });
                        });
                    control.addEventListener('blur', function() {
                        control._advoidDragging = false;
                        sync();
                    });
                    (document.body || document.documentElement).appendChild(control);
                    return control;
                }

                function sync() {
                    if (!isOnShortsPage()) { removeControl(); return; }
                    var video = activeVideo();
                    if (!video) { removeControl(); return; }
                    var control = document.getElementById('advoid-shorts-seek') || createControl();
                    var videoChanged = control._advoidVideo !== video;
                    control._advoidVideo = video;
                    control.max = String(video.duration);
                    if (videoChanged || !control._advoidDragging) {
                        control.value = String(Math.max(0, Math.min(video.duration, video.currentTime || 0)));
                    }
                }

                window._advoidSyncShortsSeek = sync;
                if (!window._advoidShortsSeekSetup) {
                    window._advoidShortsSeekSetup = true;
                    ['loadedmetadata', 'durationchange', 'timeupdate', 'playing', 'emptied']
                        .forEach(function(type) {
                            document.addEventListener(type, sync, true);
                        });
                    document.addEventListener('yt-navigate-finish', sync, true);
                    window.addEventListener('popstate', sync);
                    new MutationObserver(sync).observe(document.documentElement, {
                        childList: true,
                        subtree: true
                    });
                }
                sync();
            })();
        """

        /**
         * Pull-to-refresh. Listens in the CAPTURE phase: YouTube's Shorts
         * carousel stops touch-event propagation, so bubble-phase listeners
         * never fire there. Eligible contexts:
         *   - feed pages at window scroll 0 (after a short rest, so scroll-up
         *     flings that land on top don't instantly reload), and
         *   - Shorts while on the reel's entry (first) short — swiping down
         *     mid-reel still goes to the previous short.
         * /watch is excluded so playback is never reloaded by a stray swipe.
         */
        private const val PULL_REFRESH_SCRIPT = """
            (function() {
                // Mutable state lives on window (not in the listener closures) and is
                // reset on every injectPageScripts() call — i.e. on every SPA
                // navigation — so a gesture interrupted mid-swipe by a navigation can
                // never wedge pulling/shown stuck for the next page.
                var P = window._advoidPull || (window._advoidPull = {});
                // A pushState/replaceState navigation mid-gesture can land here
                // while the indicator is still showing — tell native to hide it
                // before wiping the state, so it never gets stuck visible.
                if (P.shown && window.AdVoidBridge) AdVoidBridge.onRefreshRelease(false);
                P.startY = 0; P.startX = 0; P.pulling = false; P.shown = false;
                if (!('lastScrollTs' in P)) P.lastScrollTs = 0;
                function shortsId() {
                    var m = location.pathname.match(/^\/shorts\/([\w-]+)/);
                    return m ? m[1] : null;
                }
                window._advoidTrackNav = function() {
                    var id = shortsId();
                    if (!id) { window._advoidShortsEntry = null; }
                    else if (!window._advoidShortsEntry) { window._advoidShortsEntry = id; }
                    document.documentElement.classList.toggle('advoid-shorts', !!id);
                };
                window._advoidTrackNav();
                if (window._advoidRefreshSetup) return;
                window._advoidRefreshSetup = true;
                var SHOW = 70, TRIGGER = 150;
                window.addEventListener('scroll', function() {
                    P.lastScrollTs = Date.now();
                }, { passive: true, capture: true });
                function eligible() {
                    var id = shortsId();
                    if (id) return id === window._advoidShortsEntry;
                    if (location.pathname.indexOf('/watch') === 0) return false;
                    return window.scrollY <= 0 && Date.now() - P.lastScrollTs > 350;
                }
                function reset(refresh) {
                    P.pulling = false;
                    if (P.shown || refresh) {
                        P.shown = false;
                        AdVoidBridge.onRefreshRelease(!!refresh);
                    }
                }
                document.addEventListener('touchstart', function(e) {
                    window._advoidTrackNav();
                    if (e.touches.length === 1 && eligible()) {
                        P.startY = e.touches[0].clientY;
                        P.startX = e.touches[0].clientX;
                        P.pulling = true;
                        P.shown = false;
                    }
                }, { passive: true, capture: true });
                document.addEventListener('touchmove', function(e) {
                    if (!P.pulling) return;
                    var dy = e.touches[0].clientY - P.startY;
                    var dx = Math.abs(e.touches[0].clientX - P.startX);
                    if (dy < 0 || dx > Math.max(40, dy)) { reset(false); return; }
                    if (!shortsId() && window.scrollY > 0) { reset(false); return; }
                    if (dy > SHOW && !P.shown) {
                        P.shown = true;
                        AdVoidBridge.onRefreshPulled();
                    }
                }, { passive: true, capture: true });
                document.addEventListener('touchend', function(e) {
                    if (!P.pulling) return;
                    var dy = e.changedTouches[0].clientY - P.startY;
                    reset(dy > TRIGGER && eligible());
                }, { passive: true, capture: true });
                document.addEventListener('touchcancel', function() {
                    reset(false);
                }, { passive: true, capture: true });
            })();
        """

        /**
         * Live streams on m.youtube.com don't render a chat panel, so inject a
         * "Live chat" affordance and a bottom-sheet iframe pointing at YouTube's
         * public live_chat embed. Re-evaluated on every SPA navigation.
         */
        private const val LIVE_CHAT_SCRIPT = """
            (function() {
                var SETUP = !!window._advoidLiveChatSetup;

                // ytInitialPlayerResponse is only set on full page loads and goes
                // stale after SPA navigation. Track player-response fetches as
                // candidates, but accept live state only when the response id
                // matches the real movie_player. Cache the accepted id and flag
                // together so state from a previous video cannot leak forward.
                var shared = window._advoidLiveChatShared ||
                    (window._advoidLiveChatShared = {
                        live: false, videoId: null, routeKey: null, candidate: null
                    });

                function currentRouteKey() {
                    return location.pathname + location.search;
                }

                // Clear accepted state on a route change. A response for the next
                // video may arrive before pushState, so carry one candidate until
                // the new route/player identity can confirm or reject its id.
                if (shared.routeKey !== currentRouteKey()) {
                    if (shared.candidate && !shared.candidate.carried &&
                            shared.candidate.routeKey === shared.routeKey) {
                        // A cached response for the next video can finish just
                        // before pushState. Carry it across one route change;
                        // isLiveNow() still requires its id to match the new URL
                        // or the real player, so an old video cannot leak.
                        shared.candidate.carried = true;
                    } else {
                        shared.candidate = null;
                    }
                    shared.live = false;
                    shared.videoId = null;
                    shared.routeKey = currentRouteKey();
                }

                function currentPlayerData() {
                    try {
                        var player = document.getElementById('movie_player') ||
                            document.querySelector('.html5-video-player');
                        if (player && typeof player.getVideoData === 'function') {
                            return player.getVideoData() || null;
                        }
                    } catch (e) { /* player is still being replaced */ }
                    return null;
                }

                function currentVideoId() {
                    if (/^\/watch/.test(location.pathname)) {
                        return new URLSearchParams(location.search).get('v') || null;
                    }
                    // Channel live links keep their friendly /@channel/live URL
                    // instead of redirecting to /watch?v=... in the mobile app.
                    // The live player's API is fresher than page globals during
                    // SPA navigation and directly identifies what is on screen.
                    if (/\/live\/?$/.test(location.pathname)) {
                        var playerData = currentPlayerData();
                        if (playerData && playerData.video_id) {
                            return playerData.video_id;
                        }
                        if (shared.routeKey === currentRouteKey() && shared.videoId) {
                            return shared.videoId;
                        }
                        var pr = window.ytInitialPlayerResponse;
                        return pr && pr.videoDetails && pr.videoDetails.videoId || null;
                    }
                    return null;
                }

                function liveStateFromResponse(data) {
                    var root = data && (data.response || data);
                    var videoDetails = root && root.videoDetails;
                    var liveDetails = root && root.microformat &&
                        root.microformat.playerMicroformatRenderer &&
                        root.microformat.playerMicroformatRenderer.liveBroadcastDetails;
                    return {
                        videoDetails: videoDetails,
                        live: !!(videoDetails && videoDetails.isLive === true) ||
                            !!(liveDetails && liveDetails.isLiveNow === true)
                    };
                }

                function applyLive(data, responseRouteKey) {
                    var state = liveStateFromResponse(data);
                    var videoDetails = state.videoDetails;
                    var vid = videoDetails && (videoDetails.videoId || null);
                    var live = state.live;
                    var playerData = currentPlayerData();
                    var playerVideoId = playerData && playerData.video_id || null;
                    var routeVideoId = /^\/watch/.test(location.pathname) ?
                        new URLSearchParams(location.search).get('v') : null;
                    if (!vid || (responseRouteKey !== currentRouteKey() &&
                            vid !== playerVideoId && vid !== routeVideoId)) return;
                    shared.candidate = {
                        videoId: vid,
                        live: live,
                        routeKey: currentRouteKey(),
                        carried: responseRouteKey !== currentRouteKey()
                    };
                    if (vid !== playerVideoId) return;
                    if (shared.videoId === vid && shared.live === live) return;
                    shared.videoId = vid;
                    shared.live = live;
                    shared.routeKey = currentRouteKey();
                    if (window._advoidSyncLiveChat) window._advoidSyncLiveChat();
                }
                function trackResponse(data, responseRouteKey) {
                    try {
                        applyLive(data, responseRouteKey);
                    } catch (e) { /* ignore */ }
                }
                // Hook fetch ONCE to capture the player response (youtubei/v1/player)
                // which contains the CURRENT video's live status. fetch() returns a
                // Promise<Response>, so the body must be read from the RESOLVED
                // response — and the hook must never break the original fetch: an
                // uncaught throw inside window.fetch kills YouTube's player
                // bootstrap (the video never loads). The once-guard also stops SPA
                // re-injection from wrapping fetch recursively.
                if (!window._advoidLiveChatFetchHook) {
                    window._advoidLiveChatFetchHook = true;
                    var nativeFetch = window.fetch;
                    window.fetch = function() {
                        var res = nativeFetch.apply(this, arguments);
                        try {
                            var url = typeof arguments[0] === 'string' ? arguments[0] :
                                (arguments[0] && arguments[0].url) || '';
                            if (/youtubei\/v1\/player|get_video_info|player\?/.test(url)) {
                                var requestRouteKey = currentRouteKey();
                                res.then(function(response) {
                                    if (!response || typeof response.clone !== 'function') return;
                                    var textPromise = response.clone().text().then(function(text) {
                                        try {
                                            trackResponse(JSON.parse(text), requestRouteKey);
                                        } catch (e) { /* ignore */ }
                                    });
                                    // Ensure the promise is tracked so we don't lose it
                                    if (window._advoidFetchPromises === undefined) {
                                        window._advoidFetchPromises = [];
                                    }
                                    window._advoidFetchPromises.push(textPromise);
                                }).catch(function() { /* ignore */ });
                            }
                        } catch (e) { /* never break the original fetch */ }
                        return res;
                    };
                }

                function teardown() {
                    var btn = document.getElementById('advoid-live-chat-btn');
                    var panel = document.getElementById('advoid-live-chat-panel');
                    if (btn) btn.remove();
                    if (panel) panel.remove();
                }

                function isLiveNow() {
                    // Promote fetch-tracked state only after the real player id
                    // confirms that the candidate belongs to the video on screen.
                    var vid = currentVideoId();
                    var playerData = currentPlayerData();
                    if (shared.candidate && playerData &&
                            shared.candidate.videoId === playerData.video_id) {
                        shared.videoId = shared.candidate.videoId;
                        shared.live = shared.candidate.live;
                        shared.routeKey = currentRouteKey();
                    }
                    if (playerData && playerData.video_id === vid &&
                            typeof playerData.isLive === 'boolean') {
                        return playerData.isLive;
                    }
                    if (playerData && playerData.video_id && playerData.video_id !== vid) {
                        return false;
                    }
                    if (shared.videoId && shared.videoId === vid) return shared.live;
                    // Fall back to ytInitialPlayerResponse, but ONLY when it
                    // belongs to the current video: after SPA navigation the
                    // global still holds the PREVIOUS page's response, and a
                    // previous live video would otherwise keep the button shown
                    // on a now non-live (or different) video.
                    var pr = window.ytInitialPlayerResponse;
                    if (!pr || !pr.videoDetails) return false;
                    var prVid = pr.videoDetails.videoId;
                    if (vid && prVid && prVid !== vid) return false;
                    return liveStateFromResponse(pr).live;
                }

                function ensureChatUi(videoId) {
                    var btn = document.createElement('button');
                    btn.id = 'advoid-live-chat-btn';
                    btn.type = 'button';
                    btn.setAttribute('aria-label', 'Open live chat');
                    btn.textContent = 'Live chat';
                    btn._advoidVideoId = videoId;
                    document.body.appendChild(btn);
                    btn.addEventListener('click', function() { togglePanel(videoId); });

                    if (!SETUP) {
                        SETUP = window._advoidLiveChatSetup = true;
                    }
                    if (!document.getElementById('advoid-live-chat-style')) {
                        injectChatStyles();
                    }
                }

                function togglePanel(videoId) {
                    var existing = document.getElementById('advoid-live-chat-panel');
                    if (existing) { existing.remove(); return; }
                    var panel = document.createElement('div');
                    panel.id = 'advoid-live-chat-panel';

                    var header = document.createElement('div');
                    header.className = 'advoid-live-chat-header';
                    var title = document.createElement('span');
                    title.textContent = 'Live chat';
                    var close = document.createElement('button');
                    close.type = 'button';
                    close.textContent = '\u00D7';
                    close.setAttribute('aria-label', 'Close live chat');
                    close.addEventListener('click', function() { panel.remove(); });
                    header.appendChild(title);
                    header.appendChild(close);

                    var iframe = document.createElement('iframe');
                    iframe.src = 'https://www.youtube.com/live_chat?v=' +
                        encodeURIComponent(videoId) + '&embed_domain=m.youtube.com';
                    iframe.setAttribute('allow', 'autoplay');

                    panel.appendChild(header);
                    panel.appendChild(iframe);
                    document.body.appendChild(panel);
                }

                function injectChatStyles() {
                    var style = document.createElement('style');
                    style.id = 'advoid-live-chat-style';
                    style.textContent = [
                        '#advoid-live-chat-btn {',
                        '  position: fixed; right: 12px; bottom: 96px; z-index: 2147483000;',
                        '  padding: 10px 14px; border: 1px solid rgba(255,255,255,0.18);',
                        '  border-radius: 22px; background: rgba(22,22,25,0.94); color: #fff;',
                        '  font: 500 13px sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,0.4);',
                        '}',
                        '#advoid-live-chat-panel {',
                        '  position: fixed; left: 0; right: 0; bottom: 0; height: 55%;',
                        '  z-index: 2147483001; background: #121215;',
                        '  border-top: 1px solid rgba(255,255,255,0.12);',
                        '  display: flex; flex-direction: column;',
                        '}',
                        '.advoid-live-chat-header {',
                        '  display: flex; align-items: center; justify-content: space-between;',
                        '  padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.12);',
                        '  color: #fff; font: 600 15px sans-serif; flex: 0 0 auto;',
                        '}',
                        '.advoid-live-chat-header button {',
                        '  border: none; background: transparent; color: #ccc; font-size: 26px;',
                        '  line-height: 1; padding: 0 8px;',
                        '}',
                        '#advoid-live-chat-panel iframe {',
                        '  flex: 1; border: none; width: 100%; background: #fff;',
                        '}'
                    ].join(' ');
                    (document.head || document.documentElement).appendChild(style);
                }

                window._advoidSyncLiveChat = function() {
                    var isLivePage = location.pathname.indexOf('/watch') === 0 ||
                        /\/live\/?$/.test(location.pathname);
                    var videoId = currentVideoId();
                    if (!isLivePage || !videoId || !isLiveNow()) {
                        teardown();
                        return;
                    }
                    var existing = document.getElementById('advoid-live-chat-btn');
                    if (existing && existing._advoidVideoId === videoId) return;
                    teardown();
                    ensureChatUi(videoId);
                };

                window._advoidSyncLiveChat();
                if (!window._advoidLiveChatMonitor) {
                    window._advoidLiveChatMonitor = true;
                    document.addEventListener('yt-navigate-finish', function() {
                        setTimeout(window._advoidSyncLiveChat, 0);
                        setTimeout(window._advoidSyncLiveChat, 300);
                    }, true);
                    setInterval(window._advoidSyncLiveChat, 1000);
                }
            })();
        """

        /**
         * Injected CSS. Removes YouTube's "Open App" upsells everywhere
         * (topbar button, player overlay chips, mealbar banners — anything
         * that links out via an intent: URL), and hides the search UI only
         * while on Shorts via the html.advoid-shorts marker class that
         * PULL_REFRESH_SCRIPT keeps in sync with SPA navigation. Also styles
         * the loading overlay: while a watch video is actually loading (the
         * .html5-video-player carries the .advoid-loading class that
         * VIDEO_WATCH_SCRIPT toggles), a dark plate fades in over the whole
         * player — hiding the grey background and centre play button — with
         * a round AdVoid emblem and a perfectly concentric orbit spinner.
         */
        private const val STYLE_SCRIPT = """
            (function() {
                if (document.getElementById('advoid-style')) return;
                var style = document.createElement('style');
                style.id = 'advoid-style';
                style.textContent = [
                    'a[href^="intent:"],',
                    'ytm-mealbar-promo-renderer,',
                    '.mealbar-promo-renderer,',
                    'ytm-app-upsell-template-renderer {',
                    '  display: none !important;',
                    '}',
                    // Separate rule: an unsupported :has() would otherwise
                    // invalidate the whole comma list above on older WebView.
                    'ytm-button-renderer:has(> a[href^="intent:"]) {',
                    '  display: none !important;',
                    '}',
                    'html.advoid-shorts ytm-searchbox,',
                    'html.advoid-shorts button[aria-label="Search"] {',
                    '  display: none !important;',
                    '}',
                    // YouTube pins its feed filter row as a fixed overlay
                    // (`ytm-feed-filter-chip-bar-renderer#filter-chip-bar`,
                    // position: fixed, z-index 3), so it follows the scroll and
                    // covers feed content right under AdVoid's bar. Keep it in
                    // document flow: it still works, it just scrolls away with
                    // the feed. Two selectors plus the id, so a markup rename is
                    // inert instead of breaking anything.
                    'ytm-feed-filter-chip-bar-renderer,',
                    'ytm-feed-filter-chip-bar-renderer#filter-chip-bar {',
                    '  position: static !important;',
                    '  top: auto !important;',
                    '  z-index: auto !important;',
                    '}',
                    // PiP window presentation: hide the page chrome so the player
                    // fills the small window. A class toggle only — nothing is
                    // written inline, so leaving PiP restores the page exactly
                    // and YouTube's own layout is never lied to (forcing the
                    // player to a foreign size made YouTube cache a hidden-video
                    // offset and left the player dead until a reload).
                    'html.advoid-pip ytm-mobile-topbar-renderer,',
                    'html.advoid-pip ytm-pivot-bar-renderer {',
                    '  display: none !important;',
                    '}',
                    // Android's landscape mandatory-gesture inset is about 52
                    // CSS px on the Pixel emulator (137 physical px at 2.625
                    // DPR). Keep the whole 48px control below that interception
                    // zone while leaving the video edge to edge. Support both
                    // current and legacy fullscreen names.
                    ':fullscreen .player-controls-top,',
                    ':-webkit-full-screen .player-controls-top {',
                    '  top: max(56px, env(safe-area-inset-top)) !important;',
                    '}',
                    // A compact Shorts-only scrubber. Its hit area is deliberately
                    // limited to the bottom strip so vertical reel swipes continue
                    // to work everywhere else.
                    '#advoid-shorts-seek {',
                    '  position: fixed;',
                    '  left: 10%;',
                    '  bottom: max(14px, env(safe-area-inset-bottom));',
                    '  width: 80%;',
                    '  height: 28px;',
                    '  margin: 0;',
                    '  z-index: 2147483000;',
                    '  accent-color: #5FCA6B;',
                    '  opacity: 0.92;',
                    '  touch-action: none;',
                    '}',
                    '.html5-video-player.advoid-loading .ytp-large-play-button {',
                    '  display: none !important;',
                    '}',
                    // The overlay is a full-player dark plate: it stretches over
                    // the whole player area so nothing of the grey background or
                    // centre play button shows through while a video loads.
                    // pointer-events: none keeps taps flowing through to the
                    // player, and the fade-in eases the plate in on show.
                    '#advoid-loading-overlay {',
                    '  position: absolute;',
                    '  left: 0; top: 0;',
                    '  width: 100%; height: 100%;',
                    '  display: none;',
                    '  align-items: center;',
                    '  justify-content: center;',
                    '  background: radial-gradient(circle at center, rgba(7,20,47,0.88), rgba(0,0,0,0.94));',
                    '  z-index: 1000;',
                    '  pointer-events: none;',
                    '}',
                    '.html5-video-player.advoid-loading #advoid-loading-overlay {',
                    '  display: flex;',
                    '  animation: advoid-fade-in 0.25s ease;',
                    '}',
                    '@keyframes advoid-fade-in {',
                    '  from { opacity: 0; }',
                    '  to { opacity: 1; }',
                    '}',
                    '#advoid-loading-overlay .advoid-loading-mark {',
                    '  position: relative;',
                    '  width: 104px; height: 104px;',
                    '  display: grid;',
                    '  place-items: center;',
                    '  filter: drop-shadow(0 10px 28px rgba(0,0,0,0.55));',
                    '  animation: advoid-logo-enter 0.28s cubic-bezier(.2,.8,.2,1);',
                    '}',
                    '#advoid-loading-overlay .advoid-loading-mark > img {',
                    '  width: 88px; height: 88px;',
                    '  display: block;',
                    '  border-radius: 50%;',
                    '  box-shadow: 0 0 0 1px rgba(46,216,255,0.35), 0 6px 22px rgba(64,52,190,0.38);',
                    '}',
                    '#advoid-loading-overlay .advoid-spinner {',
                    '  position: absolute;',
                    '  inset: 0;',
                    '  box-sizing: border-box;',
                    '  border-radius: 50%;',
                    '  border: 3px solid rgba(255,255,255,0.14);',
                    '  border-top-color: #25D9FF;',
                    '  border-right-color: #F52A82;',
                    '  animation: advoid-spin 0.85s linear infinite;',
                    '}',
                    '@keyframes advoid-logo-enter {',
                    '  from { opacity: 0; transform: scale(0.9); }',
                    '  to { opacity: 1; transform: scale(1); }',
                    '}',
                    '@keyframes advoid-spin {',
                    '  to { transform: rotate(360deg); }',
                    '}'
                ].join(' ');
                (document.head || document.documentElement).appendChild(style);
            })();
        """
    }
}
