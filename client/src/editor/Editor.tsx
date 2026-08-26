import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { yCollab } from 'y-codemirror.next'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { doc, provider } from '../lib/collab'
import { identity } from '../lib/user'
import { flagField, syncFlags } from '../flags/flagPlugin'
import { flagsStore } from '../flags/flagsStore'
import { editorView } from '../lib/editorView'

export default function Editor() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const type = doc.getText('content')
    const undoManager = new Y.UndoManager(type)

    // Advertise who we are; y-codemirror.next renders remote cursors with these.
    provider.awareness.setLocalStateField('user', identity)

    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        extensions: [
          basicSetup,
          // Note: y-codemirror.next's current signature is yCollab(ytext, awareness, { undoManager })
          // — the older (undoManager, ytext, awareness) ordering no longer works.
          yCollab(type, provider.awareness, { undoManager }),
          flagField,
        ],
      }),
    })
    editorView.set(view)
    syncFlags(view, flagsStore.visible())
    if (import.meta.env.DEV) (window as any).__weave = { view, doc, provider }
    const unsub = flagsStore.subscribe(() => syncFlags(view, flagsStore.visible()))

    return () => {
      unsub()
      editorView.set(null)
      view.destroy()
      provider.awareness.setLocalState(null) // leave the room cleanly
    }
  }, [])

  return <div ref={hostRef} className="editor-host" />
}
