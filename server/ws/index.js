// Weave sync server — a y-websocket protocol relay via @y/websocket-server.
// Each URL path is a document room: the client connects to `ws://localhost:1234/<docId>`.
//
// Must be imported as ESM: the package's CJS build pulls a yjs v14 prerelease
// whose CJS bundle fails to resolve under Node's require(esm). The ESM entry
// (src/utils.js) is the intended path and works.
//
// Durable persistence: rooms are snapshotted to disk (see ../persistence) and
// reloaded on the first connection after a restart. setPersistence must run
// before the first getYDoc call.
import { WebSocketServer } from 'ws'
import { setupWSConnection, getYDoc, setPersistence } from '@y/websocket-server/utils'
import { startCompactionJob } from '../compaction/index.js'
import { startIntentPipeline } from '../intent/index.mjs'
import { createFilePersistence } from '../persistence/index.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Optional local env (GEMINI_API_KEY etc.). Missing file => heuristic-only.
try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch { /* no .env */ }

const PORT = Number(process.env.PORT) || 1234
const DATA_DIR =
  process.env.WEAVE_DATA_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), '..', '.data')

const persistence = createFilePersistence(DATA_DIR)
setPersistence(persistence)

const wss = new WebSocketServer({ port: PORT })

// Flag subscribers per room: `/flags/<room>` is a lightweight JSON channel so the
// y-websocket client (which ignores unknown y-protocol message types) can receive
// flags without forking the sync channel.
const flagClients = new Map() // room -> Set<ws>
// Keyed by doc, not room: with persistence, docs are destroyed on last
// disconnect and recreated on reconnect, so each new doc needs its own pipeline.
const startedDocs = new WeakSet()

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
  if (!startedDocs.has(doc)) {
    startedDocs.add(doc)
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

// Persist any debounced room state before exiting on a stop signal.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    persistence.flushAll()
    process.exit(0)
  })
}

console.log(`weave sync server listening on ws://localhost:${PORT}`)
