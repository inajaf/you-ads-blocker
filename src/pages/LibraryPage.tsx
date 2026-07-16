import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listHistory,
  listLikes,
  listWatchLater,
  removeHistory,
} from '../store/library'
import type { HistoryEntry, LikeEntry, WatchLaterEntry } from '../store/db'
import { formatDuration } from '../utils/format'

type Tab = 'history' | 'likes' | 'later'

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>('history')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [likes, setLikes] = useState<LikeEntry[]>([])
  const [later, setLater] = useState<WatchLaterEntry[]>([])

  const reload = async () => {
    setHistory(await listHistory())
    setLikes(await listLikes())
    setLater(await listWatchLater())
  }

  useEffect(() => {
    void reload()
  }, [])

  const rows =
    tab === 'history' ? history : tab === 'likes' ? likes : later

  return (
    <div className="page pad-x">
      <header className="top">
        <h1>Library</h1>
        <span className="muted small">Only on this device</span>
      </header>
      <div className="tabs">
        {(
          [
            ['history', 'History'],
            ['likes', 'Liked'],
            ['later', 'Later'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            className={`tab${tab === k ? ' on' : ''}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {!rows.length && <p className="empty">Empty — watch or save videos</p>}
      {tab === 'history' &&
        history.map((h) => (
          <Row
            key={h.videoId}
            id={h.videoId}
            title={h.title}
            thumb={h.thumbnail}
            sub={
              h.duration
                ? `${formatDuration(h.progressSec)} / ${formatDuration(h.duration)}`
                : h.uploader
            }
            onRemove={() => void removeHistory(h.videoId).then(reload)}
          />
        ))}
      {tab === 'likes' &&
        likes.map((h) => (
          <Row
            key={h.videoId}
            id={h.videoId}
            title={h.title}
            thumb={h.thumbnail}
            sub={h.uploader}
          />
        ))}
      {tab === 'later' &&
        later.map((h) => (
          <Row
            key={h.videoId}
            id={h.videoId}
            title={h.title}
            thumb={h.thumbnail}
            sub={h.uploader}
          />
        ))}
    </div>
  )
}

function Row({
  id,
  title,
  thumb,
  sub,
  onRemove,
}: {
  id: string
  title: string
  thumb: string
  sub?: string
  onRemove?: () => void
}) {
  return (
    <div className="lib-row">
      <Link to={`/watch/${id}`} className="lib-main">
        <img src={thumb} alt="" />
        <div>
          <div className="title">{title}</div>
          <div className="muted small">{sub}</div>
        </div>
      </Link>
      {onRemove && (
        <button type="button" className="x" onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  )
}
