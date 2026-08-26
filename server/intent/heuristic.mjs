// Deterministic interleaving gate over a collision region's recent edits.
//   mangled   — many tiny alternating runs from different clients (the named
//               character-interleaving failure mode) => flag, high confidence.
//   ambiguous — concurrent same-spot edits but blocky (concatenation) => LLM decides.
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
  if (new Set(runs.map(r => r.client)).size < 2) return { verdict: 'benign', runs }
  const lo = Math.min(...runs.map(r => r.from))
  const hi = Math.max(...runs.map(r => r.to))
  const avgRunLen = (hi - lo + 1) / runs.length
  if (runs.length >= 4 && avgRunLen < 2.5) return { verdict: 'mangled', runs }
  if (runs.length >= 2) return { verdict: 'ambiguous', runs }
  return { verdict: 'benign', runs }
}
