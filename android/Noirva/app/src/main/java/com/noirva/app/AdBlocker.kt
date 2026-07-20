package com.noirva.app

import android.content.Context
import android.webkit.WebView
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader

class AdBlocker(private val context: Context) {
    private val blockList = mutableListOf<String>()
    private var injectScript = ""
    private var domLayerScript = ""

    fun loadAssets() {
        blockList.addAll(loadBlockList())
        injectScript = loadAsset("inject.js")
        domLayerScript = loadAsset("dom-layer.js")
    }

    private fun loadBlockList(): List<String> {
        return try {
            val json = loadAsset("hosts.json")
            val obj = JSONObject(json)
            val block = obj.getJSONArray("block")
            (0 until block.length()).mapNotNull { block.optString(it) }
                .filter { it.isNotEmpty() }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun loadAsset(name: String): String {
        return try {
            context.assets.open(name).bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            ""
        }
    }

    fun shouldBlock(url: String): Boolean {
        return blockList.any { url.contains(it) }
    }

    fun injectScripts(webView: WebView?) {
        webView?.let { wv ->
            if (injectScript.isNotEmpty()) {
                wv.evaluateJavascript(injectScript, null)
            }
            if (domLayerScript.isNotEmpty()) {
                wv.evaluateJavascript(domLayerScript, null)
            }
        }
    }
}
