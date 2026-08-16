import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'

const SERVER_URL = 'ws://localhost:1234'
// Room id comes from ?room=<id>; all tabs sharing it sync to the same document.
const ROOM = new URLSearchParams(window.location.search).get('room') ?? 'weave-demo'

export default function Editor() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(SERVER_URL, ROOM, doc)
    const type = doc.getText('content')
    const undoManager = new Y.UndoManager(type)

    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        extensions: [
          basicSetup,
          // Note: y-codemirror.next's current signature is yCollab(ytext, awareness, { undoManager })
          // — the older (undoManager, ytext, awareness) ordering no longer works.
          yCollab(type, provider.awareness, { undoManager }),
        ],
      }),
    })

    return () => {
      view.destroy()
      provider.destroy()
      doc.destroy()
    }
  }, [])

  return <div ref={hostRef} className="editor-host" />
}
