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

        /**
         * AdVoid logo embedded as a data URI so the loading overlay never
         * depends on local WebView files. Generated from
         * extension/icons/noirva-logo-v2-128.png.
         */
        private const val ADVOID_LOGO_DATA_URI = "data:image/png;base64," +
            "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAA" +
            "GgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAgKADAAQAAAABAAAAgAAAAABIjgR3AAA89UlEQVR4AZ19CbRlV1nmnd97NaWG" +
            "VCoJZCBkQCAJIuICB1AcQG1UtGnApS2upWu52rZZutp26cIBbe1uWNAgsEAhiAppoZGxBcIQQwQxhEAUQqUykaEqqUqqXr2qeuOd" +
            "+hv2v88+9973UnBy6py9///7v//f/x7OcO99afb2Xj0eN5vNBrZxo8HSGOfaNoZYgjEheSM0V1xqNgCkvfBN47MQYPMkvso6ESUt" +
            "I6EuquCRRcKz5mCTd+OslSYjTJLsyEmo4A6SEdIiaUIZ3iUWPEKya7QoUpEI5UIHxSRpMqQga5RdKZKoA9/KIzWVRTZQSE2BwJL6" +
            "QT5SP9kmkVjhFiJUEYJK0VbkDJ9N5kYtz8rxVJUabGNqa5vrIY0zuURstsRpDwlTQOE3mswQoIGB9Y6VjXJk1FomnNDqhKiW46MW" +
            "aFTCb8VDEnC0EjHjhgv1RYCTsavW4+gdyIgyBW1z2Chq2iZkDjLxQQ5NWLkg1+QUaRoJdqCQkjOYRYSk0MZCWKWyq3WtweUxM2Rh" +
            "HoFW2T/JUwnAbDQ5JrICIFo47EwtEmDoIlQqtyrKDJ4uyKomNhfkaVMJXi3B2M+TJWOSKixwroIuBgbDsiLUpI2xCVUmZAxqasZT" +
            "JWn2TkG2LVwD6R2yXLCeJA6hKglEsUUsbbExhCLOjKw1hLlCZJ2slc9N+MHordKz6SHNReNE7BECSLYFOlvMEDpNzrWOZM8GISkN" +
            "rdeaQyB9ZbUKlJBFKhVyOcmFmMDkqi1cxdBFs1I5qDY7Z78lALbMCfNebM2yA2qaAlQvVkFUJbaztC7L2dpwq3AsrAVRZDmbFM1g" +
            "mcxCxSlGW2Tm6QJYIczE2R2EGaxoVPUoFjP1MQhQeNyuoAt7Ei+mdVqzwo2UQLXs7ts8goCexB7MdIz45IC0BMQRBcsrsCSuwooJ" +
            "Fj6ZuRxHT5Ko8WxylqQraSmc2iq8/E7pSTiBqXIdLirJtL0kCCPtOaCwzRbyAvVZd4DDyoQmspvIWT32aKFNfHTzcjlHw4KHW6B5" +
            "jrJ4OUEcg4/Qo1BBEohM6MXH2QAoMCaxSS6XJFh+IM+qkrygKcWpDO1MK6g9RhtjdcBmIMdpH1tjoCVsClQKHE1CCkv+SKuRoVWL" +
            "K0KMn5IpNa88ZfPcLQ4bGHoRFEfyq2K85SWPy0QWDnHXvBlyax5rMxNp5SBL0gxI7KVPIYHzTqtkVNiqYRUgx+7C1LFmKW1uFgLI" +
            "wVlja5pkhewn3Qnn+BO/TpaYBEer7I5DD7NNEy6ZBC5bZXnFHAMlsLVzxmdppsoSFyDPYE3q8iKcBkpG1m0TZY254AreEJWe6kSB" +
            "VG6pMhThIDW6vmUfHK1BCCCKSbWJHIACntxWkqqUYHWaFEsy04kWdlnYbiKr7KZprTOHtTqiueU1wJ7CY8W3SSngVGfqjK0HTHGJ" +
            "NyxNOeXd2QXGMJhzF4vL0wzlBDLhtAvLJ46G4Sj6SukqjpnHI4AjA2BINQ9sOGFbsUzRliqUsxfKcQ1IRNlnICbMpqvTEUxLCtaI" +
            "fmIuq228xtWg9AZBKavILY1clGu6gyytzJOPBuTqhIuszY7zCCBSCxfCqCKpDLYqTXspIvSriEIwyVR4m0ZNSybMC+vislaYAcBa" +
            "SBI+OgnVzJAgOFmkI0elCkFA/9mkDGZCWFZti2MupKkZ9pTn+2MJ3euhnzxnqlJhcksK77VrQImPcmkXsvIMfabLWEhcziqbUB6i" +
            "GiCEhImRSNmoZpnqRvoSWlopDICNFzQdMpXrqNbtKhhKduqCYYlQlUoykyIx8ZT0EQ2qmTmjOMyardpLm2lQRrtgQIaB154syVWD" +
            "rZpgMAb40hCYWjVmQOkU5ew348uCObdwml2bNh8hz8zZvBRmLUzKckSdmVIhk6BVGV8JhYKcEj8HZIIJUJbnggFbwOgPfZrdZsup" +
            "giMAFdnqGadIDOQp5v4Wfq16XLclwNdwG5bMuZxVWeJGoBo8cZ5qXRYAPGGeSaRp5TfzCWfKkrgsZ96JQuWD6FSbMqwEGQ9RZYF8" +
            "owKdgS4Xg2jCafhJZ9iZ1taTYNWNSfS+/s/EzRLCKjPb0SwUZFsqrXcctPddUFWvGkOttsyXC6GpAsqSyrtGbo7YTG6DhQUbrwus" +
            "4tpnqY4zroSVG5Xq7KXSGrsr5bnsOQqAHW7OlC2I9F6JZpdEVkLLMkzsjL7R8PhAhlTAhZals9hkUcNRIulE+iCeaGRV1SdnVZWB" +
            "pUs1mMJF6KNe8zpVKVFhmUCpGn09ZUqBMROGWT7TZFIIY+xFA2qARI1VsOyAGmR2ZbOYstxOc1+WiciMEBqWrATKSGrx7iXXo0OT" +
            "efaU6aYKNrULlAsmQrPETD5mzER1gjvDJuSu2ramgsh7SCtM4soPYoHY2kegameTVtRTbTbazCU/ynmfMC9hparmOFeEnoCVDBkI" +
            "jGHWTmOyZIItM0wUDDMtbF2oYcwIhQqZ33FwCao2k6EOlPdKl0oQZxREQVvhKgeVrCpZO22VEbPMk8NJFep5l72v1mV4mTYXbIGq" +
            "Y9jsbs3aSY/1tpvTmEybCqWlA4KkvNOrDNwBAAlnMMshsZuyZnIjXc5sFmYTa10tj5TPulWF3I5KHqQ583sQzR4cBJGY/9K21TJv" +
            "GCwKfNjVSJyYzFhhtirVG0Bk3N8lK7eTFT8JO4q4b5mO6SwlE35RhaGPyXGc+EUXbTZxZRpZkySuUaMx5L0zqokjiJptXdPyg0M0" +
            "2j7CdXmu8ZeKTcKuQ761WhlsZVn7TFgtnIkrA81lF8pq5s0qSKYJs4m1qJawpMWCkjKJXA9SxhvtRmtvu3dRe+HJ7YWLmvMooyuW" +
            "xv0Hh6v3DFceHK4dH/f7Y/QRtmYnvexVuySaPEzHNomYFX8NYwq3oaZ4/IpaWr4L2pzFTbCvHHQu2JUx2a3JfJxGTsDKqsBIP4b5" +
            "SKnc3uxc1dl+be+c72zvurZzzhWdbed15hZw9RoJ6qe3xni1MXp0uHHPcP1rg+UvDxZv7y/dNzizNFpHCpvNVqfR2rx52X1RKGOG" +
            "Jao+FhAVvzXWyjrYmt09T89XB406YOytArMUBpV0WlLpVDLgcWGFFRwPsJSPR+1m69LWtuf09j6/t++7O7sv62zb0epqkR+NxuMh" +
            "IgStnXCe8KaVArzawqLa7PabrdONESbE7esnb9545F/WH7t3sLQ+7uPBs0vMWWwZBOrpDdrHlW+GqbPVOsCtCEBqVG7qbJeBPrtz" +
            "cCa0G8G2Iu8Y791m+6mdXT/SO/fHevuf2TkHK4yAI2ScywryDIuSg6Z8jmMf8NgeNlqjcWuIJzlcEZrdVrMzarROjEff6J+8af3I" +
            "TasP3rH+6PJovdlsoydEXtJJMPPgbOYjMI59JhhCIzfTJjkHPDrgarYibbl4dmGF2dmdzZmPMOLI7WNAN1uXt7f9eO/AS+YvfFb3" +
            "nO1Y6hujEZMOvf4xLrfJR9QooprnxqjZRKJHzdao0Uaz2A2stnEcQtJs84rQ7JwZjw5tLH529f7PrN53cOMoXHfQT8xDEJFs1hZu" +
            "p3RuzpT4rAS0bfb2XF0Hq0F10bdQmxGoQ2SuIoksYFAPx6Odrd4P9fb9/PxFL+jt29vCeEdvYGnXSC/ya1uM8Ryc6RA/hNiG6ING" +
            "Bx2AJxv0gfLedH8M0Q1NdIN7BdOi3Wp2T44Ht68fvWHlrn9cvvNY/1QLFwl0EjvUDSCpK3K9xWGiXUDmGLewqlRlB9jy7PyawdGW" +
            "ZUsqeW5SdtnsI8Xj8UXtbS+dv/AXFp54bWcXdCMOeQYf96cZ7xZKx0VGm0/woiswhv9wjBnQZq7VAbjsjiBptgdYjlrsgFEDAPQB" +
            "AQPMiRZy3kP58ODUjat3f3Tpq3etPww+rIHZMQqKHuLH3XJAmyCrhAhgSrNvsgQFUc1yyk0mAjwjK6HxQcXVhvfvV3V2/sr8xS+f" +
            "f8KFnXm0cYDk05xmMhBRZYqSGXm22NcCijUDhsgvEq01hynmqzxKNPApB4BdouVIMPQBheghTIhGq7M4XP/Cyt0fPHnr19fuRxTR" +
            "DeG3asEWpYgTRlXwgc9MgaJCl4BZ14CZFEE142x2eUUaiyFsbzxiYcFt5VWdHb++8KRXzF2I1QYDlDczyKLNmVwleDPvhhkNH+4M" +
            "jH1mFtdeFHC9xXKfVhsgUGY3KNcCYPhjRzAA6wrR4kV7wKWt1W71lsf9f1o+9P7Ffzq49kC70UbnRGNzIQS1s5tZE21aya1zAZ6L" +
            "GfC4bkAbGJ/h2lukscg+FFTjH56MLmhv+88Ll/7qwsX72r3RaKD7SLUvGsmMBjcpMzPKgRGAIEwknPDPawvHOO98mGuOfS36mFao" +
            "ssw+aA6o5UUC2VeXNEfMPvuDMPYKZom7YfCZ0//2/sUbH9o4iqmgsMrIGN2MjQHNEFeikiMjm+jnhQOhinMyAiqzouC9IqzylVFQ" +
            "olxsSDS65JULF//VzmtfPH9gvonbTWTAKa11gNjrH2XaIQkTKZaRqjPYAb7MMu/IIGAc9Rr4eOryGMfQ5jzgrRFhY1wPWpwl7Ikm" +
            "hbByH+BOCXLcDbcanacsXPJ9O5+J4A+tPcjOZqTORtG2soi4ck5LucsKv8bBYBOu3Vk4UJhYbGco50IByaQ5pOAqQAwHDVhotN+6" +
            "6+l/uOPKPa32Bi+zWBacRNyEo6kop/+4DORWlIQ5cAJS/smOm1QuPhy/7AmOfR4x5JFlZB/PBEiousQ9xKTj2uvrsJCeLjBHr7Qa" +
            "LdyqsiOx41rVa/WetePqJ8xd+JWVg/3RRgyNIrJcRGGrVORcqwEKvWoqZkBrxgwouHPR2XW1dGl5deTigM2rxNt2Xv3K7Zecao4X" +
            "W62TzfZis3Wi2X6s0Xys2VpstE6hqWg0hlyDQ9SxyVqxMuFOuSmlsRoXACaLGeSuEV0ccR3m3Q46BlpfdZV9CnUZSKlHrjVRyMBu" +
            "UEdy7VIBA+jSuSee2913y5l/1TwoX91XwbDEAPEPYU+GWsOFEqjUWHRAZ1ueAaGvGRUV6HNXF+KZRdxrvnLhot/bedWJZmOl1epz" +
            "TeDVr9/kvtFoLDdbJxuto43mkUbr0UZrY9xYaDT44MsoPNpTWWHxEEFzGnElUeqVOyUUVd2Mpo5RD6VFn8nltEAVSYehl6aBlh1U" +
            "q8nEOcqeG7U0FRrDS+cvPj1Y+cbaPXg7opYqHJWqwyxZpZ0oeXRZyBkwv9k1YMIuqnBWjFXlK1ShwKMUXt28dfczdnbnkHpgsBQg" +
            "nWgYxwjnO1LADUd0zJlm85Fm68FG63Szsa3R2C4PWpQiTJknN8gOU6lhnnLqzFKoXkmrPMc7M84js8/hz52Llca4Jg0TjfUq9QHv" +
            "a4VRN7Crxq3zuxd8/vQtG2khimTHOTIQ9TjnpNQK1BYIvq+NcVXDuQJkAU6AiUlQdUZVwq39s7u7r+zuGDTHzH9KNS6NvPHGO4F2" +
            "C/cbfCRVodVttXutFl7QHGq0Pt1o39JoreBmvLqj0kru0Hnng9sbpMx3k15VmFAs/byQMsX54syrAoezVnbffbKquaiHZ94SsFeM" +
            "CSR7iC5oi6l87ty+KxeuHODJnU2MZvqMMcQNQyzkqtcOAXEyWeM6bSknYwZPUUCAvQIEcgoYCpwT+pnd3fN674g6R5GGPoeXfpLQ" +
            "wZDjI1DeYYb3lO15XQnvaLQ+1mj/q64mbbcsvZ3A2yHnywMZt/nKFEZryruGNocw5Z4lejTj7abT6kmgCwO7kEL1hwCJR88WYqAW" +
            "oXafvHCZ01a01MWpBE0kp8weVf4oCqWEw8tbM0/YhaNsT1gIH+dMmwtb87rPoRF2iFJXo6RLELKPtmFZ5Ys39QokjA/3Ts3x6qjx" +
            "+fH43nHju5vjJ+hdKX1yhOqiytcMSj3xfAhgFXnn87BeQpCc3aBhrlRKhT6Fr5R3rUUKjd3AnoBvXrcdBu/iKOda1Nql9yXUTG9E" +
            "zVQENOdNKGKLOw5fWJwiacIqnZ0/V5KXUpS5gYBaCJ6bc1rl3QcY/RhaSDSvfUw6fx6OncsRXsng4xK+OOaihGiwQPWarflme3ur" +
            "g0v0h0aNm8aNAYRI+pi54GBnriNrSBx3zgnKW15PABNAU4TgWNyF1NjX16I48Pn9zMTG78PQhP3EnuCrIRBiEuBODRhvcUbNxS3W" +
            "n2RSnPhoxBRRNMYdYGKjFA5FKR1B4SAXaGSt4KlMqTZxaenQ5x6JmsNcqw+yAjfjxghXYXxeCDVSkz6TQ7vRK+gKvwxlKLw+jZqd" +
            "W0cbt66feWF34em9uRVImAj0BJZ7Zk3Z56jX4q4bIXQD+yl6xR1DE+7KOJrA+Re9Qk61iylGHGLmIGGEbBjGClrgnLn5bu8mR0BS" +
            "0yOdruLI/pXQfcbPj9IGdqMqB0gCRwnE1gRUZ8NIWROzwjQjEzimNgKkgQ+VyDCuOAy4CiVuzvwBk87/xIACJkTrtrVHPrxy8Ej/" +
            "1Bs6239u7sB/mb/8gt7OZbxO5W0isol8MenMPhvHVMbq5CWIcuyx7MAPRzQkGNruQnYDhwJv/9m1UsE7uzC1HnPU7yQUG9s43WpK" +
            "0zaRLlfLYwBx1gxQm+GvxsoOmWAq7KiqwUsd06I6jkgPWsj+0BZtTk9ewsETnacIo+Xonq8PTvz5yS+ujjc6rc5y/+SbNo5/bO3w" +
            "725/+ksWnoTn4AG6kS9zMK6VZa82Sve4rRWJw4fdwHSLVt4RB5PrhVC26WIOuXoUtJxSugaQfMjIMI15wr8tmq0mfmsHTDQb1LNv" +
            "V/BGp5ttWedCUWX7uOGIHbFz6cdKmsuSYFBBop2rP9YUzEcUkJtOC9eQxkfP3LnSGHRx46rp0mt2vjk88ytLX/ylxZsPDk7N47kN" +
            "M43TFGnCjTxXHi4+3pl6riHIIBPKpJNbUfJ+mOOdjRaGPj1LNIcwIdgA9sdwpM/sNJljFFGXtqIYIp9zNuriqRpimto2JZ1AAofd" +
            "nkp/aIyQkKknMMLhhq3nqqJGc/hRgmGOxZWF8Rg9wQsir4ksb4yG3+wvoRBctMeXG7rN5kfWH3jxiU+94dS/rY1GXbzjHCm/7oOW" +
            "XvjwnoeRRfcgy0o0Zxw6xkGzoDKeIdBz7Bv2ky7CKuNGiG8P/YkF1gOE7paloHAC7tvZwkyDAgQlLZees9hyjlHwXvKk+YTM+kog" +
            "na5iaCzXbK4OPGKojUacBLzTABENUcXKOBwP8D0GYNTKcIfquNFrtpeGa3986l9ecfyTn1890hnjc902Fgqu41o9YIM1BDOAb+U4" +
            "LZhcLibcUeXnB0w9yuSTVq1A2VcILUHI/gjvR8GsCeysOBKXZx4N2BpWafmEpBbmXlD6K8BMH8JQU+KCRxbKG+etHaiJbCsmv8aR" +
            "RjqH5ZgPr5winByYDXjlgmeTHpcjAOEouRgOhxsrqxsb+GoJ/QKMFemWjYd/8fg//NHSFx4drnXH+ONT7Fz3gbKv1UndzSqTrp2L" +
            "D3uFnYQjuwdeXE7XDI19dIA+sGP6OYHObqsDGX5qQmWeBWBmVrjF2SjLMs7C6lgoqmJ27HEMysyCtCMK3fhx1CPj7AeuQli8YyHy" +
            "csTnAHxMxD7QuCV/czAYXvTEJ/zSL/zMj77ge0fDUR/dwKnCqYBL5buWv/Lzj37go8uH+L4fl2V0AwY1rVlg0vkuCAUvPjBkxhEd" +
            "vnUBmACYGZwQiBi9gi/i4bUDhj/eQ2xwHeINcW5PlYaZJdIXCngqq9bkVMV3QwuDsgicjQuDUs/yJqrUn0o3mqYJATIysqXKPmJj" +
            "i3UpJkAJx4ldhD7gKAd/E2P/iRfs/+SH3n7lFZeC6P1//4k//NO3fOOOuzvzeIHEGdVrdB8YLP324sc/uXrXr+153uW9A/iWnNZ3" +
            "0GtEa2nieqfo4QoFvo1g+BgG7Ax1Fb51ygdgDfwxPhVAod8YdptdhaTGci5PZ1S8PkBf39T4QsRGRVXuo1KJs0TQjC7EBUeWTofF" +
            "ca+FntdVr0UoAOc5zxmg1uCIeaAq77f9ng659eAZbvR/+Aefw+zjattsvPRnX/S5G/7mt171y71OZ2O9z6jH+LtTeLJrfmrtzl85" +
            "9n/+6tS/rDVGnUYX3OoGjXd2PgpMuhciVyllQplXpB5aJR3ZH3pH33Sb+P4EcNMNzG3/VgpVPukbrf72NkdTkYklQuTXOqVSK51u" +
            "ttJZ9q0OkoGmc3GqyXlJ4LrEBUp0GJzjHTvwYQE3jCZ0w7n79rzuz3770x+77vnf/6yN1dUhVg3qsCJ1l4bLrz9xw2888t7b1h7s" +
            "4AUHe5bLETwzFl6TecMqJ/wUjHeuzD4XIgz/wXikfbgxHvVHw41hv9fogcRfEVMXKCgF8+0cJqx5y4fAa2mMygR00pthJQiSsOVo" +
            "4gJrI4F48NKPZiD1vN1EGtLATwXOA8ppm4YGODCLMDKxgUOU7Ibx+Dnf84xPfOgv3vzGPzywf9/6yor7yxfn29cf+K2jf/PG4x9f" +
            "HK5i/Oo2mL3NNY+7e0Kp1+UB75oGaexz0cfebww2GgN8dWxHawd8ppZ4SCiWsmjBVsecpyDKYDVT6lAFNuoZGmFYETCqIZlAj9dx" +
            "fxcxAuodUBQ06FEiAxcFJV29gvkQXUI5rx00QLJT4u2LEpZGo7m5uf/0qy+/6RN/9YqX/xS+tdvfwEdtZO41Onh9/76lm3/jyF9+" +
            "6vTt+NATu26Q+L5BV11eiNDP2HnDM8Zaz3tefHC9McbwH2Dp32hszLUXeq05zC9+l4Bb0cyiWDVPoMkDG+r2ulTq80QHoJTTYKLu" +
            "hBZuKwBK3m1CzGoatIkkELoA4AqsScCrMbLCOxEtEGJBfwDMZwIyJFqcYmORDtwH/Ebv6PInX/Ked7327979uqsuv2RjFYsH9HDU" +
            "xAfrhweP/emx6//k2Hvu7z/mqUBWPoRwjqJ7B9iR/bHzjoGPz73QAcP1UR8XI3wgTL/4tgS+1qSBwGq5pcgiwDgHBFFAxIYyaGot" +
            "sR5lrcOB9pmt4xbnKMHaHOGkAkwaoL6EO4hqo/uIhWFwPdbdYsvrswY6uwEqZB8vHvR8IE/S0ajaqoqmhmbI+CU/9SM3f+q9v/Wq" +
            "V3bazY01/CwAG56c251m66YzX/1vh9+Cr/og0d1GT788gJEW/RFSP1rHqMeQR96x8mD4awac29mPLuR61WiujFbZb3Q82Wz6iSmq" +
            "DEV0RAcYxRB76OQqUlFPq/h4yMbEmigXULXER8EJ887qCXQAQ1dsiI/3/T7g4YejXiMdeip4L6nUe/hrwHBohBfwlI5qFTUT2dTF" +
            "+VxenG/4yDue9wPPxg3ScIBBQBe4OJ8erbzj+If/4Mhf3L5yZ2fUaY7wuICx3/DFFjc8zD6evUf9teH66njtQO/A7u5uzBJMGKxa" +
            "Z4ana17d4plHTU1qXPD4yUhmyFli88CpZmZ1ciJd6qPcchegYpPCIhdCkM7NR8ZrNZHGCNDcOerTKsQhj8uiZiKfYn1JgJYfzuQ5" +
            "I581OlZSZDlASHAdGI2+77nP+uSH3/GG//k7+/bs3FjrW487Hjw537F66I+PvO264x88hUHfaCPjXPobWPqR/f76eGNtBIM+PoXf" +
            "29nHOwFcsflWsLk0OBn+6002O3M6e8NgwlbpnAeuPWnDDCg35kdNy2IjLQcScgMsL21zmYl7aLSGm3GObHU46bDkauxDqIBzuj0b" +
            "yIsdefcLiXStpkfP/cxPGDYeXVI1H9Dgubnuq379F2/+9PUv+/c/OexvDPFKU1u3hUeq8ceWbvz9B/7XPy/dimdjLDhrzPs6Bv7K" +
            "EJ/3NC+af9L+3nlgVgoQfxuPxCf6j2qBnOUPMkFzAJMFtDYD1HY2KUDo3rxldhRyOWs3L9TgZMZd/CPD9RMjzN8OvguOfTj2UZ/f" +
            "6oGHPaNo6Ant5lTlVCAZEq6uSrO4CNdBVA3I7YAih8zliCvSlZdfev27X/t3f/2G8/bvGw19G0P6XqN9tH/0ukffe3D1Pqw8K6O1" +
            "leEa+mB3Z9/lC085p7ObrPyHQHA30FpFW/qPYVjYe+2IgHljMbHQVBBR1bRlyMDlDoC8VE1UK0aV6qFMYjmiHxut3z/YYAeM2/20" +
            "d/rjTn/UGYwsSR+v47ZE90JKPecLB4z6g67K6ZuDYBZzJRfK8CVEJ8D+537mhb/zm7886KMDuB6YsdOaWx+v3bx085nR6vJ4tdXu" +
            "XLpwxUVzl/FOiTg+onBn6tpL/cWlwSLWxeyqcs+rkxxPea+Bk1/2VWqSGxYfScIaKhxN49bNaGNFSuRMAHnwb3U8/Fr/zLW9c3Fj" +
            "R6ccPlQFgzLMRR8FhSUlQdjQbE34AJ/V2QFNhIXJAL4rrrgM30IuvDMWuD49WFoerp638IT93QvwMwE+vSMCXpX4ugIlWXeOrj+8" +
            "Ojijz+UVGRVnFVICZbD7iqmottyrRjEDoXQfRS2dszYXSgBIsFs1vnW4ONAS1NcqpLUorUhelwZjVvG9Ha1RHd+XqjsQI/KG2HAE" +
            "/yxfUzILkhgn7EgXPp8Zj69/30ea+FilakJziJvP8fi79jz/8h3Xnte9CEnHBFH06BfsuBJpiPAGrXP/6j0j31Un9mDaJLRCraKD" +
            "QZNyQ6rU4tO+STjq7owKPjsFVa5tYj+mQ+KaX8bMRVLxhlipIAkgVQfRswW0oTUlArADdDGmFCIpqKy2FCMFLk5g2H/NxsFD9736" +
            "NW/6+498qjs/ZyrcCeA2/7y5C39830ufs/cH0UF438BpCCIFgF7zRGA38FZ1cN/qQbBV/FWpCmdGKcPcZM50NCS5UrMYO76jRhnr" +
            "m25b6NiVymtwAAsRX3O37hou3TdcfXLrnCHW+EQuLMvkRHsp5z/KbRqTHO8JODuVGei2iEFcoiEKbOz95tra+pvf/p7XvuG6Y8ce" +
            "6zH73JDNTrPz/btf9OMXvmJ/b//GYA0PZTACXnpmR9lHARLeDC/2jz+0dh/XnxwDLdSgOMt26iAIpCBnK+QB0y7h4qyvpUhXEJg4" +
            "H6c0SUAzmYIsogte5OzUeOPW4Ykr5s5dTy9SAu4eT5ZKfWKisQmQFvzuTtEKlzzGSVfTCYWrWHMA+tznb/3d33/9579wW7vX6c3j" +
            "l2igxd87WL9k4SkvvuA/fsfO7xzhsQsPvxzW6mK0A2mSb6deDcL60Htg9e5TgxPotvAtMtmlWAtFrWhMchAVnJ00u9X3ECyBcylr" +
            "HJtUgi3UhWFddeP64Z/d9hS9fRGW3SQwxz4LGY4EKCSJWcLcDwmGjXOT0WZxNYRO/bFHj/+P17/z7e98/8rymd5CWnbwbLWtvetF" +
            "+1/2/P3/br61Y9DAN+TZ8VgUcJOjT2tQISn8+n5BahzaXz9zGy8A/OBOGLXjcVJvTD5W4yqJPMhY0Q/7vRAU7NZUR5bSZlMf2YCQ" +
            "+1yX4GkAn9k+NFw7r7ON94N0h5xy0xG1NG+cX03V4MSTgNucoJUZeodrabnBUkzv+/tPvPo1bzx0573dhQUuO3wewIcFw6ft+u6f" +
            "PP8XLtl2BVI/wJtNbCRQkpFyPO7yyNi8M05eQ9qn+ksHT93m7yWWDh+n7OgU+eMg+baKTuvtKY0muFDNvLlgvJEVHl8taR4bnvmn" +
            "jSM/1/kOvN2tnLipzlmyNZe6Bweq3AEoElG6UtpkBikqSFSjcfDOe1/9mv/9gY/eiHJvwWsOvs+zsa9z3o8d+A/P3vsCfMN5Y7xO" +
            "OjLSkYhJpntN9Co50ypETlx2e3cv3/rY+mF8LYy6s9zA43BzYdqwUOmbcdOILDEXqraZpracrfKqli2Tk4+t3vUT256q5xrkVSkG" +
            "Ekr8sxWKEoC78IZPS5jZrTbyNVdWVt/8tr993Zv++tGjx7rz+Eo8rQajPj6df+7eH/vh/T+7f+7Cwbg/xBf9Oa4zH31DwiC0BLjK" +
            "ZY/BcUdQt578R/yC3KJkCU2OMpOVhUoL7omcBI6M6vn4UL7mIlD1c8U7FUF2NBUcfv9/2/rhg4MTV3X3480igcTIf+4M+GESIA4f" +
            "+GQcH1RxdYY4aVWoXDvRN970xd/7ozf98xe+3J7r9bYtkIKfKQ4uWnjyCw+87Km7nolnKwx80mtQgxAlP/+rrK5nLphVO1MQeAWB" +
            "568jB099CZ9r0nXeHCPDzaKpgomKBtUQ2VYdrxlAgwighj2Liuzy9bJuwJatjNc/vPyN/7r7fF6K2X42lEbIiDLONR2rMC1R1Jll" +
            "/pidZ2xKq0qy1h35kYeP/ffXvv2d7/6/62sbvW1ccwDDxXahtf2HzvuZH9j/k9vaOwYjfNQIE+RcM4/hcG1RBJ4NKhMgenJIjzel" +
            "zfkvn7jp9OAEPhFLuvKUwyyFiUcU1WgiwqwsyREOJKAUXyegKPwT8q1siWmmCemhxxe7P7l68GU7nnWgu4sPPPDrXkjLQRrljEVR" +
            "MS6Gww9sHWez0777mw9DpIGMn9yP/vr6D7/mz956370PYM3pzfHtDV9DN0ZX7XjGj57/0ku2X4kLL39bqi4MFnglr9h5jWWrKeA/" +
            "H/M0wNfD8P7nlsVPxN2nMQJucUgtAJhtFzHbmxpkQ45BeI+hhp7uLJyfOWWnQxa5MB1AlrggRzUjZRlxYMidHq7s6ux81sJlWIbx" +
            "fpEv2fmqC1Fg16fkrDJOdApeYSs7rdXR4IPLX10d99ut9v33H8bbtIueeMHX77jr13/zj1/7xnedOr3cne+5lRj453T3vej8V7zo" +
            "/Jfvnjt3mO5zoERwfKng9YdHS5gbavUrKTqVwH5Z6TYX/vmxf/jS4se1/kDy7W2KbjozICso8ddSrvlW6dGKaqkQFw5pOSFXQc8q" +
            "n/X3t3f9xfmvPLezE6+iQ5+Mamh+nsu4cQe11F955SPvPD46jc9S0Ip+f7D7nHNWV5bX19e7c3O0whc9uci0rj3nOT944KfP7V2I" +
            "r5Myq3qrrSN6H0nnsoMv+LNM33EEkCOgtkGCu8+1/uqb7vq1Y3wALi4AjLcGnqyUAMVXpGkSm+p6DqjzliwzrQwoYGqGQ6Pb6Q1f" +
            "93xksPj+U7f92t4fTsMzOsFgjktsWDfTlZl1/HamjT9Tpo9SUO91O8vLZyDvzXHFx5qDdJ8/90Ss+N+x67vA1x+v6zdOnN4a9Zxh" +
            "7CUmmhMOFUkg5X8QaMXnUZ7Bir7Bb6TmbznxwYdX75m9+osFsC22BBG7fEqwSefhIgwNEDqguAmOkFDFOdlBUSgVmOuFFLfSH1m+" +
            "9Ud2PuPS3n49E0DnLWUDJF4XrUCl15pfaHRxG5NfgzGT3PBSYYjsPHfPj37vuS/axlk1wCyBFnEQARiR7gBIUtnZt9xAStQYFWjV" +
            "bnQeXX/4H4+9V3+/Sd6qAwBE86ReZjEnBYrIC8+pbLxqdWxmZZ+nLewVcAjzOWtdwBGM3jjkiirKGZNKXH2XRsvvXrqpz79dglfQ" +
            "+HIyP5Dh7Sb/RAa+HtLC79ZdpRzvwdrdvd1d7NvYlABkv3/ptit+/uJX/dB5P41uwC2/HKZ0O/vov5g5cMcgtOsbQUyfCsgin7f5" +
            "1g+XJV57+G6o95mH/3Zx42H8sblwqzPTp6lFKjfPbtVwaD04imipkJw3RNkCRmkYJXr+tRRxhBvLa0QJypPlWYsCqH20FmVrfVQI" +
            "tsf6cF//6EXd8y+bfwJ+wM1Bh6sxhy1bjm8vK3f64YpugdqtzrHm6CvL39CFGc8EfLza3tn1vP0vfsGBn97DBwv/8IuG3rjUa8VH" +
            "EFh2+KyAsxKt5UULka4Quvi7z4SRsNucP3Tq1v935I3FL8KiOW5DbqmrWYhCTnFqeInYvIyrXXtbdRe0OXBKAzdoOLLIFkprx2W5" +
            "ZgQcgOO7Nx5+7o5rFtoL/IKmUq/bHl4qff/DwchBiuS1Vhvt48MNfGSIXOOHSpfvuPqFF7z0ip1Phwo3nbzM6gHCBSdd/tm1/KUB" +
            "fbLMbzuizF7CjGc3sD/onQCRwKCzNli5/v4/ONU/qis2ogcZrWrtmK5spi/lLpdH8LCKvxUwfx6cqCLu0mzamSXAKDbWZuINqMyN" +
            "Rutbi8NTp0Yb37P9aq0MngFcjnhvig9H2KdJiAyeHK0N2nuv3P60Jy1c9Yzd3/v0c569rbMdvajk6mYm5ZQn3TrhRLm7RJllVeNE" +
            "qYRWvc642SUa/mwD3jzPffzwW7528jN4BR2BU140NcTTZ6C85ULOS5ZkJo8ReGdWmv6DTUJlaLDVSCe0W1Shko8cg5qRyHBHdM/6" +
            "Q3u7e67CYwGenpAO7hz+WivUB6k/sBx17hmcnGvN7emdu629kxnDhyQtDm2mmBderzlRICKplF9wghDhONfuM9ziEqaoIMGGLzFu" +
            "u/3Epz9++M917Z1omyGzhDSVdvpgOY5OhZFJWNigDbIVKkMn6Cp5YQlMeX3MJqXLyjCrUWDO3n38Y19f/Wabv0TCN7/5U1Psev+D" +
            "n7q38XcOuTdbC625eX6TB9dJ/XKCecTVA7wY1PYPf0y5BjtHOpRYwTC9eORPTblU0Yqe2dO6IsJK84xx4Wo79/Dpez764Ov0Pd16" +
            "GwnQRqeztglxae0+ZoB0zZ5IO22o1OYOQLHOFGpiGD+Hp/A6pGJhgmKht1WFzyVhsBDhm35/fuz6Y4NTeBDhT7fwo0YmC/MAeWeX" +
            "6JP6VqfV3c4/Lumfu6QQsUbh0wXf27htyD4XE92ucq3nTYd7InUSq+4DatgZMPfFAAGsbJz5wAN/cppLf3nnM9GeaMMm4qSu8qCM" +
            "W4rUadAw65F4fRJKde4AENcTmigp1qCb0uZQpguwLeBKk+hCiEf8+zceevPR9yzjjc24iw+/OA/00wmkHmPfN6nNRndPazsepP1O" +
            "GMnT9ZnpAxPHMvMN95wWGtoSokoA5VR5V0I0OQBUH/AJoz0aNj/44P+4f+U2XANyi1GIRNVklFOgQ6nJZWjcRviAE8YUonRWXMSn" +
            "XGzxR/uCNbvLBWvKai6D1t0MifdpsCS4GBzuP7I4XH7G9mv4gghJ4dKvFKes8XqAVxcPD0/hkbiF3yDh73nwzpLfXdedIm800/CX" +
            "V/wE1rc3ujxwXVIiHQeQNOS1mpFhvrRb4+7HD7/p1uMf6DL7EBZbvUY70vDfBHCyag6aT1AEuThSBUF00m1ogS6KGTeDzUQeKjQp" +
            "Jl0wsMEGhPeCB/lo37N+/8po/dod6ANdhzlsuFxw4eZSg/di3aPDM+gGPBZgicCLGnEifUhvuvbCVlOZJr4XYjVlX32gazUzh0dd" +
            "gsGOr60vfPrwX37u6HW67YmI1Y4cLAvQAM5pU29JtnAhV22igVjjobwCpSLiqB7EMlGaHIU5VKUwIwVhbSaA2gmFBDaXLW5oDq3d" +
            "g++IP237U5lxTAI9lwKnMn7a0lkeb+Bn2V38US3cK8Yf21I3aIxzFVW6MdnZLAk9M6iKpCdmpBI90GmP5288ct2Nj7yNfwaFsKmN" +
            "TBLiiBGBTZ0AEQcahVMmswVmMZXKFsSx3Z7Pf7QvuSwsgjLQqZ4RZaHEqJyUWwRKBAZn6+DqwdXRxtN2XItc6AaGWYKdVngsPZ2j" +
            "w9N4Ka0OQGrRDWnsc5Fh9kEUOwe+5gcZIKSWeBYIVvZ7nz1y3WcfeavXsWhkcYadw0aBG3qRq7lSL0czG5XAtigrkpBGwqQBJ+Xl" +
            "n61UK0A9bWsJjhOqzGgraF1IJAx40iSCSWeFgT64c/Wuk/2lp26/Bss9fzMNM6USE2Ku2VvCl93HA14BMGCx9OCshGJCyAMzq0FK" +
            "FV0yMGec2WeXOPv4S3Sj5iceesvnjr0Tr5rrY38qVjeWYpTcNkTtQkrfRGukJZ6mOHifADHQbJ4exCYg9SrJKr8MYEJSRg6VqzhO" +
            "bLaqhKz7HwJCku5du+uhjSNP2Xb1Qnu7PjbABZnzAFnGJDg+XMLg5YXUw5mNww+c2BMQ8AuQVpHJl1k3VIu+Woz7/bX+2oce+DNc" +
            "dTv8U/lgKLdUI5aRafRUTZUEQqOSFsKSQVWrKnk9EZRXOpRxDdCriDpPqgFZA89K7gRgJo+FJXICxnYhf53D6w9+Y/lrl2y7fG/v" +
            "APoAsWMq4IKMh2GsUfhBC5OK67BHtHuCIgxw3+F4sIOMO/smVh486z62+tD77nv1oVOf67bwiQK0m2wklJIkwOAfh0GcldCkIsMU" +
            "j61MbrDLGWpCC9EB285PFDiVZBMRiioBKhjbSaH3wLCWhcmRWhGRJDyqgBUbLomLg+O3nfrSjvbuixeuwKqrLy0jIfiDiguLo9NY" +
            "THA/ihHPVYXLDgc/jqxiNrAATvVHigBLEv5vJfN3LH7u/d/8/WPr93T1ITvdxj/5L+NQyysBWqVKkqjJHBverAoAz1GmHtMI1ZAk" +
            "JlWhVDWeAygUNCeUlvVtQkCk4ki8iSAtQTblnUmdBLUsyYUM4V1kuz9av/30lxYHi5cuPGW+vYO/lMMjGX5q12jhf//CFUcp5gf+" +
            "TD/f7WikcxLwC7XqGLhBl+DjrfXh+meOvOOGI29eH+I7/vWPGIEvY0CZ1TQBNAOLcJM2x2qVMpBJnL2kwewVf2WIKrpENweyQ1V/" +
            "vDvb07/SyUMlpZga0UnPKMilo5EoU1gcE1spiTKpZEarcJTPupLeu3LnHWe+ck5n/3nzF2F9wteYt3d24Ocea/zoERcDbEi215y4" +
            "F/LY58qDpYf3mt88/a8ffPBPv7b0Gd5u8togd8mRmiNROjAiCNVCHaok0MSiiNettiW1bFFgnHpKuekZQlOBra1tiInPAcEMlhQU" +
            "zgaDxDzqtmScmI2tdwMQWVvRhoz2sgrO7NCaFAld85Jwenjyq6e+8Nj6oxfOP2lnbx++1TLfXMCvuvDxgG6H1Ad4OcqMgxFVzQkM" +
            "/Mb8qY2Tn33kXTc88taljUf4qFXmi/Sy4EpSxQN7ajzOUKTSJ0anNgjCVIQVLaQSkrZpM3/UjE/HLGTBD2ISlS5JxDTAJCUFrk2O" +
            "kzRUGcF7ZJeLo0NPmFKOcpaiYC8KN8shFoQv2JqNB9YO3X76i/gUfn/v4u2dnQuthQ1+xxafoUELHNccGLA65nKP72N99fgnP3r4" +
            "9Xef/qKk8YoNYO9gF3/KL0mo8tBnrEkbpaLqYgK4/2igjTpFZLXX56SCjo9z04lq9vZeU0jNXyxStidz+hcroxSGo5i7BIXEgdNU" +
            "t1imQDQvo+toheBm4ZUkfNEKHwVfOH/Z8/a95Jqdz53v7jgxWsQrVX02gD/phyttFx/i94f9Q6e/dMvxDx9evZNXZ772cZy55Voc" +
            "EFiK014VsQICuoo7JFVg7KoAOFii62EXkHoC1OvJSu5l2OzuvSZ1FS0jaeRVFYdUtn2WZnm9YIaSKmiqs7XRUZQzHrnx9HeTKIig" +
            "FaK+az7CcvQ9e37i6l3P7bV3ruJvHPMbjs3Vwel7znzlK4s3HFk9BLP6xZZZ1n/hhS7V3xqvetcrSQqMaqZVdgpOEmXfOrWZIEZe" +
            "bhWDupzVQPhMzpDI0P8bq8qOQtcAQyGDs1BmSZUB1lo1ccwMWT4Jdi6meJl9GxcA/kUr/HWN0Z7ueRfPP3Vv5wJ8C/6x/sPIO77K" +
            "gHzi2pv9pEJyp1hTo9ivrPN1Nmch1m7mshaYK0WKc+5yYdIT6olXGpdRjFbYRT0hE0sQGOpdFGEo3rrDUgU7tqOOSq1VR9o0IgGQ" +
            "4w4MxDi/OClSWwWhADYL76rhg68hvowrC917trngOKTcZBSqhCR6sUgqmJyTMbWbDGLhODUs+oABstMklzAoJRIFEcXGNuZ8Gp2P" +
            "gNHv1HhRi9PQQ0a90cpeaJM2CqIlUDM+gmqb61lqPgbv4QZz6KimsSwZsKopdzZBxdypijru8fk6YdJdKVBZ7ChFHm3A1NBtksop" +
            "JWyyAmFzUHRZNixDqJhdlBgHQaNSnT3CxCBqdYbVlf1UBxifDCoyOYk2JIfhN7Ely5gIdi8GAFPDlMfK3CbsRVFTESxVgQ3Micjq" +
            "HJrZIE+0omA3CupZSXCpdvYtk9xgwqAKZOKMKrWxVcNEXryQhTLObFU0SFzCxpywIW7gLA0gjZNHnirnzGAe70SlFhKk7IEnqKjN" +
            "IcKOculSUlTDnCFIHqiMlNF4aiNQSB1CLRFssduLy1CT0PIYNMbYnEf8C4+pKhMdKEColpMq6GQkQ4MlT1HA0VQeiI+kIUvRCBvz" +
            "yE8/okZ33pimJA6to4nGEIZOh4W8VsQpQMkZp7aIwLXiSOO6n1iQQlyAFVEVozURXo43G8RA9gwwjkc1RAWNTzWBRkYo/hSUfNkE" +
            "LWFE4T0XPYTsk4kOtgCmM8euPLjB9cbhEca+TaMjiGyTZYDYDFTYZZGTl1RJQWiyA4l46F8x5CYEAGd1ofqo5pYcwSM0W7fFBm12" +
            "A2hCk9dipVuEwZq6whHS3FD4ULppJqipQkuxt6oUkpTZcFA1IEtcKCx52zZjQ2zKC1eJYoO5d8g8IlA1AlWOXgEs4YxTGwGlJidF" +
            "TZWAeGzA25urOCZaEpnMMumzQIVck06WLIWYjsHNo/PIojZrgGPYjJDfY1GgYZzsiCYk7bSDFU/YjAmtZRPHhIRVBJWMXU2/mZow" +
            "CgccNiLIthkIScpviLInC1DlLgKaq46DqSpCDU1IIXF3o1DECotQiDflKI9WEaYaLQU3CEVXyZCSK476QVaIgmM8mQdAVVeEykUT" +
            "Cy9m9WJhldJWc5p7N7dO9HqBHqbktVMfk1xJQLkmzGlR66dVkORdyXdXihLxWQeMyG3uoxAsUlMpkiSlKVooMNhSygEiwFJbix8H" +
            "y7OK/K4YoGUn2ZElaWFFamKIloUMDEVR7nQO64gtD4Ok0KkwdkL45rbcIiF1VzabMAY0tUFgE6WjI3IlxZ1bwJArMEtopWJIoUPE" +
            "EvnV9ji7txgh/AIkHA35RZaSxwTmDO9YTkMgXzjYncA46ExqlxmAgOw5lmrWucONKdXGwVkiqtmREbbJBSr46kAGkCu9T6XM1CjV" +
            "AFDE5izY3pgUTaaXtGLQ3bJ4E5D9x0B9rVHHEC1KjcHMxCBSP/CkTmAcVUfI0KmKAG3Eoza2O8oUMLPW+OgKqelWSa/pExb+C5Zc" +
            "FJ6QbANY1echpVPSZ2RchCEBF2wSYyY22GYpBAWIsjCgM7Y8lh7s2seIDlgKUmOZmUzHEhhr0YvaNkKmzEHCLlT/uey+y60Av/A8" +
            "stniyRLA7As6dw5hkgkaRUqKslJBtgLEJMgXIxOAFs6MkDxYTru0yT9fuE9ubEyKliqUjZFBkuDkQeJ6LSDibMQJxRylLTNBJLJK" +
            "RQREaIUUIjdKy4uFBLDkPDsqDRkI2fC0oeCddUmToTAkkC8eE45hVvYMRGYseKs6KyQ8M1b7h7WpMBrCyBQkVgkHwWmYC/zkLm+J" +
            "Ab6TadZUBWNQJ4V8oUC44kcBVTjkEYGEMPjiDK034qoN6pT+LKMIFfa1irnA3NG12k8IKnInabJXGEVrBM7cLOQAcqEyrYtga367" +
            "MpXHOExQyOQK2K5JJgy1MK9TylX6ewEqp0NiIk/eCn81ElSwKzfGKhca9HRMLBzzmEuscXPEUlrgowYl8l0p1NEpqHwyY4FKgqAS" +
            "AYKpaEJTnu3HkUjuFNWabnwpQtmDuqKCGyHCna74xCmCkNYxssZzgAwZaB1WkROg5QbRTThOLmSpzBFaMYLTpJB5na2cEGXXQcrG" +
            "G840y6uDQNFyV1HOShKHliUqUJfeZUgFksgE6QgJwnOj1D5apn+GlF7FBkHRW4YHm0NWCIQVyhQYxkQmzIXiZRyJspw24Aqv2W1F" +
            "EZ4Ik2XkT4M0iKDCTive6VCV1ZRBSyT/cVMbkkA2ScwciqeCplL5BABD7zyrD1CtphLjMF86phrk3FgTPpUps0qjmWoxMCe2DLSR" +
            "lllJO5fQIlVw4NmboamCGVBpAoGzQJHudHNqdYZnHhdw9C5Y9qjkQRRmOFe5RXpCDjEiIZUsxJl06qTUasdQ8anPiCNvWmRlq462" +
            "r7ABP3eBcUzletASJwPxQBA9kOr05WLkR5z0z12BKBK5A5evywDTtQA8qcq3oZmF0mAxF6qySeNW+nQIrqpv3B67pwGb6hqbai85" +
            "3SiQIWJCgU2SmnL8s9reWJYgFySPbJqrNpLIZhqAtFXvtRKcUsKkN95AHXmwt4KKElbxT9LgTq2zEG3KsAQWEYxRTSr5oDa9jBOd" +
            "hFsdjMpHuWfOHEfuSDSQS6p73L6NgSIcpTjcMRA6KVBnPALJnlJQ1FkPjfcItzRLMlvH8Cu7B2DGyKCSXZyDrjjHoDASR/HKOOVd" +
            "TMlCKGVCJTSI9hpeEkRXhQN9owYVK0NanlMzSlEuW5cRbgWoyJZ1ppZIcTA6jQU7ldp18hpNe8EoEpf6OeVC5cJJ8hXQoEh5cZVH" +
            "M6KEAuhxjC2PiyQIitD7rLyy48xMOgAzNgpxptbZJyzc1ykRR9wFTSgmqqAwi49JS6kiUFv4CGLnal20zy01IkVMIwi460nNqQEw" +
            "bMhvKkIi1wIQoz1h2XccZ7lKrbcUTWaCVJY6BT1jCYNNz2avtT3MkrGmrgHwgYAoT94UkaOUh9IfZ0AKOJ1mBAGD1GwwB0xCXj+4" +
            "yxctXYIuO5EWctoJnFJvAFNnjzxRlqrqIVWTsJokxvMIFbx7nCWYzFlO9QBDnphDSY1FSZFOlOZidCyMJKsUImY2tJM0JLmsGCzl" +
            "EUD20GRDpj6Ul8WMg3zrIGVVCqwlepmYmqDsUE1VNlCAqCGaJHMhA6yz0sMfR1DCMGNAKKskC3k1BgXAwVuaRqwkaFikMzyAzxX5" +
            "ZNH1dLRp6ZRsQcdwtBmgI+sMqOrQ7Kwy429OdB9EIPXmidlLa8aTCA2wD5MRHg5S66FQtsQIc4spDJrsxtaoQgvv9l2lwi5Cy9Yo" +
            "xMQZWlmJnDRBQqtqc8hV3e1UhLnJMFbqgTI1j5yvpCQ/1daEDeWSQIX1FzgFQz9RoNoJdqItNx0b0vr/4rL/OQp7KEAAAAAASUVO" +
            "RK5CYII="

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
                    var img = document.createElement('img');
                    img.src = '__ADVOID_LOGO_DATA_URI__';
                    img.alt = 'AdVoid';
                    img.draggable = false;
                    var spinner = document.createElement('div');
                    spinner.className = 'advoid-spinner';
                    spinner.setAttribute('aria-hidden', 'true');
                    el.appendChild(img);
                    el.appendChild(spinner);
                    player.appendChild(el);
                    return el;
                }

                function setLoading(video, loading) {
                    if (!isOnWatchPage()) return;
                    var player = playerOf(video);
                    if (!player) return;
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

                        // Fresh element (new video or SPA navigation): not ready
                        // yet means it is loading, so show the overlay now.
                        setLoading(video, isOnWatchPage() &&
                            video.readyState < HAVE_CURRENT_DATA && !video.seeking);
                    });
                }

                function refreshAllLoading() {
                    if (!isOnWatchPage()) return;
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

        private val VIDEO_WATCH_SCRIPT = VIDEO_WATCH_SCRIPT_TEMPLATE
            .replace("__ADVOID_LOGO_DATA_URI__", ADVOID_LOGO_DATA_URI)

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
         * VIDEO_WATCH_SCRIPT toggles), the grey centre play button is hidden
         * and the AdVoid logo + spinner shows instead.
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
                    '.html5-video-player.advoid-loading .ytp-large-play-button {',
                    '  display: none !important;',
                    '}',
                    '#advoid-loading-overlay {',
                    '  position: absolute;',
                    '  left: 50%; top: 50%;',
                    '  transform: translate(-50%, -50%);',
                    '  display: none;',
                    '  flex-direction: column;',
                    '  align-items: center;',
                    '  justify-content: center;',
                    '  z-index: 1000;',
                    '  pointer-events: none;',
                    '  text-align: center;',
                    '}',
                    '.html5-video-player.advoid-loading #advoid-loading-overlay {',
                    '  display: flex;',
                    '}',
                    '#advoid-loading-overlay img {',
                    '  width: 88px; height: 88px;',
                    '  display: block;',
                    '  box-shadow: 0 2px 16px rgba(0,0,0,0.45);',
                    '}',
                    '#advoid-loading-overlay .advoid-spinner {',
                    '  width: 36px; height: 36px;',
                    '  margin-top: 16px;',
                    '  border-radius: 50%;',
                    '  border: 3px solid rgba(255,255,255,0.22);',
                    '  border-top-color: #5FCA6B;',
                    '  animation: advoid-spin 0.9s linear infinite;',
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
