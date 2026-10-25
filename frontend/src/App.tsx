import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, planRoutes } from './api'
import type { Checkpoint, PlanRequest, PlanResult } from './types'
import PlanForm from './components/PlanForm'
import RouteCard from './components/RouteCard'
import CheckpointList from './components/CheckpointList'
import MapView, { type Layers } from './components/MapView'
import ForecastSlider from './components/ForecastSlider'
import Legend from './components/Legend'

function tomorrowAt8() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STAGES = ['Finding three routes…', 'Sampling the forecast at every checkpoint…', 'Scoring weather risk…']

export default function App() {
  const [form, setForm] = useState<PlanRequest>({
    origin: 'Denver, CO',
    destination: 'Seattle, WA',
    departure: tomorrowAt8(),
    load_lbs: 35000,
    interval_miles: 25,
    wind_offset_mph: 0,
    rain_offset_in: 0,
    snow_offset_in: 0,
  })
  const [result, setResult] = useState<PlanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState(STAGES[0])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [hour, setHour] = useState(0)
  const [focus, setFocus] = useState<Checkpoint | null>(null)
  const [layers, setLayers] = useState<Layers>({ heatmap: true, checkpoints: true, allRoutes: true })
  const abort = useRef<AbortController | null>(null)

  const submit = useCallback(async () => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setLoading(true)
    setError(null)
    setFocus(null)
    setStage(STAGES[0])
    const timers = [setTimeout(() => setStage(STAGES[1]), 2200), setTimeout(() => setStage(STAGES[2]), 5000)]
    try {
      const res = await planRoutes(form, ctl.signal)
      setResult(res)
      setSelected(res.routes.find((r) => r.recommended)?.id ?? 0)
      setHour(0)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError(e instanceof ApiError ? e.message : 'Could not reach the server. Is the API running?')
    } finally {
      timers.forEach(clearTimeout)
      if (abort.current === ctl) setLoading(false)
    }
  }, [form])

  // plan the default trip on first load so the page is never empty (once, even under StrictMode)
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void submit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedRoute = result?.routes.find((r) => r.id === selected) ?? null
  const best = result?.routes.find((r) => r.recommended)
  const tone = !best ? 'ok' : !best.summary.drivable ? 'bad' : best.summary.max_level >= 2 ? 'warn' : 'ok'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 17h2a2 2 0 0 0 4 0h6a2 2 0 0 0 4 0h2v-4l-3-5h-5V6H3z" />
            <circle cx="7" cy="17" r="1.5" fill="#2563eb" />
            <circle cx="17" cy="17" r="1.5" fill="#2563eb" />
          </svg>
          <div>
            <h1>Weather-Aware Truck Routing</h1>
            <p>Three routes, forecast risk at every checkpoint, the safest pick.</p>
          </div>
        </div>
        <div className="sidebar-scroll">
          <PlanForm value={form} onChange={setForm} onSubmit={submit} loading={loading} error={error} />
          {result && (
            <div className="results">
              <div className={`banner ${tone}`}>
                <b>Recommended: {best?.name}</b>
                {result.recommendation}
                {result.scenario.active && (
                  <div className="scenario-note">
                    Scenario applied on top of the forecast:
                    {result.scenario.wind_mph > 0 && ` +${result.scenario.wind_mph} mph wind`}
                    {result.scenario.rain_in > 0 && ` +${result.scenario.rain_in} in/h rain`}
                    {result.scenario.snow_in > 0 && ` +${result.scenario.snow_in} in/h snow`}
                  </div>
                )}
              </div>
              <div className="cards">
                {result.routes.map((r) => (
                  <RouteCard key={r.id} route={r} selected={r.id === selected} onSelect={() => { setSelected(r.id); setFocus(null) }} />
                ))}
              </div>
              {selectedRoute && (
                <CheckpointList route={selectedRoute} interval={result.interval_miles} focus={focus} onFocus={setFocus} />
              )}
              <p className="hint">
                Departure {result.departure_local.replace('T', ' ')} ({result.timezone}), load {result.load_lbs.toLocaleString()} lb.
                Forecast sampled at {result.weather_points} points in {Object.values(result.timing_ms).reduce((a, b) => a + b, 0) / 1000 | 0} s.
              </p>
            </div>
          )}
        </div>
      </aside>

      <main className="map-wrap">
        <MapView result={result} selected={selected} onSelect={setSelected} layers={layers} hour={hour} focus={focus} onFocus={setFocus} />
        <div className="overlay layers">
          {(['heatmap', 'checkpoints', 'allRoutes'] as const).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
              {k === 'heatmap' ? 'Weather heatmap' : k === 'checkpoints' ? 'Checkpoints' : 'All routes'}
            </label>
          ))}
        </div>
        <Legend />
        {result?.heatmap && layers.heatmap && (
          <ForecastSlider hour={hour} max={result.heatmap.hours} onChange={setHour} departureUtc={result.departure_utc} timeZone={result.timezone} />
        )}
        {loading && (
          <div className="overlay loading">
            <div><span className="spin" /> {stage}</div>
          </div>
        )}
        {!result && !loading && <div className="empty">Enter a trip and press Plan routes</div>}
      </main>
    </div>
  )
}
