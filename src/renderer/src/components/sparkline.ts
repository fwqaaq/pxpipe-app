export function sparklinePoints(values: number[], width: number, height: number, pad = 2): string {
  if (values.length === 0) return ''
  const max = Math.max(...values, 1)
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const step = values.length > 1 ? innerW / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = pad + i * step
      const y = pad + innerH - (Math.max(0, v) / max) * innerH
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
    })
    .join(' ')
}
