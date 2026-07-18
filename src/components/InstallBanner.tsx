import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Check, Download, ExternalLink, MoreVertical, Share2 } from 'lucide-react'
import {
  consumeInstallPrompt,
  getInstallPrompt,
  subscribeInstallPrompt,
} from '../pwa/installPrompt'

type InstallPlatform = 'ios' | 'android' | 'desktop'

function getInstallPlatform(): InstallPlatform {
  const ua = navigator.userAgent.toLowerCase()
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1

  if (/iphone|ipad|ipod/.test(ua) || touchMac) return 'ios'
  if (/android/.test(ua)) return 'android'
  return 'desktop'
}

function isAndroidInAppBrowser() {
  const ua = navigator.userAgent
  return /;\s*wv\)|\bwv\b|FBAN|FBAV|Instagram|GSA\/|Gmail/i.test(ua)
}

function openInAndroidChrome() {
  const target = `${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`
  const fallback = encodeURIComponent(window.location.href)
  window.location.href = `intent://${target}#Intent;scheme=${window.location.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${fallback};end`
}

function isStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  )
}

/**
 * A persistent install entry point.
 *
 * Chromium exposes a native prompt through `beforeinstallprompt`. iOS does not,
 * so the same button reveals the short Share -> Add to Home Screen flow.
 */
export function InstallBanner() {
  const deferred = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPrompt,
    () => null,
  )
  const [installed, setInstalled] = useState(() => isStandalone())
  const [showHelp, setShowHelp] = useState(false)
  const platform = useMemo(() => getInstallPlatform(), [])
  const inAppBrowser = useMemo(
    () => platform === 'android' && isAndroidInAppBrowser(),
    [platform],
  )

  useEffect(() => {
    const onInstalled = () => {
      setInstalled(true)
      setShowHelp(false)
    }
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const onDisplayModeChange = () => setInstalled(isStandalone())

    window.addEventListener('appinstalled', onInstalled)
    displayMode.addEventListener?.('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('appinstalled', onInstalled)
      displayMode.removeEventListener?.('change', onDisplayModeChange)
    }
  }, [])

  useEffect(() => {
    if (deferred) setShowHelp(false)
  }, [deferred])

  if (installed) {
    return (
      <aside className="install-banner install-banner-installed" aria-label="App installed">
        <div className="install-banner-icon install-banner-success" aria-hidden="true">
          <Check size={22} strokeWidth={2.4} />
        </div>
        <div className="install-banner-copy">
          <strong>Noirva is installed</strong>
          <p className="muted small install-banner-description">
            Open it from your Home Screen like any other app.
          </p>
        </div>
      </aside>
    )
  }

  const showNativePrompt = async () => {
    if (!deferred) {
      if (inAppBrowser) {
        openInAndroidChrome()
        return
      }
      setShowHelp((value) => !value)
      return
    }

    await deferred.prompt()
    const choice = await deferred.userChoice
    consumeInstallPrompt()
    if (choice.outcome === 'accepted') {
      setInstalled(true)
    } else {
      setShowHelp(true)
    }
  }

  const isIos = platform === 'ios'
  const buttonLabel = isIos
    ? 'How to install'
    : inAppBrowser
      ? 'Open in Chrome'
      : deferred
        ? 'Install now'
        : 'Install app'

  return (
    <aside className="install-banner" aria-labelledby="install-banner-title">
      <div className="install-banner-icon" aria-hidden="true">
        {isIos ? (
          <Share2 size={22} strokeWidth={2} />
        ) : (
          <Download size={22} strokeWidth={2} />
        )}
      </div>
      <div className="install-banner-copy">
        <strong id="install-banner-title">Install Noirva on your phone</strong>
        <p className="muted small install-banner-description">
          Add it to your Home Screen for one-tap access and a full-screen app view.
        </p>
      </div>
      <div className="install-actions">
        <button
          type="button"
          className="btn install-primary"
          onClick={() => void showNativePrompt()}
          aria-expanded={showHelp}
          aria-controls="install-help"
        >
          {inAppBrowser ? (
            <ExternalLink size={17} strokeWidth={2} aria-hidden="true" />
          ) : isIos && !deferred ? (
            <Share2 size={17} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Download size={17} strokeWidth={2} aria-hidden="true" />
          )}
          {buttonLabel}
        </button>
      </div>

      {showHelp && (
        <div id="install-help" className="install-help" role="status">
          {isIos ? (
            <ol>
              <li>
                Tap <Share2 size={16} aria-hidden="true" /> <strong>Share</strong> in your browser.
              </li>
              <li>Choose <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong>.</li>
            </ol>
          ) : (
            <div className="install-preparing">
              <MoreVertical size={18} aria-hidden="true" />
              <p>
                {inAppBrowser ? (
                  <>
                    This QR opened inside another app. Android blocks PWA installation
                    there. Press <strong>Open in Chrome</strong>, then install from the
                    same button.
                  </>
                ) : (
                  <>
                    Chrome is preparing the secure installer. Keep this page open for
                    about 30 seconds, tap the page once, then press{' '}
                    <strong>Install app</strong> again. The system install window will
                    open directly.
                  </>
                )}
              </p>
            </div>
          )}
          {isIos && (
            <p className="install-help-note">
              iPhone does not provide an automatic web-app install button; Apple requires
              this Share flow.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
