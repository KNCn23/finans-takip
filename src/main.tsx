import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './App'
import { DialogProvider } from './ui/Dialogs'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider>
      <Root />
    </DialogProvider>
  </StrictMode>,
)
