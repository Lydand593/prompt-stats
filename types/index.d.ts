export type TurnStats = {
  hitPercent: number | null
  /** When the reading was taken, in $.clock.now() milliseconds. */
  at?: number
}

export type CostStats = {
  cny: number
  live?: number
  pending?: number
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-stats': {
      turn: TurnStats | null
      cost: CostStats | null
      appearance: 'dark' | 'light' | null
    }
  }
}
