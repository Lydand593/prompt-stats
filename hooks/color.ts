export type Appearance = 'dark' | 'light'

// The dark trio as it reads on black. The light trio is blue at 100%, orange
// at the 97.5% stop, red at 95% and below, each legible on white; the blue is
// the desktop app's own spinner blue.
const RAMPS: Record<Appearance, { high: string; mid: string; low: string }> = {
  dark: { high: '#98ff98', mid: '#ffb347', low: '#e06c75' },
  light: { high: '#2978d5', mid: '#ea580c', low: '#dc2626' },
}

function mix(from: string, to: string, t: number): string {
  const channels = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
  const start = channels(from)
  const end = channels(to)
  const mixed = start.map((value, index) =>
    Math.round(value + ((end[index] ?? value) - value) * Math.max(0, Math.min(1, t))),
  )
  return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

// 100% the high end, 97.5% the amber, 95% and below the low end; the stops mix
// in between.
export function tint(hit: number, appearance: Appearance): string {
  const { high, mid, low } = RAMPS[appearance]
  if (hit <= 95) return low
  if (hit >= 100) return high
  if (hit <= 97.5) return mix(low, mid, (hit - 95) / 2.5)
  return mix(mid, high, (hit - 97.5) / 2.5)
}

export function appearanceOf(setting: unknown, systemDark: boolean | null): Appearance {
  if (setting === 'light') return 'light'
  if (setting === 'dark') return 'dark'
  // `auto`: the host reports the setting, not the appearance it resolved to, so
  // the machine's own answer stands in for it.
  return systemDark === false ? 'light' : 'dark'
}
