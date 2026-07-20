package com.noirva.app

import android.annotation.SuppressLint
import android.graphics.*
import android.graphics.drawable.Drawable
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
            fitsSystemWindows = true
        }

        // Header row
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(10))
            setBackgroundColor(Color.parseColor("#0F0F0F"))
        }

        // Shield icon — standalone green shield, no background circle
        val shieldIcon = ImageView(this).apply {
            setImageDrawable(ShieldDrawable(dp(26), Color.parseColor("#5FCA6B")))
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        val shieldIconParams = LinearLayout.LayoutParams(dp(26), dp(26))
        header.addView(shieldIcon, shieldIconParams)

        // Search pill (flex:1)
        val searchPill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val bg = GradientDrawable()
            bg.cornerRadius = dp(20).toFloat()
            bg.setColor(Color.parseColor("#242424"))
            background = bg
            setPadding(dp(14), dp(9), dp(14), dp(9))
        }
        val searchPillParams = LinearLayout.LayoutParams(0, dp(38), 1f)
        searchPillParams.marginStart = dp(10)
        header.addView(searchPill, searchPillParams)

        // Magnifying glass icon (vector drawable, gray)
        val searchIcon = ImageView(this).apply {
            setImageResource(R.drawable.ic_search)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        val searchIconParams = LinearLayout.LayoutParams(dp(16), dp(16))
        searchIconParams.marginEnd = dp(8)
        searchPill.addView(searchIcon, searchIconParams)

        searchField = EditText(this).apply {
            hint = "Search or paste a link"
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#888888"))
            setBackgroundColor(Color.TRANSPARENT)
            setBackgroundResource(0)
            textSize = 14f
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_GO
            maxLines = 1
            setPadding(0, 0, 0, 0)
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_GO) {
                    performSearch()
                    true
                } else false
            }
        }
        searchPill.addView(searchField, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        // Shield badge (green dot + ON)
        shieldBadge = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val bg = GradientDrawable()
            bg.cornerRadius = dp(20).toFloat()
            bg.setColor(Color.parseColor("#2E3830"))
            background = bg
            setPadding(dp(11), dp(8), dp(11), dp(8))
        }
        val badgeParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(32))
        badgeParams.marginStart = dp(10)
        header.addView(shieldBadge, badgeParams)

        shieldDot = View(this).apply {
            val bg = GradientDrawable()
            bg.shape = GradientDrawable.OVAL
            bg.setColor(Color.parseColor("#72CC72"))
            background = bg
        }
        shieldBadge.addView(shieldDot, LinearLayout.LayoutParams(dp(7), dp(7)))

        shieldText = TextView(this).apply {
            text = "ON"
            setTextColor(Color.parseColor("#88CC88"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
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
        shieldText.setTextColor(if (shieldEnabled) Color.parseColor("#88CC88") else gray)
        val badgeBg = shieldBadge.background as? GradientDrawable
        badgeBg?.setColor(if (shieldEnabled) Color.parseColor("#2E3830") else Color.parseColor("#382828"))
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }
}

/** Custom drawable that draws a shield shape with checkmark — matches the 1b design spec */
class ShieldDrawable(private val sizeDp: Int, private val fillColor: Int) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val darkColor = Color.parseColor("#0F0F0F")

    override fun draw(canvas: Canvas) {
        val s = bounds.width().toFloat()
        val scale = s / 26f

        // Shield path
        val shield = Path()
        shield.moveTo(13f * scale, 3f * scale)
        shield.lineTo(21f * scale, 6.5f * scale)
        shield.lineTo(21f * scale, 11.5f * scale)
        shield.cubicTo(
            21f * scale, 15.5f * scale,
            16f * scale, 19.7f * scale,
            13f * scale, 22.5f * scale
        )
        shield.cubicTo(
            10f * scale, 19.7f * scale,
            5f * scale, 15.5f * scale,
            5f * scale, 11.5f * scale
        )
        shield.close()

        paint.color = fillColor
        paint.style = Paint.Style.FILL
        canvas.drawPath(shield, paint)

        // Checkmark
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
