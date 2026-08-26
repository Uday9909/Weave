// CodeMirror decorations for flagged ranges, driven by the external flags store.
import { Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import type { Flag } from './flagsStore'

const setFlags = StateEffect.define<Flag[]>()
const flagMark = Decoration.mark({ attributes: { class: 'cm-flag' } })

export const flagField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setFlags)) value = build(e.value)
    }
    return value
  },
  provide: f => EditorView.decorations.from(f),
})

function build(flags: Flag[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  for (const f of flags) {
    if (f.region.to <= f.region.from) continue
    b.add(f.region.from, f.region.to, flagMark)
  }
  return b.finish()
}

export function syncFlags(view: EditorView, flags: Flag[]) {
  view.dispatch({ effects: setFlags.of(flags) })
}
