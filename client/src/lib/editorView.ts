// Module ref to the active EditorView so non-editor UI (FlagBanner) can scroll
// to ranges without threading props through the editor's internals.
import type { EditorView } from '@codemirror/view'

let view: EditorView | null = null

export const editorView = {
  set(v: EditorView | null) { view = v },
  get() { return view },
}
