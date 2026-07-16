import { getDb, type HistoryEntry, type LikeEntry, type WatchLaterEntry } from './db'

const CAP = 500

export async function upsertHistory(
  e: Omit<HistoryEntry, 'watchedAt'> & { watchedAt?: number },
) {
  const db = await getDb()
  await db.put('history', { ...e, watchedAt: e.watchedAt ?? Date.now() })
  const all = await db.getAllFromIndex('history', 'by-time')
  if (all.length > CAP) {
    const tx = db.transaction('history', 'readwrite')
    await Promise.all(all.slice(0, all.length - CAP).map((x) => tx.store.delete(x.videoId)))
    await tx.done
  }
}

export async function updateProgress(videoId: string, progressSec: number) {
  const db = await getDb()
  const cur = await db.get('history', videoId)
  if (!cur) return
  await db.put('history', { ...cur, progressSec, watchedAt: Date.now() })
}

export async function getHistory(videoId: string) {
  return (await getDb()).get('history', videoId)
}

export async function listHistory() {
  const all = await (await getDb()).getAllFromIndex('history', 'by-time')
  return all.reverse()
}

export async function removeHistory(videoId: string) {
  await (await getDb()).delete('history', videoId)
}

export async function toggleLike(e: Omit<LikeEntry, 'likedAt'>) {
  const db = await getDb()
  if (await db.get('likes', e.videoId)) {
    await db.delete('likes', e.videoId)
    return false
  }
  await db.put('likes', { ...e, likedAt: Date.now() })
  return true
}

export async function isLiked(videoId: string) {
  return Boolean(await (await getDb()).get('likes', videoId))
}

export async function listLikes() {
  return (await (await getDb()).getAllFromIndex('likes', 'by-time')).reverse()
}

export async function toggleWatchLater(e: Omit<WatchLaterEntry, 'addedAt' | 'order'>) {
  const db = await getDb()
  if (await db.get('watchLater', e.videoId)) {
    await db.delete('watchLater', e.videoId)
    return false
  }
  const all = await db.getAll('watchLater')
  const order = all.reduce((m, x) => Math.max(m, x.order), 0) + 1
  await db.put('watchLater', { ...e, addedAt: Date.now(), order })
  return true
}

export async function isWatchLater(videoId: string) {
  return Boolean(await (await getDb()).get('watchLater', videoId))
}

export async function listWatchLater() {
  return (await getDb()).getAllFromIndex('watchLater', 'by-order')
}

export async function clearAll() {
  const db = await getDb()
  const tx = db.transaction(['history', 'likes', 'watchLater'], 'readwrite')
  await Promise.all([
    tx.objectStore('history').clear(),
    tx.objectStore('likes').clear(),
    tx.objectStore('watchLater').clear(),
    tx.done,
  ])
}
