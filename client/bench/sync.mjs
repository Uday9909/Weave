// Sync benchmark: measures real per-edit propagation latency and how fast
// N concurrent editors converge, against a locally spawned sync server.
// Run: npm run bench (from client/)
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '..', '..', 'server', 'ws', 'index.js')
const PORT = 1262
const BASE = `ws://127.0.0.1:${PORT}`
const LATENCY_SAMPLES = 50
const CONCURRENT_ROUNDS = 3
const EDITOR_COUNTS = [2, 10, 25]
const TIMEOUT_MS = 3000
const dataDir = mkdtempSync(join(tmpdir(), 'weave-bench-'))

// Each WebsocketProvider registers a process-level listener; 25 peers trips
// the default limit of 10.
process.setMaxListeners(64)

const startServer = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      WEAVE_DATA_DIR: dataDir,
      COMPACTION_INTERVAL_MIN: '999',
      IDLE_TIMEOUT_MIN: '999',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const timer = setTimeout(() => {
    child.kill('SIGTERM')
    reject(new Error(`server did not start within ${TIMEOUT_MS} ms`))
  }, TIMEOUT_MS)
  const onData = (chunk) => {
    if (chunk.toString().includes('listening on')) {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      resolve(child)
    }
  }
  child.stdout.on('data', onData)
  child.once('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`server exited early (code ${code})`))
  })
})

const connect = (room) => new Promise((resolve, reject) => {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(BASE, room, doc)
  const timer = setTimeout(() => reject(new Error(`sync timeout (${room})`)), TIMEOUT_MS)
  const onSync = (isSynced) => {
    if (!isSynced) return
    clearTimeout(timer)
    provider.off('sync', onSync)
    resolve({ doc, provider })
  }
  provider.on('sync', onSync)
})

const connectMany = (room, count) => Promise.all(
  Array.from({ length: count }, () => connect(room)),
)

/** Resolve on the next doc update once `predicate` holds (checked immediately too). */
const waitForUpdate = (doc, predicate) => new Promise((resolve, reject) => {
  if (predicate()) return resolve()
  const done = () => {
    if (!predicate()) return
    clearTimeout(timer)
    doc.off('update', done)
    resolve()
  }
  const timer = setTimeout(() => {
    doc.off('update', done)
    reject(new Error('timed out waiting for update'))
  }, TIMEOUT_MS)
  doc.on('update', done)
})

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  }
}
const ms = (n) => `${n.toFixed(2)} ms`

let server
try {
  console.log(`starting sync server on port ${PORT}...`)
  server = await startServer()

  // Per-edit propagation latency between two editors.
  const [alice, bob] = await connectMany('bench-latency', 2)
  console.log('connected 2 editors')
  const aliceText = alice.doc.getText('content')
  const bobText = bob.doc.getText('content')
  const latency = []
  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    const before = bobText.length
    const t0 = performance.now()
    aliceText.insert(aliceText.length, 'x')
    await waitForUpdate(bob.doc, () => bobText.length > before)
    latency.push(performance.now() - t0)
  }
  alice.provider.destroy()
  bob.provider.destroy()

  const lat = stats(latency)
  console.log(`\nSync latency, 2 editors, ${LATENCY_SAMPLES} sequential edits (localhost)`)
  console.log(`  p50 ${ms(lat.p50)}  p95 ${ms(lat.p95)}  max ${ms(lat.max)}`)

  // Concurrent editors: all insert at the same position in the same tick;
  // time until every editor holds the complete, identical document.
  console.log(`\nConcurrent editors — time to convergence (${CONCURRENT_ROUNDS} rounds)`)
  console.log('  editors   p50        max')
  for (const count of EDITOR_COUNTS) {
    const rounds = []
    for (let round = 0; round < CONCURRENT_ROUNDS; round++) {
      const peers = await connectMany(`bench-k${count}-${round}`, count)
      const texts = peers.map((p) => p.doc.getText('content'))
      const payloads = texts.map((_, i) => `[editor-${i}] `)
      const expectedLength = payloads.join('').length

      const t0 = performance.now()
      texts.forEach((text, i) => text.insert(0, payloads[i]))
      await Promise.all(
        peers.map((p, i) => waitForUpdate(p.doc, () => texts[i].length === expectedLength)),
      )
      rounds.push(performance.now() - t0)

      const finals = texts.map((t) => t.toString())
      if (!finals.every((s) => s === finals[0])) throw new Error(`divergence with ${count} editors`)
      peers.forEach((p) => p.provider.destroy())
    }
    const r = stats(rounds)
    console.log(`  ${String(count).padEnd(9)} ${ms(r.p50).padEnd(10)} ${ms(r.max)}`)
  }
} finally {
  if (server) {
    server.kill('SIGTERM')
    await new Promise((resolve) => server.once('exit', resolve))
  }
  rmSync(dataDir, { recursive: true, force: true })
}
