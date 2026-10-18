// Deterministic verdict over one cluster of concurrent edits, using
// provenance (which client wrote what, where) rather than final text alone.
//   mangled   — deterministic evidence the merge mangled intent:
//               * two typing streams (2+ edits from each of 2+ clients) in
//                 one nearby region — Yjs concatenates them, so the final
//                 text looks like two innocent blocks;
//               * different clients inserted the same non-blank text;
//               * 3+ clients collided in one cluster;
//               * 4+ short alternating runs (classic character interleave).
//   ambiguous — concurrent same-spot edits with no deterministic signal => LLM.
//   benign    — nothing to flag.
export function interleaveVerdict(edits) {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to)
  const runs = []
  for (const e of sorted) {
    const last = runs[runs.length - 1]
    if (last && last.client === e.client && e.from <= last.to + 1) {
      last.to = Math.max(last.to, e.to)
    } else {
      runs.push({ client: e.client, from: e.from, to: e.to })
    }
  }
  const clients = new Set(runs.map(r => r.client))
  if (clients.size < 2) return { verdict: 'benign', runs }

  // Two concurrent typing streams into one region.
  const editsPerClient = new Map()
  for (const e of sorted) editsPerClient.set(e.client, (editsPerClient.get(e.client) ?? 0) + 1)
  if ([...editsPerClient.values()].every(n => n >= 2)) {
    return { verdict: 'mangled', runs, signal: 'typing-streams' }
  }

  // The same non-blank text inserted by different clients duplicates in the merge.
  const seenText = new Map()
  for (const e of sorted) {
    const text = e.text?.trim()
    if (!text) continue
    const first = seenText.get(text)
    if (first && first !== e.client) return { verdict: 'mangled', runs, signal: 'duplicate-text' }
    if (!first) seenText.set(text, e.client)
  }

  // Three or more clients jammed into one cluster.
  if (clients.size >= 3) return { verdict: 'mangled', runs, signal: 'multi-client' }

  const lo = Math.min(...runs.map(r => r.from))
  const hi = Math.max(...runs.map(r => r.to))
  const avgRunLen = (hi - lo + 1) / runs.length
  if (runs.length >= 4 && avgRunLen < 2.5) return { verdict: 'mangled', runs, signal: 'interleaved-runs' }
  if (runs.length >= 2) return { verdict: 'ambiguous', runs }
  return { verdict: 'benign', runs }
}
