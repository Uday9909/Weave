// Gemini judge for ambiguous merges. Enforces a JSON shape via responseSchema.
// Fail-closed: missing key, non-200, parse error, or timeout all return null
// and the pipeline keeps the heuristic verdict.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
const TIMEOUT_MS = 10000 // thinking-flash can take a while; too tight and real judges abort
const ATTEMPTS = 3 // external API can flake; one transient failure shouldn't drop the flag
const RETRY_GAP_MS = 1000

export async function judgeMerge({ mergedText, editTexts }) {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`
  const prompt = [
    'Two users concurrently edited the same sentence in a collaborative editor.',
    `User A wrote: "${editTexts[0] ?? ''}"`,
    `User B wrote: "${editTexts[1] ?? ''}"`,
    `The merged result currently in the document reads: "${mergedText}"`,
    'Judge whether the merge likely mangled intent: interleaved characters,',
    'lost or duplicated words, garbled order, or meaning destroyed.',
    'Reply only as JSON: {"flagged": boolean, "confidence": 0..1, "reason": string}',
  ].join('\n')

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, RETRY_GAP_MS))
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: 'You assess collaborative-edit merges. Return only valid JSON matching the requested schema.' }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                flagged: { type: 'BOOLEAN' },
                confidence: { type: 'NUMBER' },
                reason: { type: 'STRING' },
              },
              required: ['flagged', 'confidence', 'reason'],
            },
          },
        }),
      })
      if (!res.ok) {
        console.error(`[intent] Gemini ${res.status}:`, (await res.text()).slice(0, 160))
        continue // non-2xx: transient, retry
      }
      const body = await res.json()
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) continue
      const out = JSON.parse(text)
      if (typeof out.flagged !== 'boolean') continue
      return {
        flagged: out.flagged,
        confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)),
        reason: String(out.reason ?? ''),
      }
    } catch (err) {
      console.error(`[intent] Gemini attempt ${attempt} failed:`, err?.name ?? err)
      continue
    } finally {
      clearTimeout(timer)
    }
  }
  console.error('[intent] Gemini unreachable after', ATTEMPTS, 'attempts (heuristic-only)')
  return null
}
