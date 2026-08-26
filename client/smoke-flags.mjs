// End-to-end Phase 4 smoke: two concurrent editors edit the same spot, and we
// assert a flag arrives on the /flags/<room> channel. Runs against a live server
// (server/.env must carry GEMINI_API_KEY for the ambiguous->LLM path; without a
// key the heuristic-only path may not flag — see the Yjs concat note in README).
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const HOST = process.env.WEAVE_HOST ?? 'ws://localhost:1234'
const ROOM = 'flag-smoke-' + Date.now()
const TEXT = 'content'
const BASELINE = '01234567890123456789' // 20 chars so inserts land mid-doc
const POS = 10
const A_TEXT = 'AAAAA'
const B_TEXT = 'BBBBB'
const WINDOW_MS = 8000 // collision tracker prune window (see collision.mjs)
const TIMEOUT_MS = 20000

const sleep = ms => new Promise(r => setTimeout(r, ms))

function waitFlag() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HOST}/flags/${ROOM}`)
    const t = setTimeout(() => { ws.close(); reject(new Error(`timeout: no flag in ${TIMEOUT_MS}ms`)) }, TIMEOUT_MS)
    ws.addEventListener('message', e => { clearTimeout(t); ws.close(); resolve(JSON.parse(e.data)) })
    ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('flags channel error')) })
  })
}

const docA = new Y.Doc()
const docB = new Y.Doc()
const provA = new WebsocketProvider(HOST, ROOM, docA)
const provB = new WebsocketProvider(HOST, ROOM, docB)
const textA = docA.getText(TEXT)
const textB = docB.getText(TEXT)

const textLen = text => text.toString().length

try {
  // Wait for A to connect and seed the baseline, then let the tracker prune it
  // from its rolling window so it isn't treated as a competing edit.
  for (let i = 0; i < 100 && provA.wsconnected !== true; i++) await sleep(50)
  if (!provA.wsconnected) throw new Error('client A never connected')
  textA.insert(0, BASELINE)
  for (let i = 0; i < 100 && textLen(textA) !== BASELINE.length; i++) await sleep(50)
  await sleep(WINDOW_MS + 500)

  // Connect B and wait until its doc carries the baseline (same absolute offsets).
  for (let i = 0; i < 100 && provB.wsconnected !== true; i++) await sleep(50)
  if (!provB.wsconnected) throw new Error('client B never connected')
  for (let i = 0; i < 200 && textLen(textB) !== BASELINE.length; i++) await sleep(50)
  if (textLen(textB) !== BASELINE.length) throw new Error('client B never synced baseline')

  // Subscribe, then fire both inserts from the same tick so they arrive as
  // concurrent transactions at the same position.
  const flagPromise = waitFlag()
  textA.insert(POS, A_TEXT)
  textB.insert(POS, B_TEXT)

  const flag = await flagPromise
  const regionLen = flag.region.to - flag.region.from
  console.log('PASS flag received:')
  console.log('  id        ', flag.id)
  console.log('  region    ', `${flag.region.from}-${flag.region.to} (len ${regionLen})`)
  console.log('  confidence', flag.confidence)
  console.log('  reason    ', flag.reason)
} catch (err) {
  console.error('FAIL:', err.message)
  process.exitCode = 1
} finally {
  provA.destroy(); provB.destroy()
  docA.destroy(); docB.destroy()
}
