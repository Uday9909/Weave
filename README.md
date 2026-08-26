# Weave — Real-Time Collaborative Text Editor with Intent-Preservation Assistance

A real-time collaborative text editor exploring a problem that CRDT-based
systems don't actually solve on their own: when concurrent edits touch
overlapping text, the merge is always *conflict-free* (guaranteed by the
CRDT), but it is not always *meaning-preserving*. This project builds a
working CRDT-based editor and adds a lightweight AI layer that flags — not
silently auto-corrects — regions where a merge likely mangled intent.

This README doubles as the project's decision log. Every architectural
choice below has a stated reason, because "why did you pick X" is the
first question this project should get in an interview.

## Why this project exists (the honest version)

- CRDTs guarantee **strong eventual consistency**, not **semantic
  correctness**. Two users editing the same sentence differently will
  always merge into *something* — but that something can be
  unreadable garbage. This is a documented, named failure mode
  (character interleaving), not a hypothetical.
- Rich-text CRDT research (Peritext, Ink & Switch) explicitly states
  that formatting intent can be modeled, but *semantic* intent cannot
  be — that still requires human judgment. This project doesn't
  claim to solve that. It claims to help a human notice when they
  need to look.
- Tombstone-based CRDTs have unbounded state growth as a known,
  measurable cost. This project treats that as a first-class metric,
  not an afterthought — the README will contain real before/after
  compaction numbers, not just a demo GIF.

## Scope (v1 — deliberately narrow)

**In scope:**
- Plain text only. No rich-text formatting in v1.
- Real-time multi-user sync via Yjs (not a hand-rolled CRDT).
- Live cursors + presence (who's online, where they're editing).
- Periodic tombstone compaction with measured size impact.
- Post-merge heuristic + LLM-assisted flagging of likely
  intent-mangled regions, surfaced as a suggestion, never a silent
  auto-edit.
- A small, self-authored test suite of scripted concurrent-edit
  scenarios used to report the flagging feature's actual
  precision/recall — not a vague "AI-powered" claim.

**Explicitly out of scope for v1 (and why):**
- Rich text / formatting — its own multi-month CRDT research problem
  (see Peritext).
- Offline-first sync — different, harder problem (state-vector
  reconciliation on reconnect); revisit only after v1 is solid.
- Auto-resolving merges without human review — research shows LLMs
  can produce truncated or wrong output on this exact task class;
  auto-applying that would be a reliability regression, not a
  feature.

## Architecture

```
client/          React + Vite frontend
  ├─ editor/      CodeMirror-based editor bound to a Yjs document
  ├─ presence/    Cursor + avatar overlay, driven by Yjs awareness
  └─ flags/       UI for surfaced intent-mismatch suggestions

server/           Node.js
  ├─ ws/           y-websocket provider (sync relay + persistence)
  ├─ compaction/   Scheduled tombstone GC job + size logging
  └─ intent/       Post-merge diff analysis -> LLM flagging service
```

**Why Yjs, not a hand-rolled CRDT:** writing a correct sequence CRDT is a
research-grade problem — multiple published algorithms have later been
shown incorrect, including some with claimed mechanized proofs. Yjs is
production-tested; the interesting engineering here is what's built
around it, not reimplementing it.

**Why CRDT over OT:** OT (Google Docs' choice) needs a central
coordinating server and is harder to reason about correctness-wise
outside that model. CRDTs (Figma's choice, post-2019) trade some
metadata overhead for simpler, peer-symmetric merge guarantees, which
fits a project meant to be inspected and reasoned about by one person
end to end.

## Metrics this project will actually report

(Filled in as the project progresses — placeholders below are what
*will* be measured, not fabricated numbers.)

- Concurrent editors tested at: TBD
- Sync latency (local network, measured): TBD
- Document size with vs. without compaction: 3068 → 2268 bytes (−26%) after
  20 edit+delete cycles (measured by `server/compaction/selfcheck.mjs`). The
  compaction job also logs per-room metrics to `server/compaction/metrics.log`
  over time, and reaps rooms idle past `IDLE_TIMEOUT_MIN`.
- Intent-flagging precision/recall on the scripted test scenario set (12
  human-labeled scenarios in `server/intent/eval.mjs`, replayed through the
  real pipeline; run with `npm run eval` / `npm run eval:llm`):
  - **Heuristic-only:** flags nothing (recall 0.0, zero false positives).
    Yjs concatenates concurrent same-spot inserts, so every collision
    collapses to two runs and the heuristic's `mangled` path (needs 4+
    alternating runs) never fires on a real merge. The `ambiguous → LLM`
    step is not optional decoration — it carries the entire signal.
  - **Heuristic + Gemini:** precision 1.000, recall 0.857, F1 0.923 — 6 of
    7 should-flag scenarios flagged, 0 of 5 should-not-flag scenarios
    flagged. The single miss was a duplicated word the judge called
    acceptable. Caveat: the free Gemini tier rate-limits hard; a back-to-
    back run scored recall 0.143 because most judge calls returned HTTP
    429. Replay is deterministic — only the external judge varies.

## Status

Phase 1 (sync skeleton), Phase 2 (presence), Phase 3 (compaction), and Phase 4
(intent flagging) live. Two browser tabs on the same room show live edits,
colored cursors with names, and a who's-online strip. When two users edit the
same spot concurrently, a server-side pipeline (collision tracker → heuristic
gate → Gemini judge) flags likely-mangled merges: a banner appears and the
flagged range is underlined. A scheduled server job compacts tombstone growth
and reaps idle rooms. The LLM judge needs a Gemini key in `server/.env`
(`GEMINI_API_KEY`); without it the pipeline runs heuristic-only and flags less,
because Yjs concatenates concurrent same-position inserts rather than
interleaving them (so the ambiguous→LLM path carries most of the signal).

## Local development

```bash
# server
cd server && npm install && npm run dev
# (optional: cp server/.env.example server/.env and set GEMINI_API_KEY for the LLM judge)

# client
cd client && npm install && npm run dev
```

## Phase 1 — verify

1. Open `http://localhost:5173/?room=demo` in **two** tabs (any room id works).
2. Type in tab A — it appears live in tab B (and vice versa).
3. Refresh tab A while B stays open — content re-syncs.
4. Kill and restart only the client — the document survives (state is
   kept in memory on the server).

Note: document state is in-memory on the server — there is no durable
store yet. That is a deliberate Phase-1 boundary; the persistence
plug-in point is marked in `server/ws/index.js`.

## License

MIT
