// Weave sync server — a y-websocket protocol relay via @y/websocket-server.
// Each URL path is a document room: the client connects to `ws://localhost:1234/<docId>`.
//
// Must be imported as ESM: the package's CJS build pulls a yjs v14 prerelease
// whose CJS bundle fails to resolve under Node's require(esm). The ESM entry
// (src/utils.js) is the intended path and works.
//
// Persistence plug-in point (Phase 3): docs stay in memory for the server's
// lifetime unless a persistence layer is set. To persist, construct a
// LeveldbPersistence (y-leveldb) and call setPersistence(persistence) here
// before the first connection. (YPERSISTENCE env is NOT wired up in this
// package — persistence is an explicit setPersistence call.)
import { WebSocketServer } from 'ws'
import { setupWSConnection } from '@y/websocket-server/utils'

const PORT = Number(process.env.PORT) || 1234

const wss = new WebSocketServer({ port: PORT })

// gc: false disables Yjs's internal item GC for the room docs. Kept off so
// Phase 3 can measure tombstone growth on a stable baseline. Doc lifecycle is
// unaffected: without a persistence layer, docs survive disconnects anyway.
// ponytail: in-memory only for Phase 1; add setPersistence in Phase 3.
wss.on('connection', (conn, req) => {
  setupWSConnection(conn, req, { gc: false })
})

console.log(`weave sync server listening on ws://localhost:${PORT}`)
