package com.advoid.app

import android.annotation.SuppressLint
import android.content.res.Configuration
import android.graphics.*
import android.os.Bundle
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import android.app.Activity

class MainActivity : Activity() {
    private lateinit var rootLayout: LinearLayout
    private lateinit var webView: WebView
    private lateinit var adBlocker: AdBlocker
    private val playbackUiCoordinator = PlaybackUiCoordinator()
    private lateinit var refreshIndicator: ProgressBar

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
                    adBlocker.injectScripts(view)
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

        setContentView(rootLayout)
    }

    private fun injectPageScripts(view: WebView?) {
        view?.evaluateJavascript(STYLE_SCRIPT, null)
        view?.evaluateJavascript(FULLSCREEN_SETTINGS_SCRIPT, null)
        view?.evaluateJavascript(videoWatchScript, null)
        view?.evaluateJavascript(SHORTS_SEEK_SCRIPT, null)
        view?.evaluateJavascript(PULL_REFRESH_SCRIPT, null)
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
    }

    override fun onResume() {
        super.onResume()
        webView.evaluateJavascript(
            "window._advoidSyncVideoState && window._advoidSyncVideoState();",
            null,
        )
    }

    override fun onStop() {
        applyPlaybackUiState(
            playbackUiCoordinator.onActivityVisibilityChanged(false)
        )
        super.onStop()
    }

    override fun onDestroy() {
        // Persist login cookies and release the WebView so it can't leak and
        // keep running after the activity is gone.
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        android.webkit.CookieManager.getInstance().flush()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (!::webView.isInitialized) return
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

                function setLoading(video, loading) {
                    var player = playerOf(video);
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
                    } else {
                        player.classList.remove('advoid-loading');
                    }
                }

                function isAnyVideoPlaying() {
                    return Array.prototype.some.call(
                        document.querySelectorAll('video'),
                        function(video) {
                            return !video.paused && !video.ended;
                        }
                    );
                }

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
                        video.addEventListener('emptied', function() { setLoading(video, true); });
                        video.addEventListener('loadstart', function() { setLoading(video, true); });
                        video.addEventListener('waiting', function() {
                            // A stalled seek keeps the current frame on screen;
                            // only genuine buffering gets the overlay.
                            setLoading(video, !video.seeking);
                        });
                        video.addEventListener('loadeddata', function() { setLoading(video, false); });
                        video.addEventListener('canplay', function() { setLoading(video, false); });
                        video.addEventListener('playing', function() { setLoading(video, false); });
                        video.addEventListener('seeking', function() { setLoading(video, false); });
                        video._advoidLastMediaTime = Number(video.currentTime);
                        video.addEventListener('timeupdate', function() {
                            var previousTime = video._advoidLastMediaTime;
                            var currentTime = Number(video.currentTime);
                            video._advoidLastMediaTime = currentTime;
                            if (!video.paused && Number.isFinite(previousTime) &&
                                    Number.isFinite(currentTime) && currentTime > previousTime) {
                                setLoading(video, false);
                            }
                        });

                        // Fresh element (new video or SPA navigation): not ready
                        // yet means it is loading, so show the overlay now.
                        setLoading(video, isOnWatchPage() &&
                            video.readyState < HAVE_CURRENT_DATA && !video.seeking);
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
                    document.querySelectorAll('.html5-video-player video').forEach(function(video) {
                        setLoading(video, video.readyState < HAVE_CURRENT_DATA && !video.seeking);
                    });
                }

                window._advoidSyncVideoState = function() {
                    setupVideoListeners();
                    refreshAllLoading();
                    reportPlaybackState(true);
                };

                window._advoidSyncVideoState();
                var observer = new MutationObserver(function() {
                    setupVideoListeners();
                    reportPlaybackState(false);
                });
                observer.observe(document.documentElement, { childList: true, subtree: true });
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
