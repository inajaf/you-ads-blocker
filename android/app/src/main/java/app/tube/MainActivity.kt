package app.tube

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import java.io.InputStream
import org.json.JSONObject

/**
 * Full-screen WebView wrapper around m.youtube.com that blocks ads Brave-style:
 *   1. Network layer  — shouldInterceptRequest returns an empty response for any
 *                        request whose URL contains a blocklist substring
 *                        (assets/hosts.json).
 *   2. Page layer     — assets/inject.js runs in the page's main world at
 *                        document-start, stripping adPlacements/playerAds/adSlots
 *                        out of player responses before ads can be scheduled.
 *
 * Neutral naming ("Tube") is intentional for trademark reasons — see README.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    /** Substrings from assets/hosts.json; a request is blocked if its URL contains any. */
    private var blockList: List<String> = emptyList()

    /** Contents of assets/inject.js, injected at document-start. */
    private var injectScript: String = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Draw edge-to-edge behind the system bars for an app-like full-screen feel.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        blockList = loadBlockList()
        injectScript = readAsset("inject.js")

        webView = WebView(this)
        setContentView(webView)

        configureCookies()
        configureSettings(webView)

        // Register the document-start script BEFORE the first loadUrl so it is
        // guaranteed to run on the very first page.
        val documentStartRegistered = registerDocumentStartScript(webView)

        webView.webViewClient = TubeWebViewClient(documentStartRegistered)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    // Disable this callback and delegate to the default behaviour (finish).
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState == null) {
            webView.loadUrl("https://m.youtube.com")
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        webView.restoreState(savedInstanceState)
    }

    override fun onDestroy() {
        // Flush cookies so a Google login survives a cold restart.
        CookieManager.getInstance().flush()
        super.onDestroy()
    }

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    private fun configureCookies() {
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(webView, true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureSettings(wv: WebView) {
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            // Current stable mobile Chrome UA so YouTube serves the phone site
            // and its normal player.
            userAgentString =
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
        }

        // Never allow mixed (http-on-https) content.
        wv.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW

        WebView.setWebContentsDebuggingEnabled(false)
        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false
    }

    /**
     * Register assets/inject.js to run in the main world at document-start.
     * Returns true if the modern API is available; false means the WebView
     * client must fall back to injecting in onPageStarted.
     */
    private fun registerDocumentStartScript(wv: WebView): Boolean {
        if (injectScript.isEmpty()) return false
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(wv, injectScript, setOf("*"))
            return true
        }
        return false
    }

    // ---------------------------------------------------------------------
    // Asset loading
    // ---------------------------------------------------------------------

    private fun loadBlockList(): List<String> {
        return try {
            val json = readAsset("hosts.json")
            val arr = JSONObject(json).getJSONArray("block")
            buildList {
                for (i in 0 until arr.length()) {
                    val s = arr.optString(i)
                    if (s.isNotEmpty()) add(s)
                }
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun readAsset(name: String): String {
        return try {
            assets.open(name).use { input: InputStream ->
                input.readBytes().toString(Charsets.UTF_8)
            }
        } catch (e: Exception) {
            ""
        }
    }

    // ---------------------------------------------------------------------
    // WebViewClient
    // ---------------------------------------------------------------------

    private inner class TubeWebViewClient(
        private val documentStartRegistered: Boolean
    ) : WebViewClientCompat() {

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest
        ): WebResourceResponse? {
            val url = request.url.toString()
            for (needle in blockList) {
                if (url.contains(needle)) {
                    return WebResourceResponse(
                        "text/plain",
                        "utf-8",
                        ByteArrayInputStream(ByteArray(0))
                    )
                }
            }
            return null
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            super.onPageStarted(view, url, favicon)
            // Fallback for devices whose WebView is too old for
            // addDocumentStartJavaScript: inject as early as we can.
            if (!documentStartRegistered && injectScript.isNotEmpty()) {
                view.evaluateJavascript(injectScript, null)
            }
        }
    }
}
