import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { InstallBanner } from './components/InstallBanner'
import { UpdateToast } from './components/UpdateToast'
import { APP_BASENAME, isAppPath } from './appRoutes'

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })))
const SearchPage = lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })))
const WatchPage = lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })))
const ChannelPage = lazy(() => import('./pages/ChannelPage').then((m) => ({ default: m.ChannelPage })))
const LibraryPage = lazy(() => import('./pages/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ImportPage = lazy(() => import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })))
const Landing = lazy(() => import('./landing/Landing').then((m) => ({ default: m.Landing })))

function RouteFallback() {
  return (
    <div className="page pad route-fallback" role="status">
      <div className="skeleton skeleton-line wide" />
      <div className="skeleton skeleton-line" />
      <span className="sr-only">Loading page</span>
    </div>
  )
}

function Shell() {
  const loc = useLocation()
  const hide = loc.pathname.startsWith('/watch/')
  return (
    <div className={`shell${hide ? ' watch' : ''}`}>
      <main className="main">
        {!hide && <InstallBanner />}
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/watch/:id" element={<WatchPage />} />
            <Route path="/channel/:id" element={<ChannelPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/import" element={<ImportPage />} />
            {/* Unknown /app/* paths fall back to the app home. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      {!hide && <BottomNav />}
      <UpdateToast />
    </div>
  )
}

export default function App() {
  // The landing page (public front door) and the video app are distinct
  // experiences with different chrome and fonts, so they are split at the top
  // level rather than sharing one router. Anything that is not an /app path —
  // including unknown top-level paths — resolves to the landing at `/`.
  if (typeof window !== 'undefined' && isAppPath(window.location.pathname)) {
    return (
      <BrowserRouter basename={APP_BASENAME}>
        <Shell />
      </BrowserRouter>
    )
  }
  return (
    <Suspense fallback={<RouteFallback />}>
      <Landing />
    </Suspense>
  )
}
