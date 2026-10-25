import { useState } from 'react'
import type { PlanRequest } from '../types'
import PlaceInput from './PlaceInput'

interface Props {
  value: PlanRequest
  onChange: (v: PlanRequest) => void
  onSubmit: () => void
  loading: boolean
  error: string | null
}

const LOADS = [20000, 35000, 45000]
const INTERVALS = [10, 25, 50] as const

export default function PlanForm({ value, onChange, onSubmit, loading, error }: Props) {
  const set = <K extends keyof PlanRequest>(k: K, v: PlanRequest[K]) => onChange({ ...value, [k]: v })
  const scenarioOn = value.wind_offset_mph > 0 || value.rain_offset_in > 0 || value.snow_offset_in > 0
  const [showScenario, setShowScenario] = useState(scenarioOn)
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <PlaceInput id="origin" label="Origin" value={value.origin} onChange={(v) => set('origin', v)} placeholder="City, ST or address" />
      <PlaceInput id="destination" label="Destination" value={value.destination} onChange={(v) => set('destination', v)} placeholder="City, ST or address" />
      <div className="row2">
        <div className="field">
          <label htmlFor="departure">Departure (local time at origin)</label>
          <input id="departure" type="datetime-local" value={value.departure} onChange={(e) => set('departure', e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="load">Load weight (lb)</label>
          <input id="load" type="number" min={0} max={200000} step={500} value={value.load_lbs} onChange={(e) => set('load_lbs', Number(e.target.value))} required />
        </div>
      </div>
      <div className="chips" aria-label="Quick load presets">
        {LOADS.map((l) => (
          <button type="button" key={l} className={value.load_lbs === l ? 'on' : ''} onClick={() => set('load_lbs', l)}>
            {l.toLocaleString()} lb
          </button>
        ))}
      </div>
      <div className="field">
        <label>Weather checkpoint every</label>
        <div className="segmented" role="radiogroup">
          {INTERVALS.map((i) => (
            <button type="button" key={i} role="radio" aria-checked={value.interval_miles === i} className={value.interval_miles === i ? 'on' : ''} onClick={() => set('interval_miles', i)}>
              {i} mi
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <button type="button" className="linkish" onClick={() => setShowScenario((s) => !s)} aria-expanded={showScenario}>
          {showScenario ? '▾' : '▸'} What-if scenario {scenarioOn && <span className="badge">on</span>}
        </button>
        {showScenario && (
          <div className="scenario">
            <p className="hint">Added to the real forecast at every point, to test the rules against worse weather. Leave at 0 for the forecast only.</p>
            <div className="row3">
              <label>Wind +mph<input type="number" min={0} max={80} step={5} value={value.wind_offset_mph} onChange={(e) => set('wind_offset_mph', Number(e.target.value))} /></label>
              <label>Rain +in/h<input type="number" min={0} max={3} step={0.1} value={value.rain_offset_in} onChange={(e) => set('rain_offset_in', Number(e.target.value))} /></label>
              <label>Snow +in/h<input type="number" min={0} max={5} step={0.5} value={value.snow_offset_in} onChange={(e) => set('snow_offset_in', Number(e.target.value))} /></label>
            </div>
            <div className="chips">
              <button type="button" onClick={() => onChange({ ...value, wind_offset_mph: 0, rain_offset_in: 0, snow_offset_in: 0 })}>Forecast only</button>
              <button type="button" onClick={() => onChange({ ...value, wind_offset_mph: 30, rain_offset_in: 0, snow_offset_in: 0 })}>Windy +30</button>
              <button type="button" onClick={() => onChange({ ...value, wind_offset_mph: 0, rain_offset_in: 0.4, snow_offset_in: 0 })}>Heavy rain</button>
              <button type="button" onClick={() => onChange({ ...value, wind_offset_mph: 40, rain_offset_in: 0, snow_offset_in: 1.5 })}>Blizzard</button>
            </div>
          </div>
        )}
      </div>
      <button className="primary" type="submit" disabled={loading}>
        {loading ? 'Planning…' : 'Plan routes'}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  )
}
