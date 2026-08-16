import { createRoot } from 'react-dom/client'
import Editor from './editor/Editor'
import './styles.css'

// StrictMode intentionally omitted: in dev it double-invokes effects, which
// would open two WebSocket connections on first load.
const rootEl = document.getElementById('root')!
createRoot(rootEl).render(<Editor />)
