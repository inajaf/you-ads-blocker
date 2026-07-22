package com.advoid.app

import android.annotation.SuppressLint
import android.graphics.*
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.webkit.*
import android.widget.*
import android.app.Activity

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var adBlocker: AdBlocker
    private var shieldEnabled = true
    private lateinit var shieldToggle: FrameLayout
    private lateinit var shieldKnob: View
    private lateinit var shieldIcon: ImageView
    private lateinit var protectionLabel: TextView
    private lateinit var refreshIndicator: ProgressBar

    // Fullscreen video support
    private var customViewContainer: FrameLayout? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var originalSystemUiVisibility = 0

    private val green = Color.parseColor("#5FCA6B")
    private val darkBg = Color.parseColor("#0F0F0F")
    private val greenTop = Color.parseColor("#1C211C")

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        adBlocker = AdBlocker(this)
        adBlocker.loadAssets()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(darkBg)
            fitsSystemWindows = true
        }

        // Header with gradient background
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(10), dp(16), 0)
            setBackgroundColor(darkBg)
        }
        val gradientDrawable = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(greenTop, darkBg)
        )
        header.background = gradientDrawable

        // Status card (height 48)
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(10))
            val bg = GradientDrawable()
            bg.cornerRadius = dp(12).toFloat()
            bg.setColor(0x0DFFFFFF.toInt())
            bg.setStroke(1, 0x12FFFFFF.toInt())
            background = bg
        }
        val cardParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(48))
        cardParams.topMargin = dp(10)
        header.addView(card, cardParams)

        // Shield icon 28x28
        shieldIcon = ImageView(this).apply {
            setImageDrawable(ShieldDrawable(dp(28), green))
            scaleType = ImageView.ScaleType.FIT_CENTER
            setOnClickListener { toggleShield() }
        }
        card.addView(shieldIcon, LinearLayout.LayoutParams(dp(28), dp(28)))

        // "Protection active" label
        protectionLabel = TextView(this).apply {
            text = "Protection active"
            setTextColor(Color.WHITE)
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
        }
        val labelParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        labelParams.marginStart = dp(12)
        card.addView(protectionLabel, labelParams)

        // Toggle switch 40x24
        shieldToggle = FrameLayout(this).apply {
            val bg = GradientDrawable()
            bg.cornerRadius = dp(12).toFloat()
            bg.setColor(green)
            background = bg
        }
        card.addView(shieldToggle, LinearLayout.LayoutParams(dp(40), dp(24)))

        // Toggle knob 18x18
        shieldKnob = View(this).apply {
            val bg = GradientDrawable()
            bg.shape = GradientDrawable.OVAL
            bg.setColor(darkBg)
            background = bg
        }
        shieldToggle.addView(shieldKnob, FrameLayout.LayoutParams(dp(18), dp(18)))

        // Position knob at right (ON state) after layout
        shieldToggle.post {
            shieldKnob.x = shieldToggle.width - dp(18) - dp(3).toFloat()
            shieldKnob.y = (shieldToggle.height - dp(18)) / 2f
        }

        shieldToggle.setOnClickListener { toggleShield() }

        // Privacy info
        val privacyInfo = TextView(this).apply {
            text = "Safe to login — we don't store your data"
            setTextColor(Color.parseColor("#888888"))
            textSize = 11f
            gravity = Gravity.CENTER
        }
        header.addView(privacyInfo, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        header.addView(LinearLayout(this), LinearLayout.LayoutParams(
            0, dp(8), 0f))

        root.addView(header, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        // WebView
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

            // JavaScript interface to detect video play/pause for screen wake lock
            // and handle pull-to-refresh without native touch interception
            addJavascriptInterface(object {
                @JavascriptInterface
                fun onVideoPlay() {
                    runOnUiThread {
                        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                }
                @JavascriptInterface
                fun onVideoPause() {
                    runOnUiThread {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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
            }, "AdVoidBridge")

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    if (shieldEnabled && request?.url != null && adBlocker.shouldBlock(request.url.toString())) {
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
                    if (shieldEnabled) {
                        adBlocker.injectScripts(view)
                    }
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
        root.addView(webContainer, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        setContentView(root)
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

    @Suppress("DEPRECATION", "MissingSuperCall")
    override fun onBackPressed() {
        when {
            customView != null -> hideCustomView()
            webView.canGoBack() -> webView.goBack()
            else -> super.onBackPressed()
        }
    }

    override fun onDestroy() {
        // Persist login cookies and release the WebView so it can't leak and
        // keep running after the activity is gone.
        android.webkit.CookieManager.getInstance().flush()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    private fun toggleShield() {
        shieldEnabled = !shieldEnabled
        updateShieldUI()
        animateShield()
        webView.reload()
    }

    private fun animateShield() {
        shieldIcon.animate().cancel()
        if (shieldEnabled) {
            shieldIcon.scaleX = 1f
            shieldIcon.scaleY = 1f
            shieldIcon.animate()
                .scaleX(1.3f).scaleY(1.3f)
                .setDuration(150)
                .setInterpolator(OvershootInterpolator(2f))
                .withEndAction {
                    shieldIcon.animate()
                        .scaleX(1f).scaleY(1f)
                        .setDuration(200)
                        .setInterpolator(AccelerateDecelerateInterpolator())
                        .start()
                }
                .start()
        } else {
            shieldIcon.animate()
                .scaleX(0.8f).scaleY(0.8f)
                .setDuration(150)
                .setInterpolator(AccelerateDecelerateInterpolator())
                .withEndAction {
                    shieldIcon.animate()
                        .scaleX(1f).scaleY(1f)
                        .setDuration(200)
                        .setInterpolator(OvershootInterpolator(2f))
                        .start()
                }
                .start()
        }
    }

    private fun updateShieldUI() {
        // Toggle background
        val toggleBg = shieldToggle.background as? GradientDrawable
        toggleBg?.setColor(if (shieldEnabled) green else Color.parseColor("#888888"))

        // Update label text and color
        protectionLabel.text = if (shieldEnabled) "Protection active" else "Protection paused"
        protectionLabel.setTextColor(if (shieldEnabled) Color.WHITE else Color.parseColor("#888888"))

        // Update shield icon color
        shieldIcon.setImageDrawable(ShieldDrawable(dp(28), if (shieldEnabled) green else Color.parseColor("#888888")))

        // Knob position — pixel-based like iOS
        val targetX = if (shieldEnabled) {
            shieldToggle.width - dp(18) - dp(3).toFloat()
        } else {
            dp(3).toFloat()
        }
        val targetY = (shieldToggle.height - dp(18)) / 2f

        // Animate knob slide
        shieldKnob.animate()
            .x(targetX)
            .y(targetY)
            .setDuration(250)
            .setInterpolator(OvershootInterpolator(0.8f))
            .start()
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    companion object {
        private const val VIDEO_WATCH_SCRIPT = """
            (function() {
                if (window._advoidVideoSetup) return;
                window._advoidVideoSetup = true;
                function setupVideoListeners() {
                    var videos = document.querySelectorAll('video');
                    videos.forEach(function(video) {
                        if (video._advoidListeners) return;
                        video._advoidListeners = true;
                        video.addEventListener('play', function() {
                            AdVoidBridge.onVideoPlay();
                        });
                        video.addEventListener('pause', function() {
                            AdVoidBridge.onVideoPause();
                        });
                        video.addEventListener('ended', function() {
                            AdVoidBridge.onVideoPause();
                        });
                    });
                }
                setupVideoListeners();
                var observer = new MutationObserver(function() {
                    setupVideoListeners();
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

class ShieldDrawable(private val sizeDp: Int, private val fillColor: Int) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val darkColor = Color.parseColor("#0F0F0F")

    override fun draw(canvas: Canvas) {
        val s = bounds.width().toFloat()
        val scale = s / 26f

        val shield = Path()
        shield.moveTo(13f * scale, 3f * scale)
        shield.lineTo(21f * scale, 6.5f * scale)
        shield.lineTo(21f * scale, 11.5f * scale)
        shield.cubicTo(21f * scale, 15.5f * scale, 16f * scale, 19.7f * scale, 13f * scale, 22.5f * scale)
        shield.cubicTo(10f * scale, 19.7f * scale, 5f * scale, 15.5f * scale, 5f * scale, 11.5f * scale)
        shield.close()

        paint.color = fillColor
        paint.style = Paint.Style.FILL
        canvas.drawPath(shield, paint)

        val check = Path()
        check.moveTo(9.5f * scale, 12f * scale)
        check.lineTo(11.3f * scale, 13.8f * scale)
        check.lineTo(14.7f * scale, 10.2f * scale)

        val checkPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        checkPaint.color = darkColor
        checkPaint.style = Paint.Style.STROKE
        checkPaint.strokeWidth = 1.8f * scale
        checkPaint.strokeCap = Paint.Cap.ROUND
        checkPaint.strokeJoin = Paint.Join.ROUND
        canvas.drawPath(check, checkPaint)
    }

    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(cf: ColorFilter?) {}
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
