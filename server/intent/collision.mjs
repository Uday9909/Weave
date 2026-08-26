// Collision tracker: observes a room's Y.Text and records per-client insert
// ranges, attributed to the transaction origin (the sending connection). Emits
// candidate regions where two clients' edits overlap — the raw merge signal,
// since Yjs has no explicit "merge event".
const TEXT_TYPE = 'content'
const WINDOW_MS = 8000 // edits older than this are settled, not candidates
const TOUCH_GAP = 2 // ranges this close (in chars) count as touching

export function createCollisionTracker(doc, onCandidate) {
  const ytext = doc.getText(TEXT_TYPE)
  let edits = []
  let editSeq = 0
  let labelSeq = 0
  const labels = new Map()
  const labelOf = (origin) => {
    let l = labels.get(origin)
    if (l === undefined) { l = 'client-' + (++labelSeq); labels.set(origin, l) }
    return l
  }

  const prune = () => {
    const now = Date.now()
    edits = edits.filter(e => now - e.ts < WINDOW_MS)
  }

  // Surface each overlapping pair once (until it ages out) so active typing
  // doesn't re-assess the same collision on every keystroke.
  const seen = new Set()
  const pruneSeen = () => {
    const live = new Set(edits.map(e => e.id))
    for (const k of seen) {
      if (!k.split(':').some(id => live.has(Number(id)))) seen.delete(k)
    }
  }

  // ponytail: O(n²) over the window's edits. Fine at demo scale (hundreds of
  // edits/8s); a position-indexed structure would matter at high throughput.
  const findCandidates = () => {
    const out = []
    for (let i = 0; i < edits.length; i++) {
      for (let j = i + 1; j < edits.length; j++) {
        const a = edits[i]; const b = edits[j]
        if (a.client === b.client) continue
        const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from)
        if (overlap < -TOUCH_GAP) continue
        const key = `${a.id}:${b.id}`
        if (seen.has(key)) continue
        seen.add(key)
        const from = Math.min(a.from, b.from)
        const to = Math.max(a.to, b.to)
        // Every in-window edit intersecting the region (all involved clients).
        out.push({ from, to, edits: edits.filter(e => e.to >= from && e.from <= to) })
      }
    }
    return out
  }

  // One transaction == one client's update (a single y-websocket message), so a
  // common-prefix/suffix text diff attributes the whole change to that client.
  // (yjs v14 replaced YTextEvent.delta with a TextDelta class; toString()+diff
  // is version-stable.)
  // ponytail: a delete-only transaction records no edit, and insert+delete in
  // one transaction collapses to one span — fine for the interleave-focus v1.
  let prev = ''
  const observe = (_event, tx) => {
    const origin = tx.origin
    const cur = ytext.toString()
    if (origin == null) { prev = cur; return } // internal edits still advance the diff baseline
    prune(); pruneSeen()
    if (cur === prev) return
    const client = labelOf(origin)
    let s = 0
    while (s < prev.length && s < cur.length && prev[s] === cur[s]) s++
    let pe = prev.length, ce = cur.length
    while (pe > s && ce > s && prev[pe - 1] === cur[ce - 1]) { pe--; ce-- }
    const inserted = cur.slice(s, ce)
    if (inserted.length) {
      edits.push({ id: ++editSeq, client, from: s, to: ce, text: inserted, ts: Date.now() })
    }
    prev = cur
    if (edits.length) onCandidate(findCandidates())
  }

  ytext.observe(observe)
  return { recentEdits: () => edits }
}
