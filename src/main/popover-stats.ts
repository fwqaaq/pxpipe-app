import type { PopoverStatsPayload } from '../shared/types'

export interface PopoverEventRow {
  ts: string
  estimatedSavedTokens: number | null
  baselineTokens: number | null
}

const HOUR_MS = 3_600_000

export function computePopoverStats(
  rows: PopoverEventRow[],
  now: Date = new Date()
): PopoverStatsPayload {
  const nowMs = now.getTime()
  const currentHourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const firstHourStart = currentHourStart - 23 * HOUR_MS
  const series = Array.from({ length: 24 }, (_, i) => ({
    hourStart: firstHourStart + i * HOUR_MS,
    requests: 0,
    savedTokens: 0
  }))

  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const midnightMs = midnight.getTime()

  let todayRequests = 0
  let todaySaved = 0
  let todayBaseline = 0

  for (const row of rows) {
    const t = Date.parse(row.ts)
    if (!Number.isFinite(t) || t > nowMs) continue

    // Bucket by distance from "now" (not from firstHourStart) so the last
    // bucket always represents the hour ending at "now", even when "now"
    // itself lands exactly on an hour boundary.
    const hoursAgo = Math.floor((nowMs - t) / HOUR_MS)
    if (hoursAgo >= 0 && hoursAgo < 24) {
      const bucket = 23 - hoursAgo
      series[bucket].requests += 1
      series[bucket].savedTokens += row.estimatedSavedTokens ?? 0
    }
    if (t >= midnightMs) {
      todayRequests += 1
      todaySaved += row.estimatedSavedTokens ?? 0
      todayBaseline += row.baselineTokens ?? 0
    }
  }

  return {
    today: {
      requests: todayRequests,
      savedTokens: todaySaved,
      savedPct: todayBaseline === 0 ? 0 : (todaySaved / todayBaseline) * 100
    },
    series
  }
}
