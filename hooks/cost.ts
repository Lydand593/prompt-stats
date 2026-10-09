export type Rates = { hit: number; miss: number; out: number }

// DeepSeek's published rates, CNY per million tokens.
const FLASH: Rates = { hit: 0.02, miss: 1, out: 4 }
const PRO: Rates = { hit: 0.15, miss: 4.5, out: 13.5 }

// Beijing time, Monday to Friday, 9:00-12:00 and 14:00-18:00; the peak rate is
// twice the off-peak one.
function isPeak(at: number): boolean {
  const when = new Date(at)
  const day = when.getDay()
  if (day === 0 || day === 6) return false
  const hour = when.getHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

export function ratesFor(model: string, at: number): Rates | null {
  if (!model.startsWith('deepseek')) return null
  const base = model.includes('pro') ? PRO : FLASH
  const factor = isPeak(at) ? 2 : 1
  return { hit: base.hit * factor, miss: base.miss * factor, out: base.out * factor }
}

export type Tokens = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function costOf(usage: Tokens, rates: Rates): number {
  return (
    (usage.cache_read_input_tokens * rates.hit +
      (usage.input_tokens + usage.cache_creation_input_tokens) * rates.miss +
      usage.output_tokens * rates.out) /
    1_000_000
  )
}

// A restored hit rate is a measurement, not a ledger: it only stands while
// the provider's cache plausibly does. DeepSeek clears an unused cache within
// hours; two and a half of them is the window this keeps.
export const HIT_FRESH_MS = 2.5 * 60 * 60 * 1000

export function freshHit(at: number | null, now: number): boolean {
  return at !== null && now - at <= HIT_FRESH_MS
}

export type Spend = { cny?: number; live?: number; pending?: number }

// One conversation's ledger entry as the store carries it; an older build
// stored the bare cost number, and both shapes read back here.
export type Ledger = { cny: number; hit?: number | null; at?: number }

// The best of two sightings of one conversation's ledger: the larger total,
// or at equal totals the later stamp. Only ever for the same conversation.
export function pickLedger(current: Ledger | null, candidate: unknown): Ledger | null {
  const record =
    typeof candidate === 'object' && candidate !== null
      ? (candidate as { cny?: unknown; hit?: unknown; at?: unknown })
      : null
  const cny =
    typeof candidate === 'number'
      ? candidate
      : typeof record?.cny === 'number'
        ? record.cny
        : undefined
  if (cny === undefined) return current

  const entry: Ledger = {
    cny,
    hit: typeof record?.hit === 'number' ? record.hit : null,
    at: typeof record?.at === 'number' ? record.at : undefined,
  }

  if (current === null) return entry
  if (entry.cny !== current.cny) return entry.cny > current.cny ? entry : current
  return (entry.at ?? 0) > (current.at ?? 0) ? entry : current
}

// A reload keeps the host's state, so what is stored may predate the shape this
// code writes; a missing part reads as nothing rather than NaN. `cny` sums the
// settled turns, `live` the running turn's landed responses, `pending` the
// estimate for the response still streaming.
export function shownCost(value: Spend | null): number {
  return (value?.cny ?? 0) + (value?.live ?? 0) + (value?.pending ?? 0)
}
