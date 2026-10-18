// Persistence selfcheck: a snapshot written by one server lifetime must load
// in the next one. The "restart" is simulated by discarding the first
// persistence instance + Y.Doc and creating fresh ones over the same dir.
// Run: node persistence/selfcheck.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { createFilePersistence } from './index.js'

const ROOM = 'persistence-selfcheck'
const TEXT = 'survives a server restart'
const SNAPSHOT_DEBOUNCE_MS = 300
const dataDir = mkdtempSync(join(tmpdir(), 'weave-persist-'))

/** Open a room the way the sync server does on first connection. */
const openRoom = () => {
  const persistence = createFilePersistence(dataDir)
  const doc = new Y.Doc({ gc: false })
  persistence.bindState(ROOM, doc)
  return { persistence, doc }
}

try {
  const first = openRoom()
  first.doc.getText('content').insert(0, TEXT)
  await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_DEBOUNCE_MS))

  // A second edit flushed explicitly simulates the SIGTERM path.
  first.doc.getText('content').insert(TEXT.length, '!')
  first.persistence.flushAll()
  first.doc.destroy()

  const second = openRoom()
  assert.equal(second.doc.getText('content').toString(), `${TEXT}!`)
  second.doc.destroy()
  console.log(`ok - room "${ROOM}" restored after restart`)
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
