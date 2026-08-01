'use strict'

// Pure, dependency-free tab model for the AdVoid desktop window. Kept free of
// Electron so node:test can exercise it directly (see tests/tab-model.test.mjs).

const HOME_URL = 'https://www.youtube.com/'
const DEFAULT_TITLE = 'New tab'

function isYouTubeUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return host === 'youtube.com' || host.endsWith('.youtube.com')
}

// The preload may request a new tab only for watch or Shorts URLs. Plain clicks
// never reach this predicate and continue navigating in the current tab.
function isVideoOpenUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return false
  if (url.pathname === '/watch' || url.pathname.startsWith('/watch/')) {
    return url.searchParams.has('v')
  }
  return /^\/shorts\/.+/.test(url.pathname)
}

function createTabModel({ homeUrl = HOME_URL } = {}) {
  let nextId = 1
  let tabs = []
  let activeId = null

  function findIndex(id) {
    return tabs.findIndex((tab) => tab.id === id)
  }

  function getTabs() {
    return tabs.map((tab) => ({ ...tab }))
  }

  function getTab(id) {
    const index = findIndex(id)
    return index === -1 ? null : { ...tabs[index] }
  }

  function getActiveTab() {
    return activeId === null ? null : getTab(activeId)
  }

  function isEmpty() {
    return tabs.length === 0
  }

  function selectTab(id) {
    if (findIndex(id) === -1) return false
    activeId = id
    return true
  }

  function setTitle(id, title) {
    const index = findIndex(id)
    if (index === -1) return false
    const value = typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_TITLE
    tabs[index].title = value
    return true
  }

  function setUrl(id, url) {
    const index = findIndex(id)
    if (index === -1) return false
    tabs[index].url = url
    return true
  }

  function setLoading(id, loading) {
    const index = findIndex(id)
    if (index === -1) return false
    tabs[index].loading = Boolean(loading)
    return true
  }

  // Opens a tab for url. Unless forceNew is set, an existing tab already open at
  // the exact same URL is activated instead of duplicated (browser-like "focus
  // existing"). Returns { tab, created }.
  function openTab(url, { activate = true, forceNew = false } = {}) {
    const target = typeof url === 'string' && url ? url : homeUrl
    if (!forceNew) {
      const existingIndex = tabs.findIndex((tab) => tab.url === target)
      if (existingIndex !== -1) {
        if (activate) activeId = tabs[existingIndex].id
        return { tab: { ...tabs[existingIndex] }, created: false }
      }
    }

    const tab = {
      id: nextId,
      url: target,
      title: DEFAULT_TITLE,
      loading: true,
      createdAt: Date.now(),
    }
    nextId += 1
    tabs.push(tab)
    if (activate) activeId = tab.id
    return { tab: { ...tab }, created: true }
  }

  // Closes a tab. If it was the active tab, the nearest neighbour to the right
  // (falling back to the left) becomes active. Returns the removed tab or null.
  function closeTab(id) {
    const index = findIndex(id)
    if (index === -1) return null
    const [removed] = tabs.splice(index, 1)
    if (activeId === id) {
      const next = tabs[Math.min(index, tabs.length - 1)]
      activeId = next ? next.id : null
    }
    return { ...removed }
  }

  return {
    DEFAULT_TITLE,
    HOME_URL,
    get activeId() {
      return activeId
    },
    closeTab,
    getActiveTab,
    getTab,
    getTabs,
    isEmpty,
    openTab,
    selectTab,
    setLoading,
    setTitle,
    setUrl,
  }
}

module.exports = {
  DEFAULT_TITLE,
  HOME_URL,
  createTabModel,
  isVideoOpenUrl,
  isYouTubeUrl,
}
