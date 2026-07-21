package com.noirva.app

import android.annotation.SuppressLint
import android.graphics.*
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
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

        header.addView(LinearLayout(this), LinearLayout.LayoutParams(
            0, dp(14), 0f))

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
            }
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
