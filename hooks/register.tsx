import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, TurnStepResult, TurnUsage } from 'claude-code'

import type { CostStats, TurnStats } from '../types'
import type { Appearance } from './color'
import { appearanceOf, tint } from './color'
import { costOf, freshHit, ratesFor, shownCost } from './cost'
import { appMode, linuxDark, macDark, winDark } from './platform'

const turn = atom({ plugin: 'prompt-stats', key: 'turn' } as const, null)
const cost = atom({ plugin: 'prompt-stats', key: 'cost' } as const, null)
const appearance = atom({ plugin: 'prompt-stats', key: 'appearance' } as const, null)

// Characters of streamed output — the answer or the thinking, billed alike —
// one output token is worth, so the yuan can move while a response streams.
// The API's own count replaces it the moment the step lands.
const CHARS_PER_TOKEN = 3
const PENDING_TICK = 0.0005

// No response has reported yet; the field keeps its width either way.
const NO_HIT = '    —%'

let streamed = 0

// The conversation's ledger key in the host's store, which outlives the
// process; set once the session's id is known.
let costKey: string | null = null

// The step names the model Claude Code asked for; the model that answers only
// arrives with the response's usage. Price by the last one seen.
let answered = 'deepseek-flash'

// Which surface draws the line; `session.start` does not say, the first draw
// does. The desktop app's own mode is only read for it.
let surface: string | null = null

// The machine's own appearance, asked of each platform in turn; the first
// probe that answers decides, and none answering leaves it unknown.
async function probeSystemDark($: EngineInterface): Promise<boolean | null> {
  const run = (command: string[]) => $.process.run(command).catch(() => undefined)

  const mac = macDark(await run(['defaults', 'read', '-g', 'AppleInterfaceStyle']))
  if (mac !== null) return mac

  const win = winDark(
    await run([
      'reg',
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
      '/v',
      'AppsUseLightTheme',
    ]),
  )
  if (win !== null) return win

  return linuxDark(
    await run(['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme']),
  )
}

// The desktop app keeps its own light/dark control in its `config.json`
// (`userThemeMode`), separate from Claude Code's theme row; both installs'
// files are candidates and the newest written one is the app that runs.
// null: no app answered.
async function readAppMode($: EngineInterface): Promise<Appearance | null> {
  const home = await $.env.get('HOME').catch(() => undefined)
  const appData = await $.env.get('APPDATA').catch(() => undefined)

  const candidates: string[] = []

  if (home !== undefined) {
    for (const app of ['Claude-3p', 'Claude']) {
      candidates.push(`${home}/Library/Application Support/${app}/config.json`)
      candidates.push(`${home}/.config/${app}/config.json`)
    }
  }
  if (appData !== undefined) {
    for (const app of ['Claude-3p', 'Claude']) {
      candidates.push(`${appData}\\${app}\\config.json`)
    }
  }

  let newest: { path: string; mtimeMs: number } | null = null

  for (const path of candidates) {
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat === undefined || stat.kind !== 'file') continue
    if (newest === null || stat.mtimeMs > newest.mtimeMs) {
      newest = { path, mtimeMs: stat.mtimeMs }
    }
  }

  if (newest === null) return null

  const text = await $.fs.read(newest.path).catch(() => undefined)
  if (text === undefined) return null

  try {
    const parsed: unknown = JSON.parse(text)
    const mode =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { userThemeMode?: unknown }).userThemeMode
        : undefined
    return appMode(mode)
  } catch {
    return null
  }
}

// What a fresh process restores, off the session's own start: the ledger a
// conversation left in the store, and the appearance with its poll.
async function boot($: EngineInterface): Promise<void> {
  // A conversation with a saved ledger picks its total back up, so a restart
  // does not lose the record. Its id keys the ledger; without one, the
  // project's directory does.
  let key = 'cost:unknown'
  try {
    key = `session-cost:${await $.session.id()}`
  } catch {
    try {
      key = `cost:${await $.session.cwd()}`
    } catch {
      // Neither answered: one shared ledger stands in.
    }
  }
  costKey = key

  const saved = await $.store.get(costKey).catch(() => undefined)
  // The ledger is `{ cny, hit, at }`; an older build stored the bare cost
  // number, and both shapes read back here.
  const record =
    typeof saved === 'object' && saved !== null
      ? (saved as { cny?: unknown; hit?: unknown; at?: unknown })
      : null
  const cny =
    typeof saved === 'number' ? saved : typeof record?.cny === 'number' ? record.cny : undefined
  const hit = typeof record?.hit === 'number' ? record.hit : null
  const at = typeof record?.at === 'number' ? record.at : null

  const held = await read($, cost)
  if (held === null && cny !== undefined && cny > 0) {
    await update($, cost, () => ({ cny: cny as number, live: 0, pending: 0 }))
  }

  const heldTurn = await read($, turn)
  if (heldTurn === null && hit !== null && freshHit(at, await $.clock.now())) {
    await update($, turn, () => ({ hitPercent: hit as number }))
  }

  await readAppearance($)
  watchAppearance($)
}

