import { Link } from 'react-router-dom'
import type { StreamItem } from '../api/types'
import { catalogVideoId, extractChannelId, extractVideoId, isLiveCatalogItem } from '../api/client'
import { formatDuration, formatViews } from '../utils/format'

export function VideoCard({ item }: { item: StreamItem }) {
  const id = extractVideoId(item.url) || catalogVideoId(item)
  if (!id) return null
  const ch = item.uploaderUrl ? extractChannelId(item.uploaderUrl) : null
  const live = isLiveCatalogItem(item)
  const channelName = item.uploaderName || 'Unknown channel'
  return (
    <article className="video-card">
      <Link
        to={`/watch/${id}`}
        className="thumb-link video-card-thumbnail-link"
        aria-label={`Watch ${item.title}`}
      >
        <div className="thumb video-card-thumbnail">
          <img
            className="video-card-image"
            src={item.thumbnail}
            alt={`Thumbnail for ${item.title}`}
            width="640"
            height="360"
            loading="lazy"
            decoding="async"
          />
          {live ? (
            <span className="badge-time live video-card-live" aria-label="Live now">
              Live
            </span>
          ) : item.duration > 0 ? (
            <span
              className="badge-time video-card-duration"
              aria-label={`Duration ${formatDuration(item.duration)}`}
            >
              {formatDuration(item.duration)}
            </span>
          ) : null}
        </div>
      </Link>
      <div className="meta video-card-meta">
        {item.uploaderAvatar &&
          (ch ? (
            <Link
              to={`/channel/${ch}`}
              className="video-card-channel-link"
              aria-label={`Open ${channelName} channel`}
            >
              <img
                className="avatar video-card-avatar"
                src={item.uploaderAvatar}
                alt={`${channelName} channel avatar`}
                width="36"
                height="36"
                loading="lazy"
                decoding="async"
              />
            </Link>
          ) : (
            <img
              className="avatar video-card-avatar"
              src={item.uploaderAvatar}
              alt={`${channelName} channel avatar`}
              width="36"
              height="36"
              loading="lazy"
              decoding="async"
            />
          ))}
        <div className="video-card-copy">
          <Link to={`/watch/${id}`} className="title video-card-title">
            {item.title}
          </Link>
          <div className="sub video-card-subtitle">
            {ch ? (
              <Link to={`/channel/${ch}`} className="video-card-channel-name">
                {channelName}
              </Link>
            ) : (
              <span className="video-card-channel-name">{channelName}</span>
            )}
            {item.views != null && item.views >= 0 && (
              <span className="video-card-views">
                <span aria-hidden="true"> · </span>
                {formatViews(item.views)}
              </span>
            )}
            {item.uploadedDate && (
              <span className="video-card-date">
                <span aria-hidden="true"> · </span>
                {item.uploadedDate}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
