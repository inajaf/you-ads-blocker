'use strict'

// Renderer for the AdVoid tab strip. Talks to the main process through the
// contextBridge API exposed by tab-strip-preload.js (window.advoidTabs). This
// is deliberately plain DOM code with no framework.

function titleFor(url, title) {
  const value = title && title.trim() ? title.trim() : null
  if (value) return value
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function renderStrip(container, state) {
  const tabs = Array.isArray(state?.tabs) ? state.tabs : []
  const activeId = state?.activeId ?? null

  container.textContent = ''

  for (const tab of tabs) {
    const item = document.createElement('div')
    item.className = 'tab' + (tab.id === activeId ? ' active' : '')
    item.setAttribute('role', 'tab')
    item.setAttribute('aria-selected', String(tab.id === activeId))
    item.title = tab.url

    if (tab.loading) {
      const spinner = document.createElement('span')
      spinner.className = 'spinner'
      spinner.setAttribute('aria-hidden', 'true')
      item.appendChild(spinner)
    } else {
      const favicon = document.createElement('span')
      favicon.className = 'favicon'
      favicon.setAttribute('aria-hidden', 'true')
      item.appendChild(favicon)
    }

    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = titleFor(tab.url, tab.title)
    item.appendChild(label)

    const close = document.createElement('button')
    close.className = 'close'
    close.title = 'Close tab (Cmd/Ctrl+W)'
    close.setAttribute('aria-label', 'Close tab ' + titleFor(tab.url, tab.title))
    close.textContent = '\u00d7'
    close.addEventListener('click', (event) => {
      event.stopPropagation()
      window.advoidTabs.closeTab(tab.id)
    })
    item.appendChild(close)

    item.addEventListener('click', () => {
      window.advoidTabs.selectTab(tab.id)
    })

    container.appendChild(item)
    if (tab.id === activeId) {
      item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }
}

function init() {
  const platform = new URLSearchParams(window.location.search).get('platform')
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') {
    document.body.dataset.platform = platform
  }

  const tabs = document.getElementById('tabs')
  const newTab = document.getElementById('new-tab')
  if (!window.advoidTabs || !tabs || !newTab) return

  window.advoidTabs.onState((state) => renderStrip(tabs, state))
  window.advoidTabs.getState().then((state) => {
    if (state) renderStrip(tabs, state)
  }).catch((error) => {
    console.error('Failed to load initial tab state:', error)
  })
  newTab.addEventListener('click', () => window.advoidTabs.newTab())
}

document.addEventListener('DOMContentLoaded', init)
