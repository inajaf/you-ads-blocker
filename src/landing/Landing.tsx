import { useEffect, useRef, useState } from 'react'
import { LAYERS, MARQUEE_ITEMS, STEPS } from './content'
import { detectPlatform, type DetectedPlatform } from './detectPlatform'
import { FAQS, faqVisual, toggleFaq } from './faq'
import {
  DOWNLOAD_PLATFORMS,
  PLATFORMS,
  orderByDetectedPlatform,
  type Platform,
  type PlatformIcon,
} from './platforms'
import { useRevealOnScroll } from './useRevealOnScroll'
import './landing.css'

/** Inline Apple logo — the exported design's Apple glyph was empty (see notes). */
function AppleMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 384 512"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  )
}

/** Small icon used inline in a hero button (Apple mark scales via `.nv-apple`'s 1em sizing). */
function HeroPlatformIcon({ icon }: { icon: PlatformIcon }) {
  if (icon === 'apple') return <AppleMark className="nv-apple" />
  return <span style={{ fontSize: '19px' }}>▲</span>
}

/** Icon used inside a `.nv-dl-card`, which sets its own icon font-size. */
function CardPlatformIcon({ icon }: { icon: PlatformIcon }) {
  if (icon === 'apple') return <AppleMark className="nv-apple" />
  return <>▲</>
}

const PRIMARY_DOWNLOAD =
  DOWNLOAD_PLATFORMS.find((p) => p.primary) ?? DOWNLOAD_PLATFORMS[0]

/** One #download card, rendered as a real download or a source-build entry per `platform.kind`. */
function PlatformCard({ platform }: { platform: Platform }) {
  return (
    <div
      className={`nv-dl-card${platform.kind === 'source' ? ' nv-dl-card-source' : ''}`}
      data-reveal
    >
      <div className="nv-dl-icon">
        <CardPlatformIcon icon={platform.icon} />
      </div>
      <h3 className="nv-dl-title nv-display">{platform.name}</h3>
      <p className="nv-dl-meta nv-mono">{platform.spec}</p>
      {platform.kind === 'download' ? (
        <>
          <a
            className={`nv-btn ${platform.primary ? 'nv-btn-primary' : 'nv-btn-ghost'} nv-dl-btn`}
            href={platform.href}
          >
            {platform.downloadLabel}
          </a>
          {platform.note && <p className="nv-dl-note nv-mono">{platform.note}</p>}
        </>
      ) : (
        <p className="nv-dl-body">
          {platform.bodyPrefix}
          <code>{platform.codePath}</code>
          {platform.bodySuffix}
        </p>
      )}
    </div>
  )
}

