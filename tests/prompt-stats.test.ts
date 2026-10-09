import { expect, mock, test } from 'claude-code/testing'
import type { MountTarget } from 'claude-code/testing'
import type {
  TurnCompleteInput,
  TurnStepInput,
  TurnStepResult,
  TurnUsage,
} from 'claude-code'

import { appearanceOf, tint } from '../hooks/color'
import { costOf, ratesFor, shownCost } from '../hooks/cost'
import { appMode, linuxDark, macDark, winDark } from '../hooks/platform'

test(`the rates follow DeepSeek's own table (off-peak, a Saturday)`, async () => {
  const offPeak = Date.parse('2026-10-10T12:00:00Z')
  expect(ratesFor('deepseek-flash', offPeak)).toEqual({ hit: 0.02, miss: 1, out: 4 })
  expect(ratesFor('deepseek-v4-pro', offPeak)).toEqual({ hit: 0.15, miss: 4.5, out: 13.5 })
  // A model Claude Code is not running against DeepSeek: nothing to price.
  expect(ratesFor('claude-opus-5-5', offPeak)).toBeNull()
})

test(`a figure stored before this shape reads as a number, not NaN`, async () => {
  // What an older version of this plugin left in the session's state.
  expect(shownCost(null)).toBe(0)
  expect(shownCost({ cny: 1.5 })).toBe(1.5)
  expect(shownCost({ cny: 1.5, pending: 0.25 })).toBe(1.75)
  // Settled turns, the running turn's landed responses, the live estimate.
  expect(shownCost({ cny: 1.5, live: 0.5, pending: 0.25 })).toBe(2.25)
})

test(`a turn is priced from its own counts, a cache write as a miss`, async () => {
  const rates = { hit: 0.02, miss: 1, out: 4 }
  const tokens = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  expect(costOf({ ...tokens, input_tokens: 1_000_000 }, rates)).toBe(1)
  expect(costOf({ ...tokens, cache_creation_input_tokens: 1_000_000 }, rates)).toBe(1)
  expect(
    costOf({ ...tokens, cache_read_input_tokens: 1_000_000, output_tokens: 1_000_000 }, rates),
  ).toBe(4.02)
})

test('the hit rate ramp runs red to amber to mint, in either appearance', async () => {
  expect(tint(90, 'dark')).toBe('#e06c75')
  expect(tint(95, 'dark')).toBe('#e06c75')
  expect(tint(97.5, 'dark')).toBe('#ffb347')
  expect(tint(100, 'dark')).toBe('#98ff98')
  expect(tint(120, 'dark')).toBe('#98ff98')

  // The light ramp is blue, orange, red: red under 95, orange at the stop,
  // the spinner's blue at 100, all legible on white.
  expect(tint(95, 'light')).toBe('#dc2626')
  expect(tint(97.5, 'light')).toBe('#ea580c')
  expect(tint(100, 'light')).toBe('#2978d5')
  expect(tint(96, 'light')).not.toBe('#e06c75')
})

test('the appearance follows the setting, and the machine under auto', async () => {
  // The setting wins outright, even against the machine's answer.
  expect(appearanceOf('dark', false)).toBe('dark')
  expect(appearanceOf('light', true)).toBe('light')
  // Its variants count by what they start with.
  expect(appearanceOf('light-daltonized', true)).toBe('light')
  expect(appearanceOf('dark-ansi', false)).toBe('dark')
  // `auto` asks the machine.
  expect(appearanceOf('auto', true)).toBe('dark')
  expect(appearanceOf('auto', false)).toBe('light')
  // The probe failed, or there is no theme row: the dark pair stands.
  expect(appearanceOf('auto', null)).toBe('dark')
  expect(appearanceOf(undefined, null)).toBe('dark')
})

test(`the desktop app's own mode reads as it stores it`, async () => {
  expect(appMode('light')).toBe('light')
  expect(appMode('dark')).toBe('dark')
  // `system`, an older spelling, or nothing: the choice stays open.
  expect(appMode('system')).toBeNull()
  expect(appMode(undefined)).toBeNull()
  expect(appMode(3)).toBeNull()
})

test(`each platform's probe reads its own way, and silence is not an answer`, async () => {
  // macOS: the key exists only while dark; its absence (exit 1) is light.
  expect(macDark(undefined)).toBeNull()
  expect(macDark({ exitCode: 0, stdout: 'Dark\n' })).toBe(true)
  expect(macDark({ exitCode: 1, stdout: '' })).toBe(false)

  // Windows: AppsUseLightTheme is 0 while dark, 1 while light.
  const win = (value: string) => ({
    exitCode: 0,
    stdout:
      '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\r\n' +
      `    AppsUseLightTheme    REG_DWORD    ${value}\r\n\r\n`,
  })
  expect(winDark(undefined)).toBeNull()
  expect(winDark(win('0x0'))).toBe(true)
  expect(winDark(win('0x1'))).toBe(false)
  expect(winDark({ exitCode: 0, stdout: 'no value here' })).toBeNull()

  // Linux: the colour scheme names prefer-dark; another scheme is light.
  expect(linuxDark(undefined)).toBeNull()
  expect(linuxDark({ exitCode: 1, stdout: '' })).toBeNull()
  expect(linuxDark({ exitCode: 0, stdout: "'prefer-dark'\n" })).toBe(true)
  expect(linuxDark({ exitCode: 0, stdout: "'default'\n" })).toBe(false)
})

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

