/** Direct YouTube InnerTube streams when Piped is blocked. */

import { mapInnerTubePlayerResponse } from './stream-map.mjs'

/**
 * Modern clients + visitorData bypass many LOGIN_REQUIRED / empty Piped cases.
 * ANDROID 20.x returns muxed progressive (best for <video>); IOS adaptive fallback.
 */
const CLIENTS = [
  {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    androidSdkVersion: 34,
    clientId: '3',
    userAgent:
      'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  },
  {
    clientName: 'ANDROID_VR',
    clientVersion: '1.65.10',
    androidSdkVersion: 30,
    clientId: '28',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12; eureka-user Build/SQ3A.220605.009.A1) gzip',
  },
  {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    deviceModel: 'iPhone16,2',
    clientId: '5',
    userAgent:
      'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
  },
  {
    clientName: 'ANDROID',
    clientVersion: '19.28.35',
    androidSdkVersion: 34,
    clientId: '3',
    userAgent:
      'com.google.android.youtube/19.28.35 (Linux; U; Android 14) gzip',
    apiKey: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
  },
  {
    clientName: 'WEB_EMBEDDED_PLAYER',
    clientVersion: '1.20241201.00.00',
    clientScreen: 'EMBED',
    clientId: '56',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  {
    clientName: 'MWEB',
    clientVersion: '2.20241202.07.00',
    clientId: '2',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
]

let visitorCache = { value: '', at: 0 }

/** Fetch yt VISITOR_DATA (cached ~30m). Critical for bot-check bypass. */
export async function getVisitorData() {
  const now = Date.now()
  if (visitorCache.value && now - visitorCache.at < 30 * 60 * 1000) {
    return visitorCache.value
  }
  try {
    const res = await fetch('https://www.youtube.com/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    })
    const html = await res.text()
    const vis = html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1] || ''
    if (vis) {
      visitorCache = { value: vis, at: now }
      return vis
    }
  } catch {
    /* ignore */
  }
  return visitorCache.value || ''
}

async function player(videoId, client, visitorData) {
  const clientPayload = {
    clientName: client.clientName,
    clientVersion: client.clientVersion,
    hl: 'en',
    gl: 'US',
    userAgent: client.userAgent,
  }
  if (visitorData) clientPayload.visitorData = visitorData
  if (client.androidSdkVersion != null) {
    clientPayload.androidSdkVersion = client.androidSdkVersion
  }
  if (client.deviceModel) clientPayload.deviceModel = client.deviceModel
  if (client.clientScreen) clientPayload.clientScreen = client.clientScreen

  const body = {
    context: { client: clientPayload },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: 'HTML5_PREF_WANTS',
      },
    },
  }

  if (
    client.clientName === 'WEB_EMBEDDED_PLAYER' ||
    client.clientName === 'TVHTML5_SIMPLY_EMBEDDED_PLAYER'
  ) {
    body.context.thirdParty = { embedUrl: 'https://www.youtube.com/' }
  }

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12000)
  try {
    const keyQ = client.apiKey
      ? `?key=${client.apiKey}&prettyPrint=false`
      : '?prettyPrint=false'
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player${keyQ}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.userAgent,
          Origin: 'https://www.youtube.com',
          Referer: 'https://www.youtube.com/',
          'X-YouTube-Client-Name': client.clientId || '1',
          'X-YouTube-Client-Version': client.clientVersion,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    )
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * Resolve streams via InnerTube. Tries modern clients with visitorData first.
 * @param {string} videoId
 * @param {{ deadlineMs?: number }} [opts]
 */
export async function fetchYouTubeStreams(videoId, opts = {}) {
  if (!/^[\w-]{11}$/.test(videoId)) return null
  const deadline = Date.now() + (opts.deadlineMs ?? 14000)
  const visitorData = await getVisitorData()

  for (const client of CLIENTS) {
    if (Date.now() > deadline) break
    const data = await player(videoId, client, visitorData)
    if (!data) continue
    const mapped = mapInnerTubePlayerResponse(data, videoId)
    if (mapped) {
      mapped._source = `innertube-${client.clientName.toLowerCase()}`
      return mapped
    }
  }
  return null
}

export function videoIdFromStreamsPath(path) {
  const m = String(path).match(/^\/streams\/([\w-]{11})(?:\?|$)/)
  return m ? m[1] : null
}
