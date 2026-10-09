export type TurnStats = {
  hitPercent: number | null
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
