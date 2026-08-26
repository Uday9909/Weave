// Phase 5 — intent-flagging eval harness.
// Replays labeled concurrent-edit scenarios through the real pipeline
// (collision -> heuristic -> optional Gemini) and reports precision/recall +
// a confusion matrix. Labels are human-judged reads of the intended merge;
// each scenario's ops + note make the judgment auditable.
//
//   npm run eval       heuristic-only (deterministic, free, no network)
//   npm run eval:llm   with the Gemini judge (needs GEMINI_API_KEY in server/.env)
import * as Y from 'yjs'
import { startIntentPipeline } from './index.mjs'
import { interleaveVerdict } from './heuristic.mjs'

try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch { /* no .env: heuristic-only */ }

const useLlm = process.argv.includes('--llm')
if (!useLlm) delete process.env.GEMINI_API_KEY
const SETTLE_MS = useLlm ? 8000 : 300 // Gemini judge ~2-4s per call; heuristic settles on the next tick

const SLEEP = (ms) => new Promise(r => setTimeout(r, ms))

const SCENARIOS = [
  // --- should flag: the merge mangled intent ---
  {
    name: 'interleave-chars', label: 'flag',
    baseline: 'X'.repeat(20),
    note: 'both type single chars at the same spot; Yjs concat scrambles order',
    ops: [['A', 0, 'a'], ['A', 0, 'b'], ['A', 0, 'c'], ['B', 0, '1'], ['B', 0, '2'], ['B', 0, '3']],
  },
  {
    name: 'same-spot-verbs', label: 'flag',
    baseline: 'The quick fox jumps.',
    note: 'two verbs jammed into one slot',
    ops: [['A', 10, 'ran '], ['B', 10, 'swam ']],
  },
  {
    name: 'same-spot-adverbs', label: 'flag',
    baseline: 'She said, hello.',
    note: 'two adverbs jammed into one slot',
    ops: [['A', 9, 'loudly, '], ['B', 9, 'quietly, ']],
  },
  {
    name: 'trailer-jam', label: 'flag',
    baseline: 'The weather is nice today.',
    note: 'two trailing clauses collide at the end',
    ops: [['A', 25, 'and warm '], ['B', 25, 'and sunny ']],
  },
  {
    name: 'duplicate-word', label: 'flag',
    baseline: 'The sunset is beautiful.',
    note: 'both insert the same word -> duplicated in the merge',
    ops: [['A', 14, 'very '], ['B', 14, 'very ']],
  },
  {
    name: 'staggered-interleave', label: 'flag',
    baseline: 'X'.repeat(20),
    note: 'position-staggered inserts to probe the heuristic mangled path',
    ops: [['A', 0, 'a'], ['A', 3, 'c'], ['B', 1, 'b'], ['B', 4, 'd']],
  },
  {
    name: 'three-client-append', label: 'flag',
    baseline: 'Done.',
    note: 'three appends at the same end spot -> jammed fragments',
    ops: [['A', 5, ' Good job'], ['B', 5, " Let's ship"], ['C', 5, ' Bravo']],
  },
  // --- should NOT flag: the merge reads as intended ---
  {
    name: 'disjoint', label: 'noflag',
    baseline: 'X'.repeat(30),
    note: 'two clients edit far apart',
    ops: [['A', 2, 'hello'], ['B', 20, 'world']],
  },
  {
    name: 'single-client', label: 'noflag',
    baseline: 'X'.repeat(10),
    note: 'only one client edits',
    ops: [['A', 2, 'a']],
  },
  {
    name: 'append-sentences', label: 'noflag',
    baseline: "Let's meet at noon.",
    note: 'two clients each append a sentence; both read fine in the merge',
    ops: [['A', 18, ' See you there.'], ['B', 18, ' Bring notes.']],
  },
  {
    name: 'adjacent-touch', label: 'noflag',
    baseline: 'The cat and the dog ran.',
    note: 'nearby ranges, merged text stays grammatical',
    ops: [['A', 4, 'big '], ['B', 11, 'fast ']],
  },
  {
    name: 'cosmetic-spacing', label: 'noflag',
    baseline: 'I love my dog.',
    note: 'both insert a space at the same spot -> harmless double space',
    ops: [['A', 9, ' '], ['B', 9, ' ']],
  },
]

