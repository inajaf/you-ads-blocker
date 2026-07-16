export function formatViews(n?: number) {
  if (n == null || Number.isNaN(n)) return ''
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B views`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M views`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K views`
  return `${n} views`
}

export function formatDuration(sec?: number) {
  if (sec == null || sec <= 0 || Number.isNaN(sec)) return ''
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatCount(n?: number) {
  if (n == null) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}
