import type { StreamItem } from '../api/types'
import { VideoCard } from './VideoCard'

export function VideoGrid({ items }: { items: StreamItem[] }) {
  if (!items.length) return <p className="empty">No videos</p>
  return (
    <div className="grid">
      {items.map((item, i) => (
        <VideoCard key={`${item.url}-${i}`} item={item} />
      ))}
    </div>
  )
}
