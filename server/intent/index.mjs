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
  return createCollisionTracker(doc, async (clusters) => {
    for (const region of clusters) {
      const { verdict, runs, signal } = interleaveVerdict(region.edits)
      if (verdict === 'benign') continue
      if (Date.now() - lastFlagAt < COOLDOWN_MS) break
      // Edits record their offset at observation time, so concurrent inserts
      // that stacked at one spot under-report the merged block. Span the
      // combined inserted length instead — that is what Yjs placed side by side.
      const ytext = doc.getText(TEXT_TYPE)
      const regionFrom = Math.min(...region.edits.map(e => e.from))
      const regionTo = Math.min(ytext.length, regionFrom + region.edits.reduce((n, e) => n + e.text.length, 0))
      let flagged = verdict === 'mangled'
      let confidence = verdict === 'mangled' ? 0.9 : 0.5
      const MANGLED_REASONS = {
        'typing-streams': 'Two clients typed into the same region; Yjs concatenated their streams.',
        'duplicate-text': 'Two clients inserted the same text in the same spot — duplicated in the merge.',
        'multi-client': 'Three or more clients collided in the same spot.',
        'interleaved-runs': 'Concurrent edits interleaved out of order.',
      }
      let reason = verdict === 'mangled'
        ? MANGLED_REASONS[signal] ?? 'Concurrent edits landed in the same spot.'
        : 'Concurrent edits landed in the same spot — intent may be mangled.'
      if (verdict === 'ambiguous') {
        if (Date.now() - lastLlmAt < LLM_COOLDOWN_MS) continue
        lastLlmAt = Date.now()
        const editTexts = [...new Set(region.edits.map(e => e.text))]
        const mergedText = ytext.toString().slice(regionFrom, regionTo)
        const llm = await judgeMerge({ mergedText, editTexts })
        if (llm) { flagged = llm.flagged; confidence = llm.confidence; reason = llm.reason }
      }
      if (!flagged) continue
      lastFlagAt = Date.now()
      emit({ id: ++flagSeq, room, region: { from: regionFrom, to: regionTo }, confidence, reason, source: verdict === 'mangled' ? 'heuristic' : 'llm' })
    }
  })
}
