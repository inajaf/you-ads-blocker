const R = 'tubepwa.region'

export function getRegion() {
  try {
    return localStorage.getItem(R) || 'US'
  } catch {
    return 'US'
  }
}

export function setRegion(r: string) {
  try {
    localStorage.setItem(R, r)
  } catch {
    /* ignore */
  }
}

export function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem('tubepwa.search')
    return raw ? (JSON.parse(raw) as string[]).slice(0, 20) : []
  } catch {
    return []
  }
}

export function pushSearch(q: string) {
  const t = q.trim()
  if (!t) return
  const next = [t, ...getSearchHistory().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(
    0,
    20,
  )
  try {
    localStorage.setItem('tubepwa.search', JSON.stringify(next))
  } catch {
    /* ignore */
  }
}
