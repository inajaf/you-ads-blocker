import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface HistoryEntry {
  videoId: string
  title: string
  thumbnail: string
  uploader: string
  progressSec: number
  watchedAt: number
  duration?: number
}

export interface LikeEntry {
  videoId: string
  title: string
  thumbnail: string
  uploader: string
  likedAt: number
}

export interface WatchLaterEntry {
  videoId: string
  title: string
  thumbnail: string
  uploader: string
  addedAt: number
  order: number
}

interface TubeDB extends DBSchema {
  history: { key: string; value: HistoryEntry; indexes: { 'by-time': number } }
  likes: { key: string; value: LikeEntry; indexes: { 'by-time': number } }
  watchLater: { key: string; value: WatchLaterEntry; indexes: { 'by-order': number } }
}

let dbp: Promise<IDBPDatabase<TubeDB>> | null = null

export function getDb() {
  if (!dbp) {
    dbp = openDB<TubeDB>('tubepwa', 1, {
      upgrade(db) {
        const h = db.createObjectStore('history', { keyPath: 'videoId' })
        h.createIndex('by-time', 'watchedAt')
        const l = db.createObjectStore('likes', { keyPath: 'videoId' })
        l.createIndex('by-time', 'likedAt')
        const w = db.createObjectStore('watchLater', { keyPath: 'videoId' })
        w.createIndex('by-order', 'order')
      },
    })
  }
  return dbp
}
