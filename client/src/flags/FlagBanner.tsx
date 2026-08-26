import { EditorView } from '@codemirror/view'
import { useFlags } from './useFlags'
import { editorView } from '../lib/editorView'

export function FlagBanner() {
  const { flags, dismiss } = useFlags()
  if (flags.length === 0) return null
  return (
    <div className="flag-banner" aria-label="Merge intent flags">
      {flags.map(f => (
        <div className="flag-item" key={f.id}>
          <button type="button" className="flag-body" onClick={() => scrollTo(f.region.from)}>
            <strong>{f.reason}</strong>
            <span className="flag-conf">conf {Math.round(f.confidence * 100)}%</span>
          </button>
          <button type="button" className="flag-dismiss" onClick={() => dismiss(f.id)} aria-label="Dismiss flag">×</button>
        </div>
      ))}
    </div>
  )
}

function scrollTo(pos: number) {
  const view = editorView.get()
  if (view) view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
}
