const checkbox = document.getElementById('enabled')
const dot = document.getElementById('dot')

function paint(enabled) {
  checkbox.checked = enabled
  dot.classList.toggle('off', !enabled)
}

chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (cfg) => {
  paint(cfg?.enabled !== false)
})

checkbox.addEventListener('change', () => {
  const enabled = checkbox.checked
  paint(enabled)
  chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled })
  // Reload active YouTube tab so hooks re-apply cleanly
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs[0]
    if (
      t?.id &&
      /youtube\.com|youtu\.be|localhost|127\.0\.0\.1|ngrok-free\.app|ngrok\.app/.test(
        t.url || '',
      )
    ) {
      chrome.tabs.reload(t.id)
    }
  })
})
