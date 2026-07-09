import { describe, expect, it } from 'vitest'
import { sparklinePoints } from '../src/renderer/src/components/sparkline'

describe('sparklinePoints', () => {
  it('returns empty string for no values', () => {
    expect(sparklinePoints([], 100, 40)).toBe('')
  })

  it('maps a flat zero series to the baseline', () => {
    const points = sparklinePoints([0, 0, 0], 100, 40)
    expect(points.split(' ')).toHaveLength(3)
    for (const p of points.split(' ')) expect(p.endsWith(',38')).toBe(true) // height - pad
  })

  it('maps max value to top pad and first/last x to the edges', () => {
    const points = sparklinePoints([0, 10], 100, 40).split(' ')
    expect(points[0]).toBe('2,38')
    expect(points[1]).toBe('98,2')
  })

  it('clamps negative values to the baseline', () => {
    const points = sparklinePoints([-5, 5], 100, 40).split(' ')
    expect(points[0]).toBe('2,38')
  })
})
