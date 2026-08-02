package com.advoid.app

import android.annotation.SuppressLint
import android.content.res.Configuration
import android.graphics.*
import android.os.Bundle
import android.os.SystemClock
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
        view?.evaluateJavascript(VIDEO_WATCH_SCRIPT, null)
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

        private const val VIDEO_WATCH_SCRIPT = """
            (function() {
                if (window._advoidVideoSetup) {
                    if (window._advoidSyncVideoState) window._advoidSyncVideoState();
                    return;
                }
                window._advoidVideoSetup = true;

                var lastReportedPlaying = null;

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
                    });
                }

                window._advoidSyncVideoState = function() {
                    setupVideoListeners();
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
         * PULL_REFRESH_SCRIPT keeps in sync with SPA navigation.
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
                    '}'
                ].join(' ');
                (document.head || document.documentElement).appendChild(style);
            })();
        """
    }
}
