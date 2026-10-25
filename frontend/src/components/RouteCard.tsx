import type { Level, RouteResult } from '../types'
import { LEVEL_COLORS, LEVEL_NAMES, ROUTE_COLORS, fmtHours, fmtMiles, levelColor } from '../risk'

interface Props {
  route: RouteResult
  selected: boolean
  onSelect: () => void
}

export default function RouteCard({ route, selected, onSelect }: Props) {
  const s = route.summary
  const miles: [Level, number][] = [
    [0, s.low_miles], [1, s.moderate_miles], [2, s.high_miles], [3, s.severe_miles], [4, s.no_travel_miles],
  ]
  const total = Math.max(1, s.distance_miles)
  return (
    <button type="button" className={`card ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
      <div className="card-head">
        <span className="swatch" style={{ background: ROUTE_COLORS[route.id % ROUTE_COLORS.length] }} />
        <h3>{route.name}</h3>
        {route.recommended ? <span className="tag">Recommended</span> : <span className="tag rank">#{route.rank}</span>}
      </div>
      <div className="stats">
        <span><b>{fmtMiles(s.distance_miles)}</b></span>
        <span><b>{fmtHours(s.duration_hours)}</b></span>
        <span className="pill" style={{ background: levelColor(s.max_level) }}>worst: {s.max_level_name}</span>
      </div>
      <div className="bar" title="Miles by risk level">
        {miles.filter(([, m]) => m > 0).map(([lvl, m]) => (
          <span key={lvl} style={{ width: `${(m / total) * 100}%`, background: LEVEL_COLORS[lvl] }} />
        ))}
      </div>
      <div className="bar-legend">
        {miles.filter(([lvl, m]) => m > 0 || lvl === 0).map(([lvl, m]) => (
          <span key={lvl}><i style={{ background: LEVEL_COLORS[lvl] }} />{LEVEL_NAMES[lvl]} {Math.round(m)} mi</span>
        ))}
        <span>avg {s.average_risk.toFixed(2)}</span>
      </div>
    </button>
  )
}
