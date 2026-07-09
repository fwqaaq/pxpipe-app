import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import PopoverApp from './PopoverApp'

const isPopover = window.location.hash.startsWith('#/popover')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPopover ? <PopoverApp /> : <App />}</StrictMode>
)
