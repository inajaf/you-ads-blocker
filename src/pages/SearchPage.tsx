import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getSuggestions, searchVideos } from '../api/client'
import type { StreamItem } from '../api/types'
import { VideoGrid } from '../components/VideoGrid'
import { getSearchHistory, pushSearch } from '../store/settings'

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const [value, setValue] = useState(q)
  const [items, setItems] = useState<StreamItem[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [sug, setSug] = useState<string[]>([])
  const [history, setHistory] = useState(getSearchHistory)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** videos filter first; fallback to all if empty */
  const [filter, setFilter] = useState<'videos' | 'all'>('videos')

  useEffect(() => {
    setValue(q)
    if (!q) {
      setItems([])
      return
    }
    let c = false
    setLoading(true)
    setErr(null)
    ;(async () => {
      try {
        let r = await searchVideos(q, null, filter)
        // If videos filter returns nothing, retry with all and normalize
        if (!r.items.length && filter === 'videos') {
          r = await searchVideos(q, null, 'all')
          if (!c) setFilter('all')
        }
        if (c) return
        setItems(r.items)
        setNext(r.nextpage)
        pushSearch(q)
        setHistory(getSearchHistory())
      } catch (e) {
        if (!c) setErr(e instanceof Error ? e.message : 'Search failed')
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [q])

  const submit = (query: string) => {
    setSug([])
    setFilter('videos')
    setParams(query ? { q: query } : {})
  }

  return (
    <div className="page pad-x">
      <header className="top">
        <h1>Search</h1>
      </header>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault()
          submit(value.trim())
        }}
      >
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (e.target.value.length >= 2) {
              void getSuggestions(e.target.value)
                .then(setSug)
                .catch(() => setSug([]))
            } else setSug([])
          }}
          placeholder="Search all videos"
          type="search"
        />
        <button type="submit" className="btn">
          Go
        </button>
      </form>
      {sug.length > 0 && (
        <ul className="suggestions">
          {sug.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => submit(s)}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!q && history.length > 0 && (
        <div className="chips">
          {history.map((h) => (
            <button key={h} type="button" className="chip" onClick={() => submit(h)}>
              {h}
            </button>
          ))}
        </div>
      )}
      {loading && <p className="muted">Searching…</p>}
      {err && <div className="error">{err}</div>}
      {!loading && q && !err && items.length === 0 && (
        <p className="empty">No video results for “{q}”.</p>
      )}
      <VideoGrid items={items} />
      {next && (
        <button
          type="button"
          className="btn block"
          onClick={() => {
            void searchVideos(q, next, filter).then((r) => {
              setItems((p) => [...p, ...r.items])
              setNext(r.nextpage)
            })
          }}
        >
          More
        </button>
      )}
    </div>
  )
}