// The app's own control leads on the desktop; Claude Code's theme row decides
// otherwise, and only where that leaves the pair open (`auto`, a row the host
// does not report) does the machine's probe. Runs at session start, on a theme
// change, as each turn lands, and on the poll below — the app's and the
// machine's own switches are caught by that poll alone.
async function readAppearance($: EngineInterface): Promise<void> {
  const rows = await $.config.list().catch(() => undefined)
  const setting = rows?.find(row => row.key === 'theme')?.value

  let mode: Appearance | null = null
  let systemDark: boolean | null = null
  let look: Appearance

  if (surface === 'desktop') {
    // The app's own control leads. With `system` (or no answer) its window
    // follows the machine, so the probe decides; Claude Code's theme row does
    // not drive the app window and stays out of it.
    mode = await readAppMode($)
    if (mode !== null) {
      look = mode
    } else {
      systemDark = await probeSystemDark($)
      look =
        systemDark === null ? appearanceOf(setting, null) : systemDark ? 'dark' : 'light'
    }
  } else {
    // A terminal draws with Claude Code's theme row exactly.
    if (setting !== 'light' && setting !== 'dark') {
      systemDark = await probeSystemDark($)
    }
    look = appearanceOf(setting, systemDark)
  }

  const held = await read($, appearance)
  if (held !== look) {
    await update($, appearance, () => look)
    // A write alone does not reach the screen; the draw is asked for, so the
    // switch shows while the session sits idle instead of at the next turn.
    $.ui.invalidate('ui.render')
  }
}

// The machine's appearance can change while the session runs and nobody asks
// anything of it, and no API announces the switch, so a quiet poll re-reads the
// pair and asks for the draw every period — the ask is what makes the switch
// show without a turn. A period short enough to read as immediate.
const APPEARANCE_POLL_MS = 1_000
let appearancePoll: Timer | null = null

function watchAppearance($: EngineInterface): void {
  if (appearancePoll !== null) return
  appearancePoll = $.clock.every(APPEARANCE_POLL_MS, () => {
    void readAppearance($)
      .catch(() => undefined)
      .then(() => $.ui.invalidate('ui.render'))
  })
}

// The row is right-aligned, so a figure that grows a digit drags the whole line
// sideways. Each keeps a width of its own instead.
function money(value: number): string {
  return `¥${value.toFixed(3).padStart(7)}`
}

function percent(hit: number): string {
  return `${hit.toFixed(1)}%`.padStart(6)
}

function hitOf(usage: TurnUsage): number | null {
  const input =
    usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  return input > 0 ? Math.round((usage.cache_read_input_tokens / input) * 1000) / 10 : null
}

async function showHit($: EngineInterface, usage: TurnUsage): Promise<void> {
  const hitPercent = hitOf(usage)
  await update($, turn, previous =>
    previous !== null && previous.hitPercent === hitPercent ? previous : { hitPercent },
  )
}

