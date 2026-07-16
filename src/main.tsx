import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './pwa/installPrompt'
import './pwa/updatePrompt'
import App from './App'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
