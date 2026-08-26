// Module-singleton flag store (same pattern as collab.ts's doc/provider).
// Flags arrive on the /flags/<room> channel; Editor + FlagBanner observe them.
export type Flag = {
  id: number
  region: { from: number; to: number }
  confidence: number
  reason: string
}

type StoreFlag = Flag & { dismissed: boolean }

let flags: StoreFlag[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export const flagsStore = {
  add(f: Flag) {
    flags = [...flags, { ...f, dismissed: false }]
    emit()
  },
  dismiss(id: number) {
    flags = flags.map(x => (x.id === id ? { ...x, dismissed: true } : x))
    emit()
  },
  get(): StoreFlag[] {
    return flags
  },
  visible(): Flag[] {
    return flags.filter(f => !f.dismissed)
  },
  subscribe(cb: () => void) {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  },
}
