import { useEffect, useRef } from 'react'

export function KofiWidget() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const load = () => {
      if (typeof window.kofiwidget2 === 'undefined') {
        const s = document.createElement('script')
        s.src = 'https://storage.ko-fi.com/cdn/widget/Widget_2.js'
        s.onload = () => {
          window.kofiwidget2.init('Fund the Project 💵', '#a855f7', 'S3G523MDAE')
          window.kofiwidget2.draw()
        }
        document.body.appendChild(s)
      } else {
        window.kofiwidget2.init('Fund the Project 💵', '#a855f7', 'S3G523MDAE')
        window.kofiwidget2.draw()
      }
    }

    load()
  }, [])

  return <div ref={ref} />
}
