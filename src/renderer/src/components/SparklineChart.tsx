import { sparklinePoints } from './sparkline'

export function Sparkline({
  values,
  width = 312,
  height = 40,
  className
}: {
  values: number[]
  width?: number
  height?: number
  className?: string
}): React.JSX.Element {
  const points = sparklinePoints(values, width, height)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
      {points ? (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : (
        <line
          x1="2"
          y1={height - 2}
          x2={width - 2}
          y2={height - 2}
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.4"
        />
      )}
    </svg>
  )
}
