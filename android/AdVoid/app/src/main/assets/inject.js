/**
 * Shared json-prune script (Brave/uBO technique #2). Runs in the page's MAIN
 * world at document-start on real youtube.com, stripping ad config from player
 * responses before the player can schedule ads. User keeps their Google login,
 * subscriptions, history and recommendations.
 *
 * Ported from extension/inject.js but ALWAYS ON — the native wrappers
 * (Electron preload, Android addDocumentStartJavaScript) are dedicated ad-free
 * clients, so there is no enable/disable toggle to gate on.
 *
 * Single source of truth: consumed by desktop/ (read at runtime) and android/
 * (copied into assets by scripts/sync-adblock.mjs). Keep it dependency-free and
 * side-effect-only so it can be eval'd or injected verbatim.
 */
;(() => {
  function cleanPlayerResponse(pr) {
    if (!pr || typeof pr !== 'object') return pr
    try {
      if (pr.playerAds) pr.playerAds = []
      if (pr.adPlacements) pr.adPlacements = []
      if (pr.adSlots) pr.adSlots = []
      if (pr.adBreakHeartbeatParams) delete pr.adBreakHeartbeatParams
      if (pr.playerConfig?.audioConfig) {
        pr.playerConfig.audioConfig.autoplay = true
      }
      // streamingData and access-control responses stay untouched.
    } catch {
      /* ignore */
    }
    return pr
  }

  function cleanInitialData(data) {
    if (!data || typeof data !== 'object') return data
    try {
      const removeAds = (obj) => {
        if (!obj || typeof obj !== 'object') return
        if (Array.isArray(obj)) {
          for (let i = obj.length - 1; i >= 0; i--) {
            const it = obj[i]
            const key = it && Object.keys(it)[0]
            if (
              key &&
              /adSlot|adsense|promotedSparkles|bannerPromo|inFeedAd|adPlacement|pageTopAd/i.test(
                key,
              )
            ) {
              obj.splice(i, 1)
              continue
            }
            removeAds(it)
          }
          return
        }
        for (const k of Object.keys(obj)) {
          if (/adSlot|playerAds|adPlacements|adBreaks/i.test(k)) {
            delete obj[k]
            continue
          }
          removeAds(obj[k])
        }
      }
      removeAds(data)
    } catch {
      /* ignore */
    }
    return data
  }

  // Patch JSON.parse — YT parses player payloads through it on navigations.
  const nativeParse = JSON.parse
  JSON.parse = function patchedParse(text, reviver) {
    const value = nativeParse.call(this, text, reviver)
    if (value && typeof value === 'object') {
      if (value.playerResponse) {
        value.playerResponse = cleanPlayerResponse(value.playerResponse)
      }
      if (value.adPlacements || value.playerAds) {
        cleanPlayerResponse(value)
      }
    }
    return value
  }

  // ytInitialPlayerResponse / ytInitialData globals (set slightly late on some navs).
  function hookInitial() {
    try {
      if (window.ytInitialPlayerResponse) {
        window.ytInitialPlayerResponse = cleanPlayerResponse(
          window.ytInitialPlayerResponse,
        )
      }
      if (window.ytInitialData) {
        window.ytInitialData = cleanInitialData(window.ytInitialData)
      }
    } catch {
      /* ignore */
    }
  }

  hookInitial()
  const iv = setInterval(hookInitial, 50)
  setTimeout(() => clearInterval(iv), 5000)

  // Fetch: strip ads from player API responses.
  const nativeFetch = window.fetch
  window.fetch = async function patchedFetch(input, init) {
    const res = await nativeFetch.apply(this, arguments)
    try {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (!/\/youtubei\/v1\/player|\/get_video_info|player\?/.test(url)) {
        return res
      }
      const clone = res.clone()
      const data = await clone.json()
      cleanPlayerResponse(data)
      if (data.response) cleanPlayerResponse(data.response)
      return new Response(JSON.stringify(data), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      })
    } catch {
      return res
    }
  }

  // XHR: strip ads from player API responses.
  const XO = XMLHttpRequest.prototype.open
  const XS = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__yasUrl = url
    return XO.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        const url = String(this.__yasUrl || '')
        if (!/\/youtubei\/v1\/player|\/get_video_info/.test(url)) return
        if (this.responseType && this.responseType !== '' && this.responseType !== 'text')
          return
        const raw = this.responseText
        if (!raw) return
        const data = nativeParse(raw)
        cleanPlayerResponse(data)
        Object.defineProperty(this, 'responseText', {
          writable: true,
          value: JSON.stringify(data),
        })
      } catch {
        /* ignore */
      }
    })
    return XS.apply(this, arguments)
  }

  console.info('[Noirva Shield] page hooks active')
})()
