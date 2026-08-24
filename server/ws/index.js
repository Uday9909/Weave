// Weave sync server — a y-websocket protocol relay via @y/websocket-server.
// Each URL path is a document room: the client connects to `ws://localhost:1234/<docId>`.
//
// Must be imported as ESM: the package's CJS build pulls a yjs v14 prerelease
// whose CJS bundle fails to resolve under Node's require(esm). The ESM entry
// (src/utils.js) is the intended path and works.
//
// Persistence plug-in point (later phase): docs stay in memory unless a
// persistence layer is set. To persist, construct a LeveldbPersistence
// (y-leveldb) and call setPersistence(persistence) here before the first
// connection. (YPERSISTENCE env is NOT wired up in this package — persistence
// is an explicit setPersistence call.)
import { WebSocketServer } from 'ws'
import { setupWSConnection } from '@y/websocket-server/utils'
import { startCompactionJob } from '../compaction/index.js'

const PORT = Number(process.env.PORT) || 1234

const wss = new WebSocketServer({ port: PORT })

// gc: false keeps Yjs's internal item GC off so tombstones (deleted text)
// accumulate — the baseline the compaction job measures, then frees on its
// scheduled pass (see ../compaction/index.js).
wss.on('connection', (conn, req) => {
  setupWSConnection(conn, req, { gc: false })
})

// Periodically compacts tombstone growth and reaps idle rooms (COMPACTION_INTERVAL_MIN /
// IDLE_TIMEOUT_MIN env, both in minutes). This is what bounds doc memory — without a
// persistence layer, docs and their tombstones otherwise live for the server's lifetime.
startCompactionJob()

console.log(`weave sync server listening on ws://localhost:${PORT}`)
