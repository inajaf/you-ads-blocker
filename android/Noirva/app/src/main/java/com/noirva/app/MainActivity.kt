package com.noirva.app

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.*
import android.widget.*
import android.app.Activity

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var adBlocker: AdBlocker
    private var shieldEnabled = true
    private lateinit var shieldDot: View
    private lateinit var shieldText: TextView
    private lateinit var shieldBadge: LinearLayout
    private lateinit var searchField: EditText

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        adBlocker = AdBlocker(this)
        adBlocker.loadAssets()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F0F0F"))
        }

        // Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(8), dp(16), dp(8))
            setBackgroundColor(Color.parseColor("#0F0F0F"))
        }

        // Shield icon (green circle)
        val shieldIcon = View(this).apply {
            val bg = GradientDrawable()
            bg.shape = GradientDrawable.OVAL
            bg.setColor(Color.parseColor("#5FCA6B"))
            background = bg
        }
        val shieldIconParams = LinearLayout.LayoutParams(dp(30), dp(30))
        shieldIconParams.marginEnd = dp(8)
        header.addView(shieldIcon, shieldIconParams)

        // App name
        val appName = TextView(this).apply {
            text = "Noirva"
            setTextColor(Color.WHITE)
            textSize = 17f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        header.addView(appName, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        // Search pill
        val searchPill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val bg = GradientDrawable()
            bg.cornerRadius = dp(20).toFloat()
            bg.setColor(Color.parseColor("#242424"))
            background = bg
            setPadding(dp(12), dp(6), dp(12), dp(6))
        }
        val searchPillParams = LinearLayout.LayoutParams(0, dp(38), 1.2f)
        searchPillParams.marginStart = dp(12)
        searchPillParams.marginEnd = dp(8)
        header.addView(searchPill, searchPillParams)

        // Search icon (text)
        val searchIconText = TextView(this).apply {
            text = "\uD83D\uDD0D"
            textSize = 14f
            setPadding(0, 0, dp(6), 0)
        }
        searchPill.addView(searchIconText)

        searchField = EditText(this).apply {
            hint = "Search or paste a link"
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setBackgroundColor(Color.TRANSPARENT)
            textSize = 14f
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_GO
            maxLines = 1
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_GO) {
                    performSearch()
                    true
                } else false
            }
        }
        searchPill.addView(searchField, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        // Shield badge
        shieldBadge = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val bg = GradientDrawable()
            bg.cornerRadius = dp(16).toFloat()
            bg.setColor(Color.parseColor("#28382A"))
            background = bg
            setPadding(dp(10), dp(6), dp(10), dp(6))
        }
        header.addView(shieldBadge)

        shieldDot = View(this).apply {
            val bg = GradientDrawable()
            bg.shape = GradientDrawable.OVAL
            bg.setColor(Color.parseColor("#5FCA6B"))
            background = bg
        }
        shieldBadge.addView(shieldDot, LinearLayout.LayoutParams(dp(7), dp(7)))

        shieldText = TextView(this).apply {
            text = "ON"
            setTextColor(Color.parseColor("#5FCA6B"))
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(dp(5), 0, 0, 0)
        }
        shieldBadge.addView(shieldText)

        shieldBadge.setOnClickListener {
            shieldEnabled = !shieldEnabled
            updateShieldUI()
            webView.reload()
        }

        root.addView(header, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        // Divider
        val divider = View(this).apply {
            setBackgroundColor(Color.parseColor("#222222"))
        }
        root.addView(divider, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(1)))

        // WebView
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

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

                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    if (shieldEnabled) {
                        adBlocker.injectScripts(view)
                    }
                }
            }
            webChromeClient = WebChromeClient()
            loadUrl("https://m.youtube.com")
        }
        root.addView(webView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        setContentView(root)
    }

    private fun performSearch() {
        val text = searchField.text.toString().trim()
        if (text.isEmpty()) return
        searchField.clearFocus()

        val url = if (text.contains(".") && !text.contains(" ")) {
            if (text.startsWith("http")) text else "https://$text"
        } else {
            "https://m.youtube.com/results?search_query=${java.net.URLEncoder.encode(text, "UTF-8")}"
        }
        webView.loadUrl(url)
        searchField.setText("")
    }

    private fun updateShieldUI() {
        val green = Color.parseColor("#5FCA6B")
        val gray = Color.parseColor("#888888")
        val dotBg = shieldDot.background as? GradientDrawable
        dotBg?.setColor(if (shieldEnabled) green else gray)
        shieldText.text = if (shieldEnabled) "ON" else "OFF"
        shieldText.setTextColor(if (shieldEnabled) green else gray)
        val badgeBg = shieldBadge.background as? GradientDrawable
        badgeBg?.setColor(if (shieldEnabled) Color.parseColor("#28382A") else Color.parseColor("#382828"))
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }
}
