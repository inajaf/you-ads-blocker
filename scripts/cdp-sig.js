(() => {
  const pr = window.ytInitialPlayerResponse
  const sd = pr && pr.streamingData
  const audio = (sd && sd.adaptiveFormats || []).filter(f => f.mimeType && f.mimeType.startsWith('audio'))
  const first = audio[0]
  let sc = null
  if (first && first.signatureCipher) {
    // signatureCipher is a query string like url=...&sp=sig&s=...
    const params = new URLSearchParams(first.signatureCipher)
    sc = {
      url: params.get('url') ? params.get('url').slice(0, 100) : null,
      sp: params.get('sp'),
      s: params.get('s') ? params.get('s').slice(0, 40) : null,
      sLen: params.get('s') ? params.get('s').length : 0,
    }
  }
  // find the player base.js script URL
  let baseJs = null
  try {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src)
    baseJs = scripts.filter(s => /\/s\/player\//.test(s) || /base\.js/.test(s))[0] || null
  } catch (e) {}
  return {
    audioFormatCount: audio.length,
    firstAudioItag: first ? first.itag : null,
    firstAudioMime: first ? first.mimeType : null,
    hasSignatureCipher: !!(first && first.signatureCipher),
    sc,
    baseJs: baseJs ? baseJs.slice(0, 90) : null,
  }
})()
