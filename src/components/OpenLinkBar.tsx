import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Link2 } from 'lucide-react'
import { extractVideoId } from '../api/client'

/** Optional convenience: paste youtube.com link → open in this PWA player. */
export function OpenLinkBar() {
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')
  const nav = useNavigate()

  return (
    <form
      className="open-link"
      aria-label="Open a YouTube video"
      onSubmit={(e) => {
        e.preventDefault()
        const id = extractVideoId(value)
        if (!id) {
          setErr('Not a valid YouTube link')
          return
        }
        setErr('')
        nav(`/watch/${id}`)
      }}
    >
      <label className="open-link-label" htmlFor="youtube-video-url">
        <Link2 size={18} strokeWidth={2} aria-hidden="true" />
        <span>Open a YouTube link</span>
      </label>
      <div className="open-link-control">
        <input
          id="youtube-video-url"
          name="youtube-video-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://youtube.com/watch?v=..."
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setErr('')
          }}
          enterKeyHint="go"
          aria-invalid={Boolean(err)}
          aria-describedby={err ? 'youtube-video-url-error' : undefined}
        />
        <button type="submit" className="btn open-link-submit">
          <span>Open</span>
          <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {err && (
        <span
          id="youtube-video-url-error"
          className="open-link-err"
          role="alert"
        >
          {err}
        </span>
      )}
    </form>
  )
}
