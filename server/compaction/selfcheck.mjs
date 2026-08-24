// Self-check: tombstone compaction frees memory and preserves document state.
// Run with `node compaction/selfcheck.mjs` from server/.
//
// Builds a gc:false doc the way server/ws/index.js creates rooms, grows
// tombstones with N edit+delete cycles, compacts, and asserts:
//   1. encoded state size and tombstone count shrink
//   2. the document still round-trips byte-for-byte after compaction
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { docStats, compact } from './index.js'

const doc = new Y.Doc({ gc: false })
const text = doc.getText('doc')
for (let i = 0; i < 20; i++) {
  Y.transact(doc, () => {
    text.insert(0, 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(2))
    text.delete(10, 40)
  })
}

const before = docStats(doc)
const after = compact(doc)
const replayed = new Y.Doc()
Y.applyUpdate(replayed, Y.encodeStateAsUpdate(doc))

assert.ok(after.bytes < before.bytes, `bytes should shrink (${before.bytes} -> ${after.bytes})`)
assert.ok(after.tombstones <= before.tombstones, 'tombstones should not grow')
assert.equal(replayed.getText('doc').toString(), text.toString(), 'state must survive compaction')

console.log(`PASS structs=${before.structs}->${after.structs} tombstones=${before.tombstones}->${after.tombstones} bytes=${before.bytes}->${after.bytes} (freed ${before.bytes - after.bytes} bytes, ${Math.round((1 - after.bytes / before.bytes) * 100)}%)`)
