// Weave tombstone compaction job.
//
// Rooms are created with gc:false (see server/ws/index.js) so Yjs keeps
// deleted text around — the unbounded state growth that is a known cost of
// tombstone CRDTs. This job runs periodically and, per room:
//   1. logs struct count + encoded state size (the growth metric)
//   2. flips gc on and runs a forced GC pass that frees tombstone-held text
//   3. reaps rooms with no connections for IDLE_TIMEOUT_MIN, bounding the
//      docs Map that otherwise grows for the server's lifetime
// Metrics are appended to metrics.log so the README reports real numbers.
//
// ponytail: one pass over the full delete set instead of Yjs's lazy
// per-transaction GC; revisit if a room ever grows past ~10k tombstones.
import * as Y from 'yjs'
import { docs } from '@y/websocket-server/utils'
import { appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const INTERVAL_MIN = Number(process.env.COMPACTION_INTERVAL_MIN) || 15
const IDLE_TIMEOUT_MIN = Number(process.env.IDLE_TIMEOUT_MIN) || 30
const METRICS_FILE =
  process.env.COMPACTION_METRICS ||
  join(dirname(fileURLToPath(import.meta.url)), 'metrics.log')

/** @param {Y.Doc} doc */
export function docStats (doc) {
  let structs = 0
  let tombstones = 0
  for (const arr of doc.store.clients.values()) {
    structs += arr.length
    for (const s of arr) {
      if (s.constructor.name === 'Item' && s.deleted) tombstones++
    }
  }
  return { structs, tombstones, bytes: Y.encodeStateAsUpdate(doc).length }
}

/**
 * Collect tombstones: enable gc and run one forced pass over the current
 * delete set. With gc:false, deleted text stays in memory; this clears it
 * (and merges adjacent deleted structs), shrinking the stored document.
 * @param {Y.Doc} doc
 */
export function compact (doc) {
  doc.gc = true
  const ds = Y.createDeleteSetFromStructStore(doc.store)
  Y.transact(doc, (tr) => Y.tryGc(tr, ds, doc.gcFilter))
  return docStats(doc)
}

function record (line) {
  console.log(`[compaction] ${line}`)
  appendFileSync(METRICS_FILE, `${line}\n`)
}

/**
 * Start the periodic compaction + idle-reaping job. Docs are reaped (state
 * lost — this server has no durable store yet) after IDLE_TIMEOUT_MIN with
 * zero connections, which is what actually bounds unbounded growth.
 * @returns {() => void} stop the job
 */
export function startCompactionJob () {
  const idleSince = new Map()

  const run = () => {
    for (const [name, doc] of [...docs]) {
      if (doc.conns.size === 0) {
        const since = idleSince.get(name) ?? Date.now()
        if (Date.now() - since >= IDLE_TIMEOUT_MIN * 60_000) {
          const { bytes } = docStats(doc)
          doc.destroy()
          docs.delete(name)
          idleSince.delete(name)
          record(`${new Date().toISOString()} reap ${name} ${bytes} bytes`)
        } else {
          idleSince.set(name, since)
        }
      } else {
        idleSince.delete(name)
        const before = docStats(doc)
        const after = compact(doc)
        record(
          `${new Date().toISOString()} compact ${name} conns=${doc.conns.size}` +
          ` structs=${before.structs}->${after.structs}` +
          ` tombstones=${before.tombstones}->${after.tombstones}` +
          ` bytes=${before.bytes}->${after.bytes} freed=${before.bytes - after.bytes}`
        )
      }
    }
  }

  const timer = setInterval(run, INTERVAL_MIN * 60_000)
  timer.unref()
  return () => clearInterval(timer)
}
