/** The runtime that determines which playback path is safe to use. */
export type PlaybackEnvironment = 'mobile' | 'desktop'

/**
 * The last known state of the companion browser extension.
 *
 * A discriminated union prevents callers from accidentally treating a
 * pending response as an inactive extension.
 */
export type ShieldStatus =
  | { state: 'checking' }
  | { state: 'active'; enabled: true; version?: string }
  | { state: 'inactive'; enabled: false; version?: string }

/** The playback surface the watch page should render. */
export type PlaybackDecision = {
  mode: 'stream' | 'checking' | 'embed' | 'shield_required'
  environment: PlaybackEnvironment
  shield: ShieldStatus
}

/**
 * Select a playback mode without consulting browser globals.
 *
 * Mobile playback always uses the first-party stream player. Desktop embed
 * playback is only allowed after the extension explicitly reports active.
 */
export function decidePlayback(
  environment: PlaybackEnvironment,
  shield: ShieldStatus,
): PlaybackDecision {
  if (environment === 'mobile') {
    return { mode: 'stream', environment, shield }
  }

  if (shield.state === 'checking') {
    return { mode: 'checking', environment, shield }
  }

  if (shield.state === 'active') {
    return { mode: 'embed', environment, shield }
  }

  return { mode: 'shield_required', environment, shield }
}
