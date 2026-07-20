package com.noirva.app

import android.annotation.SuppressLint
import android.graphics.*
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.webkit.*
import android.widget.*
import android.app.Activity

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var adBlocker: AdBlocker
    private var shieldEnabled = true
    private var blockedCount = 0
    private lateinit var shieldToggle: FrameLayout
    private lateinit var shieldKnob: View
    private lateinit var statusLabel: TextView
    private lateinit var shieldIcon: ImageView

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

        // Header container with gradient
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(14))
            setBackgroundColor(Color.parseColor("#0F0F0F"))
        }
        // Gradient overlay
        val gradientDrawable = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(Color.parseColor("#1A201A"), Color.parseColor("#0F0F0F"))
        )
        header.background = gradientDrawable

        // Row 1: App name + search button
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val appName = TextView(this).apply {
            text = "Noirva"
            setTextColor(Color.WHITE)
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
        }
        row1.addView(appName, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        // Search button (36x36 circle)
        val searchBtn = ImageView(this).apply {
            setImageResource(R.drawable.ic_search)
            val bg = GradientDrawable()
            bg.shape = GradientDrawable.RECTANGLE
            bg.cornerRadius = dp(18).toFloat()
            bg.setColor(Color.parseColor("#0FFFFFFF"))
            background = bg
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setColorFilter(Color.WHITE)
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        row1.addView(searchBtn, LinearLayout.LayoutParams(dp(36), dp(36)))

        header.addView(row1, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        // Row 2: Status card
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(10))
            val bg = GradientDrawable()
            bg.cornerRadius = dp(12).toFloat()
            bg.setColor(Color.parseColor("#0DFFFFFF"))
            bg.setStroke(1, Color.parseColor("#12FFFFFF"))
            background = bg
        }
        val cardParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(48))
        cardParams.topMargin = dp(10)
        header.addView(card, cardParams)

        // Shield icon (28x28)
        shieldIcon = ImageView(this).apply {
            setImageDrawable(ShieldDrawable(dp(28), Color.parseColor("#5FCA6B")))
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        card.addView(shieldIcon, LinearLayout.LayoutParams(dp(28), dp(28)))

        // Status text column
        val statusCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        val statusColParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        statusColParams.marginStart = dp(12)
        card.addView(statusCol, statusColParams)

        val protectionLabel = TextView(this).apply {
            text = "Protection active"
            setTextColor(Color.WHITE)
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
        }
        statusCol.addView(protectionLabel)

        statusLabel = TextView(this).apply {
            text = "0 ads blocked this session"
            setTextColor(Color.parseColor("#9A9A9A"))
            textSize = 11.5f
        }
        statusCol.addView(statusLabel)

        // Toggle switch (40x24)
        shieldToggle = FrameLayout(this).apply {
            val bg = GradientDrawable()
            bg.cornerRadius = dp(12).toFloat()
            bg.setColor(Color.parseColor("#5FCA6B"))
            background = bg
        }
        val toggleParams = LinearLayout.LayoutParams(dp(40), dp(24))
        card.addView(shieldToggle, toggleParams)

        // Toggle knob (18x18 circle)
        shieldKnob = View(this).apply {
            val bg = GradientDrawable()
            bg.shape = GradientDrawable.OVAL
            bg.setColor(Color.parseColor("#0F0F0F"))
            background = bg
        }
        shieldToggle.addView(shieldKnob, FrameLayout.LayoutParams(dp(18), dp(18)))

        // Position knob to right (on state)
        shieldToggle.post {
            val knobParams = shieldKnob.layoutParams as FrameLayout.LayoutParams
            knobParams.gravity = Gravity.END or Gravity.CENTER_VERTICAL
            shieldKnob.layoutParams = knobParams
        }

        val toggleTap = object : Runnable {
            override fun run() { toggleShield() }
        }
        shieldToggle.setOnClickListener { toggleShield() }
        shieldIcon.setOnClickListener { toggleShield() }

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

    private fun toggleShield() {
        shieldEnabled = !shieldEnabled
        updateShieldUI()
        animateShield()
        statusLabel.text = "$blockedCount ads blocked this session"
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
        val bg = shieldToggle.background as? GradientDrawable
        bg?.setColor(if (shieldEnabled) Color.parseColor("#5FCA6B") else Color.parseColor("#888888"))
        val knobBg = shieldKnob.background as? GradientDrawable
        knobBg?.setColor(Color.parseColor("#0F0F0F"))
        val knobParams = shieldKnob.layoutParams as? FrameLayout.LayoutParams
        if (shieldEnabled) {
            knobParams?.gravity = Gravity.END or Gravity.CENTER_VERTICAL
        } else {
            knobParams?.gravity = Gravity.START or Gravity.CENTER_VERTICAL
        }
        shieldKnob.layoutParams = knobParams
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
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
