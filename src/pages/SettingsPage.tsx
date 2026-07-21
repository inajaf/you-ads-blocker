import { useState } from 'react'
import { clearAll } from '../store/library'
import { getRegion, setRegion } from '../store/settings'

const REGIONS = ['US', 'GB', 'DE', 'FR', 'JP', 'IN', 'BR', 'CA']

export function SettingsPage() {
  const [region, setR] = useState(getRegion())
  const [msg, setMsg] = useState('')

  return (
    <div className="page pad-x">
      <header className="top">
        <h1>Settings</h1>
      </header>

      <section className="card">
        <h2>Install (browser link only)</h2>
        <p className="muted small">
          Open this site in Chrome / Safari → menu →{' '}
          <strong>Install app</strong> or <strong>Add to Home Screen</strong>.
          No APK, no App Store build — pure PWA.
        </p>
      </section>

      <section className="card">
        <h2>Playback &amp; ads</h2>
        <p className="muted small">
          Desktop opens the <strong>official YouTube embed</strong> only after
          AdVoid Shield confirms its filtering rules are enabled. Without the
          extension the iframe is not loaded.
        </p>
        <p className="muted small">
          Mobile uses the in-app stream player because mobile PWAs cannot
          control ads inside a cross-origin iframe. Stream metadata is resolved
          only through the app’s fixed list of trusted public Piped/Invidious
          services; sign-in, paid, DRM, age, and region controls are not bypassed.
        </p>
        <p className="muted small">
          Browse/search still use public Piped-style metadata APIs (no Google
          API keys for you). History stays on this device only.
        </p>
      </section>

      <section className="card">
        <h2>Region (trending)</h2>
        <select
          value={region}
          onChange={(e) => {
            setR(e.target.value)
            setRegion(e.target.value)
            setMsg('Region saved')
          }}
        >
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </section>

      <section className="card">
        <h2>Catalog providers</h2>
        <p className="muted small">
          The server automatically rotates a fixed HTTPS allowlist of public
          catalog providers. Custom URLs are intentionally disabled when the
          app is shared through ngrok, preventing the proxy from becoming an
          open relay.
        </p>
      </section>

      <section className="card">
        <h2>Local data</h2>
        <p className="muted small">
          History / likes / watch later stay only in this browser profile.
        </p>
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            if (!confirm('Clear all local library data?')) return
            void clearAll().then(() => setMsg('Cleared'))
          }}
        >
          Clear local data
        </button>
      </section>

      <section className="card">
        <h2>Desktop extra</h2>
        <p className="muted small">
          Run <code>npm run build:extension</code>, then load
          <code> dist-extension/</code> from Chrome’s Extensions page in
          Developer mode. The same extension protects embeds on localhost and
          supported ngrok URLs.
        </p>
      </section>

      {msg && <div className="toast">{msg}</div>}
    </div>
  )
}
