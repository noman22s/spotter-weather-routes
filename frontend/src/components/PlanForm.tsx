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
      <button className="primary" type="submit" disabled={loading}>
        {loading ? 'Planning…' : 'Plan routes'}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  )
}
