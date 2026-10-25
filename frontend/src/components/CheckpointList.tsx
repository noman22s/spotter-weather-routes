import { useEffect, useRef } from 'react'
import type { Checkpoint, RouteResult } from '../types'
import { levelColor } from '../risk'

interface Props {
  route: RouteResult
  interval: number
  focus: Checkpoint | null
  onFocus: (c: Checkpoint) => void
}

function icon(c: Checkpoint) {
  if (c.snow_in >= 0.1) return '❄️'
  if (c.rain_in >= 0.05) return '🌧️'
  if (c.wind_mph >= 25) return '💨'
  const t = c.condition.toLowerCase()
  if (t.includes('thunder')) return '⛈️'
  if (t.includes('fog')) return '🌫️'
  if (t.includes('overcast')) return '☁️'
  if (t.includes('cloud')) return '⛅'
  return '☀️'
}

export default function CheckpointList({ route, interval, focus, onFocus }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focus || !ref.current) return
    ref.current.querySelector<HTMLElement>(`[data-mile="${focus.mile}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="section-title">
        <h4>{route.name} checkpoints</h4>
        <span>every {interval} mi · {route.checkpoints.length} points</span>
      </div>
      <div className="cps" ref={ref}>
        {route.checkpoints.map((c) => (
          <button type="button" key={c.mile} data-mile={c.mile} className={`cp ${focus?.mile === c.mile ? 'active' : ''}`} onClick={() => onFocus(c)} title={`${c.level_name}: ${c.driver}`}>
            <span className="mile">mi {Math.round(c.mile)}</span>
            <span className="ico" aria-hidden="true">{icon(c)}</span>
            <span className="what">
              {c.condition || 'Forecast'} · {c.temp_f}°F
              <small>wind {Math.round(c.wind_mph)} mph (gusts {Math.round(c.gust_mph)}) · rain {c.rain_in} · snow {c.snow_in} in/h</small>
            </span>
            <span className="eta">{c.eta_local}</span>
            <span className="dot" style={{ background: levelColor(c.level) }} />
          </button>
        ))}
      </div>
    </div>
  )
}
