// Intent pipeline: collision tracker -> heuristic gate -> Gemini on ambiguity.
// Emits a flag per mangled region; never mutates the document.
import { createCollisionTracker } from './collision.mjs'
import { interleaveVerdict } from './heuristic.mjs'
import { judgeMerge } from './llm.mjs'

const TEXT_TYPE = 'content'
const COOLDOWN_MS = 1500 // pause between flags so active typing isn't a flag storm
const LLM_COOLDOWN_MS = 800 // don't hammer the free Gemini tier on ambiguous spam

export function startIntentPipeline(doc, room, emit) {
  let lastFlagAt = 0
  let lastLlmAt = 0
  let flagSeq = 0
  return createCollisionTracker(doc, async (candidates) => {
    for (const region of candidates) {
      const { verdict, runs } = interleaveVerdict(region.edits)
      if (verdict === 'benign') continue
      if (Date.now() - lastFlagAt < COOLDOWN_MS) break
      let flagged = verdict === 'mangled'
      let confidence = verdict === 'mangled' ? 0.9 : 0.5
      let reason = verdict === 'mangled'
        ? 'Concurrent edits interleaved out of order.'
        : 'Concurrent edits landed in the same spot — intent may be mangled.'
      if (verdict === 'ambiguous') {
        if (Date.now() - lastLlmAt < LLM_COOLDOWN_MS) continue
        lastLlmAt = Date.now()
        // Slice the full concurrent block, not the diff-attributed region: Yjs
        // places concurrent inserts side-by-side, so the block starts at the
        // earliest edit offset and spans the combined length of all edit texts.
        // Slicing region.from..region.to alone can capture just one client's block.
        const editTexts = [...new Set(region.edits.map(e => e.text))]
        const ytext = doc.getText(TEXT_TYPE)
        const blockStart = Math.min(...region.edits.map(e => e.from))
        const mergedText = ytext.toString().slice(blockStart, Math.min(ytext.length, blockStart + editTexts.join('').length))
        const llm = await judgeMerge({ mergedText, editTexts })
        if (llm) { flagged = llm.flagged; confidence = llm.confidence; reason = llm.reason }
      }
      if (!flagged) continue
      lastFlagAt = Date.now()
      emit({ id: ++flagSeq, room, region: { from: region.from, to: region.to }, confidence, reason })
    }
  })
}
