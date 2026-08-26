import { useSyncExternalStore } from 'react'
import { flagsStore } from './flagsStore'

export function useFlags() {
  const flags = useSyncExternalStore(flagsStore.subscribe, flagsStore.get)
  return {
    flags: flags.filter(f => !f.dismissed),
    dismiss: flagsStore.dismiss,
  }
}
