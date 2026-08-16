(() => {
  const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src)
  return {
    playerScripts: scripts.filter(s => /\/s\/player\//.test(s)).map(s => s.slice(0, 110)),
    baseJs: scripts.find(s => /base\.js$/.test(s)) || null,
  }
})()
