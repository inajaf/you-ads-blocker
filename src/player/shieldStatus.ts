import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaybackEnvironment, ShieldStatus } from './playbackPolicy'

const BRIDGE_SOURCE = 'yt-ads-shield'
const DEFAULT_TIMEOUT_MS = 1_500

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { mobile?: boolean }
}

type ShieldPingMessage = {
  source: typeof BRIDGE_SOURCE
  type: 'PING'
  requestId: string
}

type ShieldStatusMessage = {
  source: typeof BRIDGE_SOURCE
  type: 'STATUS'
  enabled: boolean
  version?: string
  requestId: string
}

export type ShieldStatusResult = ShieldStatus & {
  refresh: () => void
}

/**
 * Detect mobile browsers without relying on viewport width alone.
 *
 * `userAgentData.mobile` is preferred when available. The user-agent fallback
 * covers common phones/tablets, while the Macintosh + touch check handles
 * modern iPads that request a desktop user agent.
 */
export function detectPlaybackEnvironment(
  navigatorLike?: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & {
    userAgentData?: { mobile?: boolean }
  },
): PlaybackEnvironment {
  const runtimeNavigator =
    navigatorLike ??
    (typeof navigator === 'undefined'
      ? undefined
      : (navigator as NavigatorWithUserAgentData))

  if (!runtimeNavigator) return 'desktop'

  if (typeof runtimeNavigator.userAgentData?.mobile === 'boolean') {
    return runtimeNavigator.userAgentData.mobile ? 'mobile' : 'desktop'
  }

  const userAgent = runtimeNavigator.userAgent || ''
  const isKnownMobile =
    /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
      userAgent,
    )
  const isTablet = /iPad|Tablet|Kindle|Silk|PlayBook/i.test(userAgent)
  const isDesktopUserAgentIpad =
    /Macintosh/i.test(userAgent) && (runtimeNavigator.maxTouchPoints || 0) > 1

  return isKnownMobile || isTablet || isDesktopUserAgentIpad
    ? 'mobile'
    : 'desktop'
}

function isShieldStatusMessage(value: unknown): value is ShieldStatusMessage {
  if (!value || typeof value !== 'object') return false

  const message = value as Record<string, unknown>
  return (
    message.source === BRIDGE_SOURCE &&
    message.type === 'STATUS' &&
    typeof message.enabled === 'boolean' &&
    typeof message.requestId === 'string' &&
    message.requestId.length > 0 &&
    (message.version === undefined || typeof message.version === 'string')
  )
}

/**
 * Query the companion extension through a same-window postMessage bridge.
 * Missing or malformed replies safely resolve to inactive after the timeout.
 */
export function useShieldStatus(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): ShieldStatusResult {
  const [status, setStatus] = useState<ShieldStatus>({ state: 'checking' })
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const requestIdRef = useRef('')

  const clearStatusTimeout = useCallback(() => {
    if (timeoutRef.current !== undefined) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
  }, [])

  const refresh = useCallback(() => {
    clearStatusTimeout()

    if (typeof window === 'undefined') {
      setStatus({ state: 'inactive', enabled: false })
      return
    }

    setStatus({ state: 'checking' })
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    requestIdRef.current = requestId
    const message: ShieldPingMessage = {
      source: BRIDGE_SOURCE,
      type: 'PING',
      requestId,
    }
    window.postMessage(message, window.location.origin)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = undefined
      setStatus({ state: 'inactive', enabled: false })
    }, Math.max(0, timeoutMs))
  }, [clearStatusTimeout, timeoutMs])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || !isShieldStatusMessage(event.data)) return
      if (event.data.requestId !== requestIdRef.current) return

      clearStatusTimeout()
      setStatus(
        event.data.enabled
          ? {
              state: 'active',
              enabled: true,
              ...(event.data.version ? { version: event.data.version } : {}),
            }
          : {
              state: 'inactive',
              enabled: false,
              ...(event.data.version ? { version: event.data.version } : {}),
            },
      )
    }

    window.addEventListener('message', handleMessage)
    refresh()

    return () => {
      window.removeEventListener('message', handleMessage)
      clearStatusTimeout()
    }
  }, [clearStatusTimeout, refresh])

  return { ...status, refresh }
}
