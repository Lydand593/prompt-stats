// Whether the machine's own appearance is dark, as each platform's probe
// answers it: macOS `defaults` (the key exists only while dark), Windows'
// registry (AppsUseLightTheme is 0 while dark), Linux's gsettings (the colour
// scheme names prefer-dark). A probe is undefined when it never ran; one that
// ran carries its exit code and output. null: that platform did not answer.
export type Probe = { exitCode: number; stdout: string } | undefined

export function macDark(probe: Probe): boolean | null {
  if (probe === undefined) return null
  return probe.exitCode === 0
}

export function winDark(probe: Probe): boolean | null {
  if (probe === undefined) return null
  const value = /AppsUseLightTheme\s+REG_DWORD\s+0x([01])/i.exec(probe.stdout)
  return value === null ? null : value[1] === '0'
}

export function linuxDark(probe: Probe): boolean | null {
  if (probe === undefined || probe.exitCode !== 0) return null
  if (probe.stdout.trim() === '') return null
  return probe.stdout.includes('prefer-dark')
}
