import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Landing } from './Landing'

// Landing-only static entry for the GitHub Pages deploy: renders the marketing
// page with no BrowserRouter and no app shell. The same <Landing /> component
// powers the Netlify SPA at `/` (see src/App.tsx). Navigation is in-page hash
// anchors + absolute GitHub release URLs, so it needs no router and works under
// the /you-ads-blocker/ subpath.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
)
