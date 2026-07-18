/** Origin-scoped status bridge for the Noirva desktop player gate. */

const BRIDGE_SOURCE = 'yt-ads-shield'
let lastRequestId = ''

function sendStatus(requestId = lastRequestId) {
  if (!requestId) return
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (chrome.runtime.lastError) return
    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        type: 'STATUS',
        enabled: status?.enabled === true,
        version: status?.version || chrome.runtime.getManifest().version,
        requestId,
      },
      window.location.origin,
    )
  })
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || data.source !== BRIDGE_SOURCE || data.type !== 'PING') return
  if (typeof data.requestId !== 'string' || !data.requestId) return
  lastRequestId = data.requestId
  sendStatus(data.requestId)
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) sendStatus()
})
