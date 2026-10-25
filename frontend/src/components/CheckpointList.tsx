import { useEffect, useRef } from 'react'
import type { Checkpoint, RouteResult } from '../types'
import { levelColor } from '../risk'

interface Props {
  route: RouteResult
  interval: number
  focus: Checkpoint | null
  onFocus: (c: Checkpoint) => void
}

export default function CheckpointList({ route, interval, focus, onFocus }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focus || !ref.current) return
    const el = ref.current.querySelector<HTMLElement>(`[data-mile="${focus.mile}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  return (
    <div>
      <div className="cp-head">
        <h4>{route.name} checkpoints</h4>
        <span>every {interval} mi · {route.checkpoints.length} samples</span>
      </div>
      <div className="cps" ref={ref}>
        {route.checkpoints.map((c) => (
          <button type="button" key={c.mile} data-mile={c.mile} className={`cp ${focus?.mile === c.mile ? 'active' : ''}`} onClick={() => onFocus(c)}>
            <span className="mile">mi {Math.round(c.mile)}</span>
            <span className="what">
              {c.eta_local} · {c.condition || 'Forecast'} · {c.temp_f}°F
              <small>wind {c.wind_mph} mph (gusts {c.gust_mph}) · rain {c.rain_in} in/h · snow {c.snow_in} in/h</small>
            </span>
            <span className="dot" title={`${c.level_name}: ${c.driver}`} style={{ background: levelColor(c.level) }} />
          </button>
        ))}
      </div>
    </div>
  )
}
