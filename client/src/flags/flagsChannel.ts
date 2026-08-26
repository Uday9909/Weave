// Lightweight JSON channel for flags. Kept separate from the y-websocket sync
// socket so the provider's message handling stays untouched.
import { flagsStore, type Flag } from './flagsStore'
import { ROOM } from '../lib/collab'

export function connectFlags() {
  let ws: WebSocket | null = null
  let retry = 0
  const open = () => {
    ws = new WebSocket(`ws://${location.hostname}:1234/flags/${ROOM}`)
    ws.onmessage = (ev) => {
      try {
        flagsStore.add(JSON.parse(ev.data) as Flag)
      } catch { /* ignore malformed frames */ }
    }
    ws.onclose = () => {
      retry++
      setTimeout(open, Math.min(1000 * 2 ** retry, 10000))
    }
    ws.onopen = () => { retry = 0 }
  }
  open()
  return () => ws?.close()
}
