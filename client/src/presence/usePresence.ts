import { useSyncExternalStore } from 'react'
import { provider } from '../lib/collab'

export interface Peer {
  clientID: number
  name: string
  color: string
  colorLight: string
  isSelf: boolean
}

function readPeers(): Peer[] {
  const peers: Peer[] = []
  provider.awareness.getStates().forEach((state, clientID) => {
    const user = state.user
    peers.push({
      clientID,
      name: user?.name ?? `User ${clientID}`,
      color: user?.color ?? '#5b8def',
      colorLight: user?.colorLight ?? '#5b8def55',
      isSelf: clientID === provider.awareness.clientID,
    })
  })
  return peers
}

// Referentially stable until the next awareness change — a fresh array per
// call would send useSyncExternalStore into an infinite re-render loop.
let snapshot: Peer[] = readPeers()

function subscribe(cb: () => void) {
  const listener = () => {
    snapshot = readPeers()
    cb()
  }
  provider.awareness.on('change', listener)
  return () => {
    provider.awareness.off('change', listener)
  }
}

export function usePresence(): Peer[] {
  return useSyncExternalStore(subscribe, () => snapshot)
}
