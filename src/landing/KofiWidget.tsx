import { useEffect, useRef } from 'react'

export function KofiWidget() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const script = document.createElement('script')
    script.src = 'https://storage.ko-fi.com/cdn/widget/Widget_2.js'
    script.async = true
    script.onload = () => {
      if (typeof window.kofiwidget2 !== 'undefined') {
        window.kofiwidget2.draw()
      }
    }
    container.appendChild(script)

    return () => {
      script.remove()
    }
  }, [])

  return (
    <div className="nv-kofi" data-reveal>
      <div className="nv-kofi-inner">
        <div id="kofi-widget" ref={containerRef} />
      </div>
    </div>
  )
}
