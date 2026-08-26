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
import { setupWSConnection, getYDoc } from '@y/websocket-server/utils'
import { startCompactionJob } from '../compaction/index.js'
import { startIntentPipeline } from '../intent/index.mjs'

// Optional local env (GEMINI_API_KEY etc.). Missing file => heuristic-only.
try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch { /* no .env */ }

const PORT = Number(process.env.PORT) || 1234

const wss = new WebSocketServer({ port: PORT })

// Flag subscribers per room: `/flags/<room>` is a lightweight JSON channel so the
// y-websocket client (which ignores unknown y-protocol message types) can receive
// flags without forking the sync channel.
const flagClients = new Map() // room -> Set<ws>
const startedDocs = new Set() // room -> intent pipeline attached once

wss.on('connection', (conn, req) => {
  const path = (req.url || '').slice(1).split('?')[0]
  const flagRoom = path.startsWith('flags/') ? path.slice('flags/'.length) : null
  if (flagRoom) {
    const set = flagClients.get(flagRoom) ?? new Set()
    set.add(conn)
    flagClients.set(flagRoom, set)
    conn.on('close', () => set.delete(conn))
    return
  }
  const room = path
  const doc = getYDoc(room, false)
  if (!startedDocs.has(room)) {
    startedDocs.add(room)
    startIntentPipeline(doc, room, (flag) => {
      console.log(`[intent] flag #${flag.id} room=${flag.room} ${flag.region.from}-${flag.region.to} conf=${flag.confidence} ${flag.reason}`)
      const subs = flagClients.get(room)
      if (!subs) return
      const msg = JSON.stringify(flag)
      for (const c of subs) if (c.readyState === 1) c.send(msg)
    })
  }
  // gc: false keeps Yjs's internal item GC off so tombstones (deleted text)
  // accumulate — the baseline the compaction job measures, then frees on its
  // scheduled pass (see ../compaction/index.js).
  setupWSConnection(conn, req, { gc: false })
})

// Periodically compacts tombstone growth and reaps idle rooms (COMPACTION_INTERVAL_MIN /
// IDLE_TIMEOUT_MIN env, both in minutes). This is what bounds doc memory — without a
// persistence layer, docs and their tombstones otherwise live for the server's lifetime.
startCompactionJob()

console.log(`weave sync server listening on ws://localhost:${PORT}`)