// One response of a turn landed: its own counts take over the running estimate,
// and its hit rate is the conversation's latest the moment it arrives.
async function settleStep($: EngineInterface, usage: TurnUsage): Promise<void> {
  streamed = 0

  const rates = ratesFor(usage.model, await $.clock.now())

  if (rates !== null) {
    answered = usage.model
    const spent = costOf(usage, rates)
    await update($, cost, previous => ({
      cny: previous?.cny ?? 0,
      live: (previous?.live ?? 0) + spent,
      pending: 0,
    }))
  } else {
    await update($, cost, previous => ({
      cny: previous?.cny ?? 0,
      live: previous?.live ?? 0,
      pending: 0,
    }))
  }

  await showHit($, usage)
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Restored behind the first frame, never in front of it: the draw reads
    // empty state as placeholders while this runs.
    void boot($).catch(() => undefined)
    return result
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    await readAppearance($).catch(() => undefined)
    return result
  })

  // Watch the answer stream past and move the estimate with it; settle each
  // response as its usage lands, and hand the engine's own result back whole.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }

    const rates = ratesFor(answered, await $.clock.now())
    const source = next(e)[Symbol.asyncIterator]()
    let result: TurnStepResult | undefined
    let settled = false

    for (;;) {
      const piece = await source.next()

      if (piece.done === true) {
        result = piece.value
        break
      }

      const chunk = piece.value

      if (
        rates !== null &&
        (chunk.kind === 'text' || chunk.kind === 'thinking') &&
        chunk.text.length > 0
      ) {
        streamed += chunk.text.length
        const pending = ((streamed / CHARS_PER_TOKEN) * rates.out) / 1_000_000
        const previous = await read($, cost)

        if (previous === null || pending - (previous.pending ?? 0) >= PENDING_TICK) {
          await update($, cost, () => ({
            cny: previous?.cny ?? 0,
            live: previous?.live ?? 0,
            pending,
          }))
          // A write alone does not repaint the footer while a turn runs.
          $.ui.invalidate('ui.render')
        }
      }

      // Usage rides the response's last chunk; the step's result carries it too
      // when a hook beneath dropped the chunk, so settle on either, once.
      if (chunk.kind === 'stop' && chunk.usage !== null) {
        settled = true
        await settleStep($, chunk.usage)
      }

      yield chunk
    }

    if (!settled && result !== undefined && result.usage !== null) {
      await settleStep($, result.usage)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage
    const isMain = e.agentId === undefined

    if (usage !== undefined) {
      const rates = ratesFor(usage.model, await $.clock.now())

      if (rates !== null) {
        answered = usage.model
        const spent = costOf(usage, rates)

        if (isMain) {
          // The turn's own total is the whole truth: the steps' running sum was
          // only the display, so it gives way to it rather than adding to it.
          await update($, cost, previous => ({
            cny: (previous?.cny ?? 0) + spent,
            live: 0,
            pending: 0,
          }))
        } else {
          await update($, cost, previous => ({
            cny: (previous?.cny ?? 0) + spent,
            live: previous?.live ?? 0,
            pending: previous?.pending ?? 0,
          }))
        }
      } else if (isMain) {
        await update($, cost, previous => ({
          cny: (previous?.cny ?? 0) + (previous?.live ?? 0),
          live: 0,
          pending: 0,
        }))
      }
    } else if (isMain) {
      // An interrupt or an error: what the finished responses cost is still real.
      await update($, cost, previous => ({
        cny: (previous?.cny ?? 0) + (previous?.live ?? 0),
        live: 0,
        pending: 0,
      }))
    }

    if (isMain) {
      streamed = 0
      // The machine's appearance can change under a running session.
      await readAppearance($).catch(() => undefined)

      if (usage !== undefined) {
        await showHit($, usage)
      }

      // Write the conversation's ledger where a restart can find it.
      if (costKey !== null) {
        const settled = await read($, cost)
        const reading = await read($, turn)
        await $.store
          .set(costKey, {
            cny: settled?.cny ?? 0,
            hit: reading?.hitPercent ?? null,
            at: await $.clock.now(),
          })
          .catch(() => undefined)
      }
    }

    return result
  })

  on('session.end', async ($, e, next) => {
    streamed = 0

    // /clear starts the conversation over: its ledger goes with it. A quit or
    // a switch keeps it, so the record survives restarts.
    if (costKey !== null && e.reason === 'clear') {
      await $.store.delete(costKey).catch(() => undefined)
    }

    await update($, turn, () => null)
    await update($, cost, () => null)

    return next(e)
  })

  // The prompt footer's own site: the line under the prompt box. Drawn from the
  // first frame; a figure not yet reported reads as a placeholder, not absence.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    if (surface === null) {
      surface = e.surface
      void readAppearance($).catch(() => undefined)
    }

    const last = await read($, turn)
    const spent = await read($, cost)
    const look = (await read($, appearance)) ?? 'dark'

    const hit = last?.hitPercent ?? null

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexGrow={1} justifyContent="flex-end">
        <Text>{money(shownCost(spent))}</Text>
        <Text dimColor> · </Text>
        {hit === null ? (
          <Text dimColor>缓存命中率{NO_HIT}</Text>
        ) : (
          <Text color={tint(hit, look)}>{`缓存命中率${percent(hit)}`}</Text>
        )}
      </Box>
    )
  })
}
