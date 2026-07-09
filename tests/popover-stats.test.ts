import { describe, expect, it } from 'vitest'
import { computePopoverStats, type PopoverEventRow } from '../src/main/popover-stats'

// Local-time construction keeps "midnight" deterministic across timezones.
const now = new Date(2026, 6, 9, 12, 0, 0)

function row(msAgo: number, saved: number | null, baseline: number | null): PopoverEventRow {
  return {
    ts: new Date(now.getTime() - msAgo).toISOString(),
    estimatedSavedTokens: saved,
    baselineTokens: baseline
  }
}

describe('computePopoverStats', () => {
  it('returns zeros and 24 empty buckets for no rows', () => {
    const stats = computePopoverStats([], now)
    expect(stats.today).toEqual({ requests: 0, savedTokens: 0, savedPct: 0 })
    expect(stats.series).toHaveLength(24)
    expect(stats.series.every((b) => b.requests === 0 && b.savedTokens === 0)).toBe(true)
  })

  it('aggregates today totals and the current hour bucket', () => {
    const rows = [row(30 * 60 * 1000, 100, 400), row(31 * 60 * 1000, 50, 100)]
    const stats = computePopoverStats(rows, now)
    expect(stats.today.requests).toBe(2)
    expect(stats.today.savedTokens).toBe(150)
    expect(stats.today.savedPct).toBeCloseTo(30) // 150 / 500 * 100
    const last = stats.series[23]
    expect(last.requests).toBe(2)
    expect(last.savedTokens).toBe(150)
  })

  it('buckets an event from 3 hours ago into series[20] but still counts it today', () => {
    const stats = computePopoverStats([row(3 * 3600 * 1000, 10, 100)], now)
    expect(stats.series[20].requests).toBe(1)
    expect(stats.today.requests).toBe(1) // now is local noon, 3h ago is same day
  })

  it('ignores rows older than 24h and rows with unparsable ts', () => {
    const rows = [
      row(30 * 3600 * 1000, 999, 999),
      { ts: 'nope', estimatedSavedTokens: 1, baselineTokens: 1 }
    ]
    const stats = computePopoverStats(rows, now)
    expect(stats.today.requests).toBe(0)
    expect(stats.series.every((b) => b.requests === 0)).toBe(true)
  })

  it('treats null tokens as 0 and guards divide-by-zero', () => {
    const stats = computePopoverStats([row(60 * 1000, null, null)], now)
    expect(stats.today).toEqual({ requests: 1, savedTokens: 0, savedPct: 0 })
  })

  it('series hourStart values are consecutive hours ending at the current hour', () => {
    const stats = computePopoverStats([], now)
    const hour = 3_600_000
    const currentHourStart = Math.floor(now.getTime() / hour) * hour
    expect(stats.series[23].hourStart).toBe(currentHourStart)
    expect(stats.series[0].hourStart).toBe(currentHourStart - 23 * hour)
  })
})
