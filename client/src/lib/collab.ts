import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const SERVER_URL = 'ws://localhost:1234'
// Room id comes from ?room=<id>; all tabs sharing it sync to the same document.
export const ROOM = new URLSearchParams(window.location.search).get('room') ?? 'weave-demo'

// One provider per page: Editor and Presence must observe the same awareness.
// The doc lives for the page's lifetime (server keeps in-memory state).
export const doc = new Y.Doc()
export const provider = new WebsocketProvider(SERVER_URL, ROOM, doc)
