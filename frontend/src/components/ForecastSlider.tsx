import { useEffect, useMemo, useState } from 'react'
import type { Heatmap, Level } from '../types'
import { LEVEL_COLORS, LEVEL_NAMES, fmtForecastTime } from '../risk'

interface Props {
  hour: number
  heatmap: Heatmap
  onChange: (h: number) => void
  departureUtc: string
  timeZone: string
}

/** 0-48 h forecast slider for the corridor heatmap, with a play button and a timeline
 *  strip showing the worst risk anywhere on the corridor at each hour. */
export default function ForecastSlider({ hour, heatmap, onChange, departureUtc, timeZone }: Props) {
  const [playing, setPlaying] = useState(false)
  const max = heatmap.hours
  const worstByHour = useMemo(
    () => heatmap.levels.map((row) => row.reduce((m, l) => (l > m ? l : m), 0 as Level)),
    [heatmap],
  )
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => onChange(hour >= max ? 0 : hour + 1), 450)
    return () => clearInterval(t)
  }, [playing, hour, max, onChange])
  const now = worstByHour[Math.min(hour, worstByHour.length - 1)]
  return (
    <div className="overlay slider">
      <div className="slider-head">
        <span>Corridor weather risk · worst now: <b style={{ color: LEVEL_COLORS[now] }}>{LEVEL_NAMES[now]}</b></span>
        <b>Departure +{hour} h · {fmtForecastTime(departureUtc, hour, timeZone)}</b>
      </div>
      <div className="slider-row">
        <button type="button" className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="#0f172a"><rect x="2" y="1" width="3" height="10" /><rect x="7" y="1" width="3" height="10" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="#0f172a"><path d="M2 1l9 5-9 5z" /></svg>
          )}
        </button>
        <input type="range" min={0} max={max} step={1} value={hour} onChange={(e) => { setPlaying(false); onChange(Number(e.target.value)) }} aria-label="Forecast hour" />
        <span style={{ fontSize: 12, color: 'var(--muted)', width: 36, textAlign: 'right' }}>{max} h</span>
      </div>
      <div className="timeline" title="Worst risk level on the corridor, hour by hour">
        {worstByHour.map((l, i) => <span key={i} style={{ background: LEVEL_COLORS[l], opacity: i === hour ? 1 : 0.75 }} />)}
      </div>
      <div className="timeline-labels"><span>+0 h</span><span>+12 h</span><span>+24 h</span><span>+36 h</span><span>+48 h</span></div>
    </div>
  )
}
