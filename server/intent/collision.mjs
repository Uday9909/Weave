// Collision tracker: observes a room's Y.Text and records per-client insert
// ranges, attributed to the transaction origin (the sending connection).
// Edits are buffered into a burst and clustered by proximity; a cluster where
// different clients' edits touch is the unit the heuristic judges.
//
// Clustering (not pairwise regions) is what makes the signal visible: Yjs
// concatenates concurrent inserts, so two typing streams in the same slot
// collapse to adjacent blocky runs. Only the cluster carries the fact that
// several clients were writing into one nearby region at the same time.
const TEXT_TYPE = 'content'
const WINDOW_MS = 8000 // edits older than this are settled, not candidates
const BUFFER_MS = 350 // judge a burst once typing pauses
const CLUSTER_GAP = 2 // ranges this close (in chars) join one cluster

/** Group edits whose ranges touch into clusters involving 2+ clients. */
export function clusterEdits(edits) {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to)
  const clusters = []
  for (const edit of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && edit.from <= last.to + CLUSTER_GAP) {
      last.to = Math.max(last.to, edit.to)
      last.edits.push(edit)
    } else {
      clusters.push({ from: edit.from, to: edit.to, edits: [edit] })
    }
  }
  return clusters.filter(c => new Set(c.edits.map(e => e.client)).size >= 2)
}

export function createCollisionTracker(doc, onClusters) {
  const ytext = doc.getText(TEXT_TYPE)
  let edits = []
  let pending = []
  let lastClusters = []
  let flushTimer = null
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

  const flush = () => {
    flushTimer = null
    const clusters = clusterEdits(pending)
    pending = []
    lastClusters = clusters
    if (clusters.length) onClusters(clusters)
  }

  const scheduleFlush = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(flush, BUFFER_MS)
    flushTimer.unref()
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
    prune()
    if (cur === prev) return
    const client = labelOf(origin)
    let s = 0
    while (s < prev.length && s < cur.length && prev[s] === cur[s]) s++
    let pe = prev.length, ce = cur.length
    while (pe > s && ce > s && prev[pe - 1] === cur[ce - 1]) { pe--; ce-- }
    const inserted = cur.slice(s, ce)
    if (inserted.length) {
      const edit = { id: ++editSeq, client, from: s, to: ce, text: inserted, ts: Date.now() }
      edits.push(edit)
      pending.push(edit)
      scheduleFlush()
    }
    prev = cur
  }

  ytext.observe(observe)
  return {
    recentEdits: () => edits,
    recentClusters: () => lastClusters,
  }
}
