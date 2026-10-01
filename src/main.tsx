import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/400-italic.css'
import '@fontsource/dm-mono/500.css'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import './styles/global.css'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
