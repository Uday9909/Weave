import { provider } from '../lib/collab'
import { identity } from '../lib/user'
import { usePresence } from './usePresence'

export function Presence() {
  const peers = usePresence()

  return (
    <div className="presence">
      <input
        className="presence-name"
        defaultValue={identity.name}
        aria-label="Your name"
        onChange={(e) => {
          const name = e.target.value.trim() || identity.name
          provider.awareness.setLocalStateField('user', { ...identity, name })
        }}
      />
      <ul className="presence-list" aria-label="Who's online">
        {peers.map((peer) => (
          <li key={peer.clientID} className="presence-pill">
            <span className="presence-dot" style={{ background: peer.color }} />
            {peer.name}
            {peer.isSelf && <span className="presence-you">(you)</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
