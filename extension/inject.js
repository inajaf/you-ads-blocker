/**
 * MAIN world (page context) — same technique family as many YT adblock scripts:
 * strip ad config from player responses before the player schedules ads.
 * Runs on real youtube.com; user keeps their Google login & recommendations.
 */
;(() => {
  const ENABLED_KEY = '__ytAdsShieldEnabled'
  const STATE_EVENT = 'yt-ads-shield:state'
  // Start disabled until the isolated content script publishes the saved setting.
  window[ENABLED_KEY] = false
  window.addEventListener(STATE_EVENT, (event) => {
    window[ENABLED_KEY] = event?.detail?.enabled === true
  })

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
      // Remove some ad-ish shelf renderers if present
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

  // Patch JSON.parse used by YT sometimes for player payloads
  const nativeParse = JSON.parse
  JSON.parse = function patchedParse(text, reviver) {
    const value = nativeParse.call(this, text, reviver)
    if (!window[ENABLED_KEY]) return value
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

  // ytInitialPlayerResponse / ytInitialData globals
  function hookInitial() {
    try {
      if (!window[ENABLED_KEY]) return
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
  // YT sets these slightly later on some navigations
  const iv = setInterval(hookInitial, 50)
  setTimeout(() => clearInterval(iv), 5000)

  // Fetch/XHR: strip ads from player API responses
  const nativeFetch = window.fetch
  window.fetch = async function patchedFetch(input, init) {
    const res = await nativeFetch.apply(this, arguments)
    try {
      if (!window[ENABLED_KEY]) return res
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

  const XO = XMLHttpRequest.prototype.open
  const XS = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__yasUrl = url
    return XO.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        if (!window[ENABLED_KEY]) return
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

  console.info('[YT Ads Shield] page hooks active')
})()
