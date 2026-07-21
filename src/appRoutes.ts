/**
 * Routing constants for the video app's `/app` mount point.
 *
 * The app lives under this basename so the marketing landing page can own the
 * root `/`. `<BrowserRouter basename={APP_BASENAME}>` strips the prefix from
 * every Link/navigate/useLocation, so the app's internal absolute links
 * (`to="/search"`, `navigate('/watch/'+id)`) keep working unchanged while the
 * real URLs are `/app`, `/app/search`, `/app/watch/:id`, …
 *
 * Kept free of React/JSX so it can be unit-tested under node:test
 * (see tests/landing-faq.test.mjs).
 */

export const APP_BASENAME = '/app'

/** True when `pathname` addresses the video app (`/app` or `/app/...`). */
export function isAppPath(pathname: string): boolean {
  return pathname === APP_BASENAME || pathname.startsWith(`${APP_BASENAME}/`)
}
