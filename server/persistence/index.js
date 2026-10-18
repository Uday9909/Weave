// Durable room persistence — one snapshot file per room.
//
// The sync server keeps docs in memory; this layer writes each room's state
// (Y.encodeStateAsUpdate) to disk so a restart restores the document instead
// of starting empty. Writes are atomic (tmp + rename) and debounced, because
// a full snapshot is rewritten on every change.
//
// @y/websocket-server calls writeState() when the last client disconnects and
// destroys the doc immediately after, so that path writes synchronously.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Y from 'yjs'

const SAVE_DEBOUNCE_MS = 200

/**
 * @param {string} dir
 * @returns {{
 *   bindState: (room: string, doc: Y.Doc) => void,
 *   writeState: (room: string, doc: Y.Doc) => Promise<void>,
 *   flushAll: () => void,
 *   provider: null,
 * }}
 */
export function createFilePersistence (dir) {
  mkdirSync(dir, { recursive: true })
  /** @type {Map<string, { doc: Y.Doc, timer: NodeJS.Timeout }>} */
  const pending = new Map()

  // Room names come from user-supplied URLs; hashing keeps them from
  // escaping `dir` and sidesteps filesystem-unsafe characters.
  const fileFor = (room) => join(dir, `${createHash('sha256').update(room).digest('hex')}.bin`)

  const save = (room, doc) => {
    const file = fileFor(room)
    writeFileSync(`${file}.tmp`, Y.encodeStateAsUpdate(doc))
    renameSync(`${file}.tmp`, file) // atomic replace: never leaves a partial snapshot
  }

  /** Write a room's pending state now, falling back to `doc` if nothing is queued. */
  const flush = (room, doc) => {
    const entry = pending.get(room)
    if (entry) {
      clearTimeout(entry.timer)
      pending.delete(room)
    }
    const target = entry?.doc ?? doc
    if (target) save(room, target)
  }

  return {
    bindState (room, doc) {
      const file = fileFor(room)
      if (existsSync(file)) Y.applyUpdate(doc, readFileSync(file))
      doc.on('update', () => {
        const prev = pending.get(room)
        if (prev) clearTimeout(prev.timer)
        const timer = setTimeout(() => flush(room), SAVE_DEBOUNCE_MS)
        timer.unref() // a pending save must not keep the process alive
        pending.set(room, { doc, timer })
      })
      doc.on('destroy', () => {
        const prev = pending.get(room)
        if (prev) {
          clearTimeout(prev.timer)
          pending.delete(room)
        }
      })
    },
    writeState (room, doc) {
      flush(room, doc)
      return Promise.resolve()
    },
    flushAll () {
      for (const room of [...pending.keys()]) flush(room)
    },
    provider: null,
  }
}
