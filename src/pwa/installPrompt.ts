export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let promptEvent: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function emitChange() {
  for (const listener of listeners) listener()
}

// Capture the event at application bootstrap, before lazy routes can load.
// Chrome only provides each prompt event once, so a route-level listener can
// miss the native installer permanently for the current page load.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    promptEvent = event as BeforeInstallPromptEvent
    emitChange()
  })

  window.addEventListener('appinstalled', () => {
    promptEvent = null
    emitChange()
  })
}

export function getInstallPrompt() {
  return promptEvent
}

export function subscribeInstallPrompt(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function consumeInstallPrompt() {
  promptEvent = null
  emitChange()
}
