/** Service worker — owns the effective Shield + DNR state. */

const DEFAULTS = { enabled: true }

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    chrome.storage.sync.set({ ...DEFAULTS, ...cfg })
  })
})

async function getStatus() {
  const cfg = await chrome.storage.sync.get(DEFAULTS)
  const rulesets = await chrome.declarativeNetRequest.getEnabledRulesets()
  return {
    enabled: cfg.enabled !== false && rulesets.includes('youtube_ads'),
    version: chrome.runtime.getManifest().version,
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_STATUS') {
    getStatus()
      .then(sendResponse)
      .catch((error) => sendResponse({ enabled: false, error: String(error) }))
    return true
  }

  if (msg?.type === 'SET_ENABLED') {
    ;(async () => {
      const update = msg.enabled
        ? { enableRulesetIds: ['youtube_ads'], disableRulesetIds: [] }
        : { enableRulesetIds: [], disableRulesetIds: ['youtube_ads'] }
      try {
        await chrome.declarativeNetRequest.updateEnabledRulesets(update)
        await chrome.storage.sync.set({ enabled: Boolean(msg.enabled) })
        sendResponse({ ok: true, ...(await getStatus()) })
      } catch (error) {
        sendResponse({ ok: false, enabled: false, error: String(error) })
      }
    })()
    return true
  }
  return false
})