export function Landing() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())
  const [detected, setDetected] = useState<DetectedPlatform>('unknown')

  useRevealOnScroll(rootRef)

  // Detect the visitor's OS client-side only, after mount, so the
  // server/build-time render stays deterministic (default order, no flash
  // of mismatched content before hydration).
  useEffect(() => {
    setDetected(detectPlatform())
  }, [])

  const heroPlatforms = orderByDetectedPlatform(DOWNLOAD_PLATFORMS, detected)

  // Load the marketing fonts scoped to this page (not the app's global head).
  // Created here and removed on unmount so the app shell stays unaffected.
  useEffect(() => {
    const links: HTMLLinkElement[] = []
    const add = (attrs: Partial<HTMLLinkElement> & { href: string }) => {
      const link = document.createElement('link')
      Object.assign(link, attrs)
      document.head.appendChild(link)
      links.push(link)
    }
    add({ rel: 'preconnect', href: 'https://fonts.googleapis.com' })
    add({ rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' })
    add({
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap',
    })
    return () => {
      for (const link of links) link.remove()
    }
  }, [])

  // Duplicate the marquee list so the -50% translate loops seamlessly.
  const marquee = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS]

  return (
    <div className="noirva-landing" ref={rootRef}>
      {/* NAV */}
      <nav className="nv-nav">
        <div className="nv-brand">
          <div className="nv-logo">
            <div className="nv-logo-dot" />
          </div>
          <span className="nv-brand-name nv-display">Noirva</span>
        </div>
        <div className="nv-nav-links">
          <a className="nv-nav-link" href="#how">
            How it works
          </a>
          <a className="nv-nav-link" href="#layers">
            Protection
          </a>
          <a className="nv-nav-link" href="#faq">
            FAQ
          </a>
          <a className="nv-nav-cta" href="#download">
            Download
          </a>
        </div>
      </nav>

      {/* HERO */}
      <header className="nv-hero">
        <div className="nv-glow nv-glow-red" />
        <div className="nv-glow nv-glow-purple" />
        <div className="nv-grid-bg" />

        <div className="nv-hero-inner">
          <div className="nv-badge nv-mono" data-reveal>
            <span className="nv-badge-dot" />
            v1.0.0 · {DOWNLOAD_PLATFORMS.map((p) => p.name).join(' & ')}
          </div>
          <h1 className="nv-hero-title nv-display" data-reveal>
            Ad-free YouTube,
            <br />
            <span className="nv-gradient-text">redefined.</span>
          </h1>
          <p className="nv-hero-sub" data-reveal>
            Noirva blocks ads at the network level, filters API responses, and
            cleans up the DOM — all while keeping your browsing completely
            private.
          </p>
          <div className="nv-hero-actions" data-reveal>
            {heroPlatforms.map((platform, i) => (
              <a
                key={platform.id}
                className={`nv-btn ${i === 0 ? 'nv-btn-primary' : 'nv-btn-ghost'}`}
                href={platform.href}
              >
                <HeroPlatformIcon icon={platform.icon} /> {platform.ctaLabel}
              </a>
            ))}
          </div>

          {/* Hero device mock: before/after ad-free */}
          <div className="nv-mock" data-reveal>
            <div className="nv-mock-frame">
              <div className="nv-mock-bar">
                <span className="nv-dot nv-dot-red" />
                <span className="nv-dot nv-dot-yellow" />
                <span className="nv-dot nv-dot-green" />
                <span className="nv-mock-url nv-mono">
                  youtube.com · protected by Noirva
                </span>
              </div>
              <div className="nv-mock-body">
                <div>
                  <div className="nv-mock-player">
                    <div className="nv-scan" />
                    <span className="nv-mock-caption nv-mono">
                      video · no pre-roll ad
                    </span>
                  </div>
                  <div className="nv-bar nv-bar-title" />
                  <div className="nv-bar nv-bar-sub" />
                </div>
                <div className="nv-mock-side">
                  <div className="nv-mock-row">
                    <div className="nv-mock-thumb" />
                    <div className="nv-mock-lines">
                      <div className="nv-line nv-line-a" />
                      <div className="nv-line nv-line-b" />
                    </div>
                  </div>
                  <div className="nv-mock-blocked">
                    <span style={{ fontSize: '15px' }}>🚫</span>
                    <span className="nv-mock-blocked-label nv-mono">
                      sponsored — blocked
                    </span>
                    <span className="nv-mock-blocked-dot" />
                  </div>
                  <div className="nv-mock-row">
                    <div className="nv-mock-thumb" />
                    <div className="nv-mock-lines">
                      <div
                        className="nv-line nv-line-a"
                        style={{ width: '82%' }}
                      />
                      <div
                        className="nv-line nv-line-b"
                        style={{ width: '60%' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* MARQUEE */}
      <div className="nv-marquee">
        <div className="nv-marquee-track nv-mono">
          {marquee.map((item, i) => (
            <span className="nv-marquee-item" key={`${item}-${i}`}>
              {item} <span className="nv-marquee-sep">✦</span>
            </span>
          ))}
        </div>
      </div>

      {/* LAYERS */}
      <section id="layers" className="nv-section">
        <div className="nv-kicker" data-reveal>
          <span className="nv-eyebrow nv-mono">
            // THREE LAYERS OF PROTECTION
          </span>
        </div>
        <h2 className="nv-h2 nv-display" data-reveal>
          A multi-layered defense so you never see an ad again
        </h2>
        <p className="nv-lead" data-reveal>
          Every request passes through three independent gates. If one misses,
          the next catches it.
        </p>

        {/* animated pipeline */}
        <div className="nv-pipeline" data-reveal>
          <div className="nv-pipeline-track" />
          <span className="nv-pipeline-caption nv-mono">
            incoming ad request →
          </span>
          <div className="nv-gate" style={{ left: '31%' }}>
            <div className="nv-gate-bar" />
            <span className="nv-gate-label nv-mono">Network</span>
          </div>
          <div className="nv-gate" style={{ left: '62%' }}>
            <div className="nv-gate-bar" style={{ animationDelay: '1.8s' }} />
            <span className="nv-gate-label nv-mono">API</span>
          </div>
          <div className="nv-gate" style={{ left: '92%' }}>
            <div className="nv-gate-bar" style={{ animationDelay: '3.4s' }} />
            <span className="nv-gate-label nv-mono">DOM</span>
          </div>
          <div className="nv-packet nv-packet-1" />
          <div className="nv-packet nv-packet-2" />
          <div className="nv-packet nv-packet-3" />
        </div>

        <div className="nv-cards">
          {LAYERS.map((layer) => (
            <div className="nv-card" data-reveal key={layer.num}>
              <div className="nv-card-glow" />
              <div className="nv-card-num nv-mono">
                0{layer.num}
              </div>
              <div className="nv-card-icon">{layer.icon}</div>
              <h3 className="nv-card-title nv-display">{layer.title}</h3>
              <p className="nv-card-body">{layer.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="nv-how">
        <div className="nv-how-inner">
          <div className="nv-kicker" data-reveal>
            <span className="nv-eyebrow nv-mono">// HOW IT WORKS</span>
          </div>
          <h2 className="nv-h2 nv-how-title nv-display" data-reveal>
            From tap to ad-free
          </h2>
          <div className="nv-steps">
            {STEPS.map((step) => (
              <div className="nv-step" data-reveal key={step.num}>
                <div className="nv-step-num nv-display">{step.num}</div>
                <div>
                  <h3 className="nv-step-title nv-display">{step.title}</h3>
                  <p className="nv-step-body">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DOWNLOAD */}
      <section id="download" className="nv-download">
        <h2 className="nv-h2 nv-display" data-reveal>
          Get Noirva
        </h2>
        <p className="nv-lead" data-reveal>
          Available for Android and macOS. iOS available as source.
        </p>
        <div className="nv-download-grid">
          {PLATFORMS.map((platform) => (
            <PlatformCard key={platform.id} platform={platform} />
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="nv-faq">
        <h2 className="nv-h2 nv-faq-title nv-display" data-reveal>
          Frequently asked questions
        </h2>
        <div className="nv-faq-list">
          {FAQS.map((faq, i) => {
            const isOpen = open.has(i)
            const visual = faqVisual(isOpen)
            const panelId = `nv-faq-panel-${i}`
            return (
              <div className="nv-faq-item" data-reveal key={faq.q}>
                <button
                  type="button"
                  className="nv-faq-q"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen((prev) => toggleFaq(prev, i))}
                >
                  {faq.q}
                  <span
                    className="nv-faq-icon"
                    style={{ transform: visual.rotation }}
                    aria-hidden="true"
                  >
                    +
                  </span>
                </button>
                <div
                  className="nv-faq-panel"
                  id={panelId}
                  style={{ maxHeight: visual.maxHeight }}
                >
                  <p className="nv-faq-a">{faq.a}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* CTA STRIP */}
      <section className="nv-cta-wrap">
        <div className="nv-cta" data-reveal>
          <div className="nv-cta-glow" />
          <h2 className="nv-cta-title nv-display">Watch without the wait.</h2>
          <p className="nv-cta-sub">Free. Open source. No tracking, ever.</p>
          <a className="nv-btn nv-cta-btn" href={PRIMARY_DOWNLOAD.href}>
            Download Noirva
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="nv-footer">
        <div className="nv-footer-brand">
          <div className="nv-footer-logo">
            <div className="nv-footer-logo-dot" />
          </div>
          <div>
            <div className="nv-footer-name nv-display">Noirva</div>
            <div className="nv-footer-tag">Ad-free YouTube, redefined.</div>
          </div>
        </div>
        <div className="nv-footer-links">
          <a
            className="nv-footer-link"
            href="https://github.com/inajaf/you-ads-blocker"
          >
            GitHub
          </a>
          <span className="nv-license nv-mono">MIT License</span>
        </div>
      </footer>
    </div>
  )
}
