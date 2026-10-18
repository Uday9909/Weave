# Weave — Real-Time Collaborative Text Editor with Intent-Preservation Assistance

![CI](https://github.com/Uday9909/Weave/actions/workflows/ci.yml/badge.svg)

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

- Concurrent editors tested at: 2, 10, and 25 editors, all inserting at the
  same position in the same tick. Every run converged to identical text, in
  p50 **0.43 ms / 2.01 ms / 15.12 ms** respectively (3 rounds each; measured
  on localhost by `client/bench/sync.mjs`).
- Sync latency (local network, measured): **p50 0.07 ms, p95 0.51 ms, max
  2.26 ms** over 50 sequential edits between two editors (`npm run bench`
  from `client/`).
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

Phase 1 (sync skeleton), Phase 2 (presence), Phase 3 (compaction), Phase 4
(intent flagging), and Phase 5 (eval harness) live, plus durable persistence
and a Render deploy blueprint. Two browser tabs on the same room show live
edits, colored cursors with names, and a who's-online strip. When two users
edit the same spot concurrently, a server-side pipeline (collision tracker →
heuristic gate → Gemini judge) flags likely-mangled merges: a banner appears
and the flagged range is underlined. A scheduled server job compacts tombstone
growth and reaps idle rooms. The LLM judge needs a Gemini key in `server/.env`
(`GEMINI_API_KEY`); without it the pipeline runs heuristic-only and flags less,
because Yjs concatenates concurrent same-position inserts rather than
interleaving them (so the ambiguous→LLM path carries most of the signal).
Documents are snapshotted to `server/.data` (override with `WEAVE_DATA_DIR`)
and reloaded after a restart.

## Local development

```bash
# server
cd server && npm install && npm run dev
# (optional: cp server/.env.example server/.env and set GEMINI_API_KEY for the LLM judge)

# client
cd client && npm install && npm run dev
```

## Tests and benchmarks

```bash
# server: intent selfcheck, persistence round-trip, flagging eval
cd server && npm test

# client: typecheck + production build, then the sync benchmark
cd client && npx tsc --noEmit && npm run build
npm run bench
```

CI runs the server suite and the client typecheck/build on every push and PR.

## Deploy (Render)

`render.yaml` provisions two services: `weave-server` (Node web service with
WebSocket support) and `weave-client` (static Vite build).

1. In Render: **New → Blueprint**, connect this repo; it reads `render.yaml`.
2. After the first deploy, set `GEMINI_API_KEY` on `weave-server`
   (Dashboard → Environment) to enable LLM-assisted flagging. Without it the
   pipeline runs heuristic-only.
3. Open the `weave-client` URL. `VITE_WS_HOST` is wired from the server's host
   automatically, and the client upgrades it to `wss://`.

The free tier's disk is ephemeral: snapshots survive process restarts but not
redeploys. For durable hosting, attach a persistent disk to `weave-server`
and point `WEAVE_DATA_DIR` at it.

Other hosts: the client reads `VITE_WS_URL` (full `wss://…` URL) first, then
`VITE_WS_HOST` (host only), and otherwise falls back to
`ws://<location.hostname>:1234` for local development.

## Phase 1 — verify

1. Open `http://localhost:5173/?room=demo` in **two** tabs (any room id works).
2. Type in tab A — it appears live in tab B (and vice versa).
3. Refresh tab A while B stays open — content re-syncs.
4. Kill and restart only the client — the document survives (state is
   kept in memory on the server).

Note: documents are snapshotted to `server/.data` (`WEAVE_DATA_DIR` overrides
the path) and reloaded on restart. On hosts with ephemeral disks — Render's
free tier, for example — snapshots do not survive a redeploy.

## License

MIT
