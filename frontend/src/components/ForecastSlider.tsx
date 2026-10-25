import { useEffect, useState } from 'react'
import { fmtForecastTime } from '../risk'

interface Props {
  hour: number
  max: number
  onChange: (h: number) => void
  departureUtc: string
  timeZone: string
}

/** 0-48 h forecast slider for the corridor heatmap, with a play button. */
export default function ForecastSlider({ hour, max, onChange, departureUtc, timeZone }: Props) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => onChange(hour >= max ? 0 : hour + 1), 450)
    return () => clearInterval(t)
  }, [playing, hour, max, onChange])
  return (
    <div className="overlay slider">
      <div className="slider-head">
        <span>Corridor weather risk</span>
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
    </div>
  )
}