// What the heuristic alone would say on this scenario's actual tracked edits —
// proves the collision tracker saw the collision and shows why no flag fired
// (ambiguous regions only flag via the LLM).
function heuristicVerdict(edits) {
  if (!edits.length) return 'no-edits'
  for (let i = 0; i < edits.length; i++) {
    for (let j = i + 1; j < edits.length; j++) {
      const a = edits[i], b = edits[j]
      if (a.client === b.client) continue
      if (Math.min(a.to, b.to) - Math.max(a.from, b.from) < -2) continue
      const from = Math.min(a.from, b.from), to = Math.max(a.to, b.to)
      const region = edits.filter(e => e.to >= from && e.from <= to)
      return interleaveVerdict(region).verdict
    }
  }
  return 'no-collision'
}

// Replay one scenario through the real pipeline (fresh doc + pipeline per
// scenario so cooldowns don't leak across cases). Returns the emit list.
async function runScenario({ baseline, ops }) {
  const server = new Y.Doc()
  // Attach the pipeline BEFORE seeding the baseline so the observer's diff
  // baseline is set by the origin=null baseline transaction (a client's first
  // edit must diff against the baseline, not an empty string).
  const emits = []
  const tracker = startIntentPipeline(server, 'eval', f => emits.push(f))
  let baselineUpdate = null
  if (baseline) {
    const b = new Y.Doc()
    b.getText('content').insert(0, baseline)
    baselineUpdate = Y.encodeStateAsUpdate(b)
    Y.applyUpdate(server, baselineUpdate, null) // baseline: not attributed to a peer
  }
  const clients = new Map()
  for (const key of new Set(ops.map(o => o[0]))) {
    const d = new Y.Doc()
    if (baselineUpdate) Y.applyUpdate(d, baselineUpdate, null)
    clients.set(key, d)
  }
  const origins = new Map([...clients.keys()].map(k => [k, {}])) // per-client identity for attribution
  for (const [client, pos, text] of ops) {
    clients.get(client).getText('content').insert(pos, text)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(clients.get(client)), origins.get(client))
  }
  await SLEEP(SETTLE_MS)
  const edits = tracker.recentEdits()
  return { emits, edits, editCount: edits.length }
}

const results = []
for (const s of SCENARIOS) {
  const { emits, edits, editCount } = await runScenario(s)
  if (s.label === 'flag' && editCount === 0) console.warn(`[eval] WARN ${s.name}: zero edits recorded — scenario likely misconstructed`)
  results.push({ ...s, emits, edits })
}

// --- confusion matrix (label vs pipeline decision) ---
let tp = 0, fp = 0, fn = 0, tn = 0
console.log('\nscenario                        label    heuristic   flagged  conf   source        note')
for (const r of results) {
  const flagged = r.emits.length > 0
  const e = r.emits[0]
  if (r.label === 'flag' && flagged) tp++
  else if (r.label === 'flag' && !flagged) fn++
  else if (r.label === 'noflag' && flagged) fp++
  else tn++
  console.log(
    `${r.name.padEnd(30)} ${r.label.padEnd(7)} ${heuristicVerdict(r.edits).padEnd(11)} ` +
    `${(flagged ? 'FLAG  ' : '—').padEnd(7)} ${(e ? String(e.confidence).padEnd(5) : '').padEnd(7)} ` +
    `${(e ? e.source : '').padEnd(12)} ${r.note}`)
}
const precision = tp + fp ? tp / (tp + fp) : 0
const recall = tp + fn ? tp / (tp + fn) : 0
const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0

console.log('\nconfusion matrix            flagged  noflag')
console.log(`  label=flag (should flag)   ${String(tp).padEnd(7)} ${fn}`)
console.log(`  label=noflag (should not)  ${String(fp).padEnd(7)} ${tn}`)
console.log(`\nprecision = ${precision.toFixed(3)}  recall = ${recall.toFixed(3)}  F1 = ${f1.toFixed(3)}  (${useLlm ? 'heuristic + Gemini' : 'heuristic-only'})`)