// A Saturday: off-peak in every time zone, so the rates below are fixed.
const NOW = Date.parse('2026-10-10T12:00:00Z')

const footer = <P extends Surface>(
  surface: P,
  modes: readonly string[] = [],
): MountTarget<P, 'SessionMode'> => ({
  plugin: 'prompt-stats',
  surface,
  component: 'SessionMode',
  props: { modes },
})

const DONE: TurnCompleteInput = {
  turnId: 't',
  answer: '',
  durationMs: 1,
  isAborted: false,
  reason: 'answer',
}

const STEP: TurnStepInput = {
  turnId: 't',
  index: 0,
  model: 'deepseek-flash',
  messageCount: 3,
}

const ANSWER: TurnStepResult = {
  turnId: 't',
  index: 0,
  answer: 'fictional',
  toolUses: [],
  stopReason: 'end_turn',
  usage: null,
}

// Fictional figures: uncached input, cache reads, cache writes, output.
const usage = (
  input: number,
  read: number,
  created: number,
  output: number,
): TurnUsage => ({
  model: 'deepseek-flash',
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: created,
})

for (const surface of SURFACES) {
  test(`the hit rate carries its colour into the drawn line (${surface})`, async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    // What sits beneath the plugin: the engine's own mode labels.
    on('ui.render', { component: 'SessionMode' }, ($, e) =>
      $.ui.resolve(e).Text({ children: e.props.modes.join(' & ') }),
    )

    mock.clock(on, { now: NOW })
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount(footer(surface))

    // Nothing reported yet: the line is drawn all the same, placeholders and all.
    expect(await ui.find({ type: 'Text', text: /^¥  0\.000$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^缓存命中率    —%$/ })).toBeDefined()

    await $.turn.complete({ ...DONE, usage: usage(0, 100, 0, 0) })
    expect((await ui.find({ type: 'Text', text: /^缓存命中率100.0%$/ }))?.props.color).toBe('#98ff98')

    // 95 in 100 read from the cache: the ramp's other end.
    await $.turn.complete({ ...DONE, turnId: 'b', usage: usage(5, 95, 0, 0) })
    expect((await ui.find({ type: 'Text', text: /^缓存命中率 95.0%$/ }))?.props.color).toBe('#e06c75')

    // The amber stop sits between them at 97.5.
    await $.turn.complete({ ...DONE, turnId: 'c', usage: usage(3, 97, 0, 0) })
    const near = (await ui.find({ type: 'Text', text: /^缓存命中率 97.0%$/ }))?.props.color
    expect(near).not.toBe('#e06c75')
    expect(near).not.toBe('#98ff98')
  })

  test(`climbs while the answer streams and settles to the API's own count (${surface})`, async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', { component: 'SessionMode' }, ($, e) =>
      $.ui.resolve(e).Text({ children: e.props.modes.join(' & ') }),
    )
    on('turn.step', async function* () {
      yield { kind: 'thinking' as const, index: 0, text: 'x'.repeat(30_000) }
      yield { kind: 'text' as const, index: 0, text: 'x'.repeat(75_000) }
      return ANSWER
    })

    mock.clock(on, { now: NOW })
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount(footer(surface))

    const source = $.turn.step(STEP)[Symbol.asyncIterator]()
    const chunks: unknown[] = []
    let result: TurnStepResult | undefined

    for (;;) {
      const piece = await source.next()
      if (piece.done === true) {
        result = piece.value
        break
      }
      chunks.push(piece.value)

      if (chunks.length === 1) {
        // The thinking streams too, and is billed: 30000 characters at three to
        // a token, four yuan a million: 0.04.
        expect(await ui.find({ type: 'Text', text: /^¥  0\.040$/ })).toBeDefined()
      }

      if (chunks.length === 2) {
        // The answer's 75000 characters carry the estimate to 0.14.
        expect(await ui.find({ type: 'Text', text: /^¥  0\.140$/ })).toBeDefined()
      }
    }

    // The answer still reached the caller, and so did the engine's own result.
    expect(chunks).toHaveLength(2)
    expect(result?.stopReason).toBe('end_turn')

    // A million uncached input tokens, off-peak: one yuan, and the estimate is gone.
    await $.turn.complete({ ...DONE, usage: usage(1_000_000, 0, 0, 0) })
    expect(await ui.find({ type: 'Text', text: /^¥  1\.000$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^缓存命中率  0.0%$/ })).toBeDefined()
  })

  test(`settles each response as it lands, before the turn ends (${surface})`, async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', { component: 'SessionMode' }, ($, e) =>
      $.ui.resolve(e).Text({ children: e.props.modes.join(' & ') }),
    )

    // A million read at the hit rate, a million answered at the output rate.
    const counted = usage(0, 1_000_000, 0, 1_000_000)
    on('turn.step', async function* () {
      yield { kind: 'text' as const, index: 0, text: 'x'.repeat(75_000) }
      yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: counted }
      return { ...ANSWER, usage: counted }
    })

    mock.clock(on, { now: NOW })
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount(footer(surface))

    const source = $.turn.step(STEP)[Symbol.asyncIterator]()

    // The running estimate first: 75 000 characters at three to a token.
    await source.next()
    expect(await ui.find({ type: 'Text', text: /^¥  0\.100$/ })).toBeDefined()

    // The response's own counts land on its stop chunk, mid-turn: 0.02 for the
    // million read plus 4 for the million answered, the estimate under them.
    await source.next()
    expect(await ui.find({ type: 'Text', text: /^¥  4\.020$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^缓存命中率100.0%$/ })).toBeDefined()

    // The turn's total replaces the running sum, never adds to it.
    const last = await source.next()
    expect(last.done).toBe(true)
    await $.turn.complete({ ...DONE, usage: counted })
    expect(await ui.find({ type: 'Text', text: /^¥  4\.020$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^缓存命中率100.0%$/ })).toBeDefined()
  })

  test(`counts a subagent's spend but not its hit rate, and starts over on /clear (${surface})`, async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    on('ui.render', { component: 'SessionMode' }, ($, e) =>
      $.ui.resolve(e).Text({ children: e.props.modes.join(' & ') }),
    )

    mock.clock(on, { now: NOW })
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount(footer(surface))

    await $.turn.complete({ ...DONE, usage: usage(1_000_000, 0, 0, 0) })
    expect(await ui.find({ type: 'Text', text: /^缓存命中率  0.0%$/ })).toBeDefined()

    // A subagent's turn is its own conversation, but its tokens are still paid for.
    await $.turn.complete({
      ...DONE,
      turnId: 'sub',
      agentId: 'a1',
      usage: usage(1_000_000, 0, 0, 0),
    })
    expect(await ui.find({ type: 'Text', text: /^¥  2\.000$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^缓存命中率  0.0%$/ })).toBeDefined()

    // A cache-heavy turn: a million read at 0.02, a million answered at 4.
    await $.turn.complete({ ...DONE, turnId: 'b', usage: usage(0, 1_000_000, 0, 1_000_000) })
    expect(await ui.find({ type: 'Text', text: /^¥  6\.020$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^缓存命中率100.0%$/ })).toBeDefined()

    // /clear ends the conversation: the figures start over, the line stays.
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(await ui.find({ type: 'Text', text: /^¥  0\.000$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^缓存命中率    —%$/ })).toBeDefined()
  })

  test(`the appearance poll runs underneath without disturbing the line (${surface})`, async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', { component: 'SessionMode' }, ($, e) =>
      $.ui.resolve(e).Text({ children: e.props.modes.join(' & ') }),
    )

    const clock = mock.clock(on, { now: NOW })
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    const ui = await $.ui.mount(footer(surface))

    await $.turn.complete({ ...DONE, usage: usage(0, 100, 0, 0) })
    expect(await ui.find({ type: 'Text', text: /^缓存命中率100\.0%$/ })).toBeDefined()

    // Two poll periods pass; the appearance is asked again and kept as it was.
    await clock.advance(10_000)
    expect(await ui.find({ type: 'Text', text: /^缓存命中率100\.0%$/ })).toBeDefined()
  })

  test(`the ledger survives a restart, and /clear starts fresh (${surface})`, async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    on('ui.render', { component: 'SessionMode' }, ($, e) =>
      $.ui.resolve(e).Text({ children: e.props.modes.join(' & ') }),
    )

    const clock = mock.clock(on, { now: NOW })
    mock.store(on, {})

    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    await clock.settle()
    const ui = await $.ui.mount(footer(surface))

    await $.turn.complete({ ...DONE, usage: usage(1_000_000, 0, 0, 0) })
    expect(await ui.find({ type: 'Text', text: /^¥  1\.000$/ })).toBeDefined()

    // A restart is an end and a start over the same conversation: the total
    // comes back from the store. /clear is an end that takes the ledger with it.
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /^¥  1\.000$/ })).toBeDefined()

    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await $.session.start({ surface, isInteractive: true, cwd: '/work' })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: /^¥  0\.000$/ })).toBeDefined()
  })
}
