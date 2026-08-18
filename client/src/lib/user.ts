// Identity for this tab's presence. `?name=` overrides the random name —
// handy when testing two tabs side by side.
const PALETTE = [
  { name: 'Aardvark', color: '#5b8def', colorLight: '#5b8def55' },
  { name: 'Badger', color: '#e05252', colorLight: '#e0525255' },
  { name: 'Coyote', color: '#e09f3e', colorLight: '#e09f3e55' },
  { name: 'Dolphin', color: '#9d4edd', colorLight: '#9d4edd55' },
  { name: 'Emu', color: '#2ec4b6', colorLight: '#2ec4b655' },
  { name: 'Falcon', color: '#f77f00', colorLight: '#f77f0055' },
]

const pick = PALETTE[Math.floor(Math.random() * PALETTE.length)]

export const identity = {
  name: new URLSearchParams(window.location.search).get('name') || pick.name,
  color: pick.color,
  colorLight: pick.colorLight,
}
