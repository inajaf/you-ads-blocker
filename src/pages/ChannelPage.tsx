import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getChannel, getChannelNext } from '../api/client'
import type { ChannelResponse, StreamItem } from '../api/types'
import { VideoGrid } from '../components/VideoGrid'
import { formatCount } from '../utils/format'

export function ChannelPage() {
  const { id = '' } = useParams()
  const [ch, setCh] = useState<ChannelResponse | null>(null)
  const [items, setItems] = useState<StreamItem[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let c = false
    getChannel(id)
      .then((d) => {
        if (c) return
        setCh(d)
        setItems(d.relatedStreams || [])
        setNext(d.nextpage)
      })
      .catch((e: Error) => {
        if (!c) setErr(e.message)
      })
    return () => {
      c = true
    }
  }, [id])

  if (err) return <div className="page pad-x error">{err}</div>
  if (!ch) return <div className="page muted pad">Loading…</div>

  return (
    <div className="page">
      {ch.bannerUrl && (
        <div className="banner">
          <img src={ch.bannerUrl} alt="" />
        </div>
      )}
      <div className="channel-head pad-x">
        <img className="avatar lg" src={ch.avatarUrl} alt="" />
        <div>
          <h1>{ch.name}</h1>
          <p className="muted small">
            {formatCount(ch.subscriberCount)} subscribers
          </p>
        </div>
      </div>
      <VideoGrid items={items} />
      {next && (
        <button
          type="button"
          className="btn block"
          onClick={() => {
            void getChannelNext(id, next).then((p) => {
              setItems((x) => [...x, ...(p.relatedStreams || [])])
              setNext(p.nextpage)
            })
          }}
        >
          More
        </button>
      )}
    </div>
  )
}
