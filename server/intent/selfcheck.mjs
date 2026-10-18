// Headless checks for the intent pipeline.
//  - heuristic: deterministic verdicts on synthetic edits (pure, no Yjs/network)
//  - collision: real Yjs two-client sim — concurrent same-spot edits are
//    attributed to distinct clients and overlap; disjoint edits are not.
// Run: npm run intent
import * as Y from 'yjs'
import { startIntentPipeline } from './index.mjs'
import { interleaveVerdict } from './heuristic.mjs'

try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch { /* no .env — heuristic-only */ }

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const edit = (client, from, to) => ({ client, from, to })

// --- heuristic verdicts (pure) ---
assert(interleaveVerdict([edit('A', 0, 1), edit('B', 1, 2), edit('A', 2, 3), edit('B', 3, 4)]).verdict === 'mangled', 'alternating one-char runs are mangled')
assert(interleaveVerdict([edit('A', 0, 5), edit('B', 5, 10)]).verdict === 'ambiguous', 'two blocky same-spot ranges are ambiguous')
assert(interleaveVerdict([edit('A', 0, 5), edit('A', 6, 10)]).verdict === 'benign', 'single-client edits are benign')
assert(
  interleaveVerdict([{ client: 'A', from: 0, to: 5, text: 'very ' }, { client: 'B', from: 5, to: 10, text: 'very ' }]).verdict === 'mangled',
  'duplicate non-blank text from different clients is mangled'
)
assert(
  interleaveVerdict([{ client: 'A', from: 0, to: 1, text: ' ' }, { client: 'B', from: 1, to: 2, text: ' ' }]).verdict !== 'mangled',
  'duplicate whitespace is not mangled'
)
assert(
  interleaveVerdict([edit('A', 0, 5), edit('B', 5, 10), edit('C', 10, 15)]).verdict === 'mangled',
  'three clients in one cluster is mangled'
)
console.log('ok: heuristic verdicts (mangled / ambiguous / benign, provenance rules)')

// --- collision detection: concurrent same-spot typing must collide across 2 clients ---
const server = new Y.Doc()
const tracker = startIntentPipeline(server, 'selfcheck', () => {})
const A = new Y.Doc(), B = new Y.Doc()
const oA = {}, oB = {}
const at = A.getText('content'), bt = B.getText('content')
for (const ch of 'abc') { at.insert(0, ch); Y.applyUpdate(server, Y.encodeStateAsUpdate(A), oA) }
for (const ch of 'xyz') { bt.insert(0, ch); Y.applyUpdate(server, Y.encodeStateAsUpdate(B), oB) }
const edits = tracker.recentEdits()
assert(new Set(edits.map(e => e.client)).size === 2, 'edits attributed to two distinct clients')
let overlapped = false
for (let i = 0; i < edits.length; i++) for (let j = i + 1; j < edits.length; j++) {
  const a = edits[i], b = edits[j]
  if (a.client !== b.client && Math.min(a.to, b.to) - Math.max(a.from, b.from) >= -2) overlapped = true
}
assert(overlapped, 'two clients\' ranges overlap (collision detected)')
await sleep(500) // let the burst buffer flush
const clusters = tracker.recentClusters()
assert(clusters.length === 1, 'bursts are clustered, not emitted pairwise')
assert(new Set(clusters[0].edits.map(e => e.client)).size === 2, 'cluster contains both clients')
console.log('ok: concurrent same-spot merge clustered across clients (server text:', JSON.stringify(server.getText('content').toString()), ')')

// --- collision detection: disjoint edits must not collide ---
// Clients must share a seeded baseline so absolute positions line up (a fresh
// client "insert at 10" would otherwise land adjacent to existing text).
const server2 = new Y.Doc()
const tracker2 = startIntentPipeline(server2, 'selfcheck', () => {})
const base = new Y.Doc()
base.getText('content').insert(0, 'X'.repeat(20))
const baseUpdate = Y.encodeStateAsUpdate(base)
Y.applyUpdate(server2, baseUpdate, null) // baseline: not attributed to a peer
const C = new Y.Doc(), D = new Y.Doc()
Y.applyUpdate(C, baseUpdate, null)
Y.applyUpdate(D, baseUpdate, null)
const oC = {}, oD = {}
C.getText('content').insert(2, 'hello'); Y.applyUpdate(server2, Y.encodeStateAsUpdate(C), oC)
D.getText('content').insert(12, 'world'); Y.applyUpdate(server2, Y.encodeStateAsUpdate(D), oD)
const e2 = tracker2.recentEdits()
let overlap2 = false
for (let i = 0; i < e2.length; i++) for (let j = i + 1; j < e2.length; j++) {
  if (e2[i].client !== e2[j].client && Math.min(e2[i].to, e2[j].to) - Math.max(e2[i].from, e2[j].from) >= -2) overlap2 = true
}
assert(!overlap2, 'disjoint edits must not collide')
await sleep(500)
assert(tracker2.recentClusters().length === 0, 'disjoint edits produce no cluster')
console.log('ok: disjoint edits not detected as collisions')

console.log('selfcheck PASS')
