import { useSyncExternalStore } from 'react'
import { RefreshCw, X } from 'lucide-react'
import {
  applyUpdate,
  dismissUpdate,
  getUpdateReady,
  subscribeUpdateReady,
} from '../pwa/updatePrompt'

/**
 * Toast shown when a new app build is waiting. Reloading swaps in the new
 * service worker; dismissing keeps the current version until the next check.
 */
export function UpdateToast() {
  const ready = useSyncExternalStore(
    subscribeUpdateReady,
    getUpdateReady,
    () => false,
  )

  if (!ready) return null

  return (
    <div className="update-toast" role="status" aria-live="polite">
      <div className="update-toast-icon" aria-hidden="true">
        <RefreshCw size={18} strokeWidth={2.2} />
      </div>
      <div className="update-toast-copy">
        <strong>New version available</strong>
        <p className="muted small">Reload to get the latest TubePWA.</p>
      </div>
      <div className="update-toast-actions">
        <button
          type="button"
          className="btn update-toast-reload"
          onClick={() => applyUpdate()}
        >
          Reload
        </button>
        <button
          type="button"
          className="update-toast-dismiss"
          onClick={() => dismissUpdate()}
          aria-label="Dismiss update"
        >
          <X size={18} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}
