import { registerSW } from 'virtual:pwa-register'

// Mirrors the installPrompt store pattern: a tiny external store the UI reads
// with useSyncExternalStore. `needRefresh` flips true when a new build has been
// downloaded and is waiting to activate.

let needRefresh = false
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

function emitChange() {
  for (const listener of listeners) listener()
}

// How often an installed PWA re-checks the server for a newer build. The browser
// also checks on navigation, but a long-lived standalone window may not navigate
// for hours, so poll as well.
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

if (typeof window !== 'undefined') {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true
      emitChange()
    },
    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) return
      setInterval(() => {
        // Transient failures (offline, etc.) are fine — the next tick retries.
        void registration.update().catch(() => undefined)
      }, UPDATE_CHECK_INTERVAL)
    },
  })
}

export function getUpdateReady() {
  return needRefresh
}

export function subscribeUpdateReady(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Activate the waiting worker and reload into the new version. */
export function applyUpdate() {
  needRefresh = false
  emitChange()
  void updateSW?.(true)
}

/** Keep running the current version; the toast can reappear on the next check. */
export function dismissUpdate() {
  needRefresh = false
  emitChange()
}
