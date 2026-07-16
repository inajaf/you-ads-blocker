import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { extractVideoId } from '../api/client'

/**
 * Optional: open /import?url=… or /import?text=… with a YouTube link.
 * Also used if user lands with share params (when share_target is supported).
 */
export function ImportPage() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const raw =
    params.get('url') ||
    params.get('text') ||
    params.get('title') ||
    ''

  useEffect(() => {
    const id = extractVideoId(raw)
    if (id) nav(`/watch/${id}`, { replace: true })
  }, [raw, nav])

  const id = extractVideoId(raw)

  return (
    <div className="page pad-x">
      <header className="top">
        <h1>Open link</h1>
      </header>
      {id ? (
        <p className="muted">Opening video…</p>
      ) : (
        <>
          <p className="muted small">
            Paste a YouTube link on Home, or open{' '}
            <code>/import?url=https://youtube.com/watch?v=…</code>
          </p>
          {!raw && (
            <p className="empty">No link provided.</p>
          )}
          {raw && !id && (
            <div className="error">Could not parse a video id from that link.</div>
          )}
          <Link to="/" className="btn">
            Home
          </Link>
        </>
      )}
    </div>
  )
}
