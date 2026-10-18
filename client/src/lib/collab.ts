import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

// Deploys set VITE_WS_URL (full ws:// or wss:// URL) or VITE_WS_HOST (host
// only, upgraded to wss). Local dev falls back to the sync server's port.
const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws'
export const SERVER_URL =
  import.meta.env.VITE_WS_URL ||
  (import.meta.env.VITE_WS_HOST
    ? `wss://${import.meta.env.VITE_WS_HOST}`
    : `${wsProtocol}://${location.hostname}:1234`)
// Room id comes from ?room=<id>; all tabs sharing it sync to the same document.
export const ROOM = new URLSearchParams(window.location.search).get('room') ?? 'weave-demo'

// One provider per page: Editor and Presence must observe the same awareness.
// The doc lives for the page's lifetime (server keeps in-memory state).
export const doc = new Y.Doc()
export const provider = new WebsocketProvider(SERVER_URL, ROOM, doc)
