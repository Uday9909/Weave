import { createRoot } from 'react-dom/client'
import Editor from './editor/Editor'
import { Presence } from './presence/Presence'
import { FlagBanner } from './flags/FlagBanner'
import { connectFlags } from './flags/flagsChannel'
import './styles.css'

// StrictMode intentionally omitted: in dev it double-invokes effects, which
// would open two WebSocket connections on first load.
connectFlags()

const rootEl = document.getElementById('root')!
createRoot(rootEl).render(
  <div className="app">
    <Presence />
    <FlagBanner />
    <Editor />
  </div>,
)
