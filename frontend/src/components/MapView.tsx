import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { Checkpoint, PlanResult, RouteResult } from '../types'
import { ROUTE_COLORS, levelColor } from '../risk'
import HeatCorridor from './HeatCorridor'

export interface Layers {
  heatmap: boolean
  checkpoints: boolean
  allRoutes: boolean
}

interface Props {
  result: PlanResult | null
  selected: number
  hovered: number | null
  onSelect: (id: number) => void
  layers: Layers
  hour: number
  focus: Checkpoint | null
  onFocus: (c: Checkpoint | null) => void
}

const US_CENTER: [number, number] = [39.5, -98.35]

function FitBounds({ result }: { result: PlanResult | null }) {
  const map = useMap()
  useEffect(() => {
    if (!result) return
    const all = result.routes.flatMap((r) => r.geometry)
    map.fitBounds(L.latLngBounds(all), { padding: [60, 60], animate: true })
  }, [map, result])
  return null
}

function FlyTo({ focus }: { focus: Checkpoint | null }) {
  const map = useMap()
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lon], Math.max(map.getZoom(), 8), { duration: 0.6 })
  }, [map, focus])
  return null
}

function CheckpointPopup({ c, routeName }: { c: Checkpoint; routeName: string }) {
  return (
    <div className="cp-popup">
      <b style={{ color: levelColor(c.level) }}>{c.level_name}</b> · {routeName}, mile {Math.round(c.mile)}
      <table>
        <tbody>
          <tr><td>Arrives</td><td>{c.eta_local} (+{c.hours_from_departure} h)</td></tr>
          <tr><td>Conditions</td><td>{c.condition || 'n/a'}, {c.temp_f}°F</td></tr>
          <tr><td>Wind</td><td>{c.wind_mph} mph, gusts {c.gust_mph}</td></tr>
          <tr><td>Rain</td><td>{c.rain_in} in/h</td></tr>
          <tr><td>Snow</td><td>{c.snow_in} in/h</td></tr>
          <tr><td>Rule</td><td>{c.driver}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

/** Split a route's geometry into stretches owned by each checkpoint (halfway to the
 *  neighbours), so the selected route can be drawn in its risk colours. */
function riskSegments(route: RouteResult): { positions: [number, number][]; level: number }[] {
  const geo = route.geometry
  if (geo.length < 2 || route.checkpoints.length === 0) return [{ positions: geo, level: 0 }]
  // cumulative distance along the simplified geometry, scaled to the route's miles
  const cum: number[] = [0]
  for (let i = 1; i < geo.length; i++) {
    const [a, b] = [geo[i - 1], geo[i]]
    const dx = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
    const dy = b[0] - a[0]
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy))
  }
  const scale = route.summary.distance_miles / (cum[cum.length - 1] || 1)
  const cps = route.checkpoints
  const bounds = cps.map((c, i) => (i === cps.length - 1 ? Infinity : (c.mile + cps[i + 1].mile) / 2))
  const out: { positions: [number, number][]; level: number }[] = []
  let k = 0
  let current: [number, number][] = [geo[0]]
  for (let i = 1; i < geo.length; i++) {
    const mile = cum[i] * scale
    while (k < bounds.length - 1 && mile > bounds[k]) {
      current.push(geo[i])
      out.push({ positions: current, level: cps[k].level })
      current = [geo[i]]
      k++
    }
    current.push(geo[i])
  }
  out.push({ positions: current, level: cps[Math.min(k, cps.length - 1)].level })
  return out
}

function RouteLayer({ route, isSelected, isHovered, dim, showCheckpoints, onSelect, focus, onFocus }: {
  route: RouteResult; isSelected: boolean; isHovered: boolean; dim: boolean; showCheckpoints: boolean
  onSelect: () => void; focus: Checkpoint | null; onFocus: (c: Checkpoint | null) => void
}) {
  const color = ROUTE_COLORS[route.id % ROUTE_COLORS.length]
  const segments = useMemo(() => (isSelected ? riskSegments(route) : []), [route, isSelected])
  const cps = useMemo(() => (isSelected ? route.checkpoints : route.checkpoints.filter((c) => c.level >= 3)), [route, isSelected])
  const tip = `${route.name} · ${Math.round(route.summary.distance_miles)} mi · worst ${route.summary.max_level_name}`
  return (
    <>
      {/* white casing */}
      <Polyline positions={route.geometry} pathOptions={{ color: '#fff', weight: isSelected ? 11 : 7, opacity: dim ? 0 : 0.95 }} interactive={false} />
      {isSelected ? (
        <>
          <Polyline positions={route.geometry} pathOptions={{ color, weight: 7, opacity: 1 }} eventHandlers={{ click: onSelect }}>
            <Tooltip sticky>{tip}</Tooltip>
          </Polyline>
          {segments.map((s, i) => (
            <Polyline key={i} positions={s.positions} pathOptions={{ color: levelColor(s.level as 0), weight: 4, opacity: 1, lineCap: 'butt' }} interactive={false} />
          ))}
        </>
      ) : (
        <Polyline
          positions={route.geometry}
          pathOptions={{ color, weight: isHovered ? 6 : 4, opacity: dim ? 0 : isHovered ? 1 : 0.55 }}
          eventHandlers={{ click: onSelect }}
        >
          <Tooltip sticky>{tip}</Tooltip>
        </Polyline>
      )}
      {showCheckpoints && !dim && cps.map((c) => (
        <CircleMarker
          key={c.mile}
          center={[c.lat, c.lon]}
          radius={isSelected ? (c.level >= 2 ? 7 : 4.5) : 6}
          pathOptions={{ color: '#fff', weight: 1.5, fillColor: levelColor(c.level), fillOpacity: 1 }}
          eventHandlers={{ click: () => { onSelect(); onFocus(c) } }}
        >
          {focus && focus.mile === c.mile && isSelected ? (
            <Popup eventHandlers={{ remove: () => onFocus(null) }}><CheckpointPopup c={c} routeName={route.name} /></Popup>
          ) : (
            <Tooltip direction="top" offset={[0, -6]}>{c.level_name} · mile {Math.round(c.mile)} · {c.eta_local} · wind {c.wind_mph} mph</Tooltip>
          )}
        </CircleMarker>
      ))}
    </>
  )
}

function OpenFocusPopup({ focus }: { focus: Checkpoint | null }) {
  const map = useMap()
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => {
      map.eachLayer((l) => {
        if (l instanceof L.CircleMarker && l.getPopup() && l.getLatLng().equals([focus.lat, focus.lon])) l.openPopup()
      })
    }, 650)
    return () => clearTimeout(t)
  }, [map, focus])
  return null
}

export default function MapView({ result, selected, hovered, onSelect, layers, hour, focus, onFocus }: Props) {
  const ordered = useMemo(() => {
    if (!result) return []
    return [...result.routes].sort((a, b) => (a.id === selected ? 1 : b.id === selected ? -1 : 0)) // selected drawn last (on top)
  }, [result, selected])
  return (
    <MapContainer center={US_CENTER} zoom={4} preferCanvas scrollWheelZoom zoomControl={false} style={{ height: '100%' }}>
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors · Weather by Open-Meteo · Routing by OSRM"
        maxZoom={16}
      />
      <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}" maxZoom={16} pane="shadowPane" />
      <FitBounds result={result} />
      <FlyTo focus={focus} />
      <OpenFocusPopup focus={focus} />
      {result?.heatmap && <HeatCorridor heatmap={result.heatmap} hour={hour} visible={layers.heatmap} />}
      {ordered.map((r) => (
        <RouteLayer
          key={r.id}
          route={r}
          isSelected={r.id === selected}
          isHovered={r.id === hovered}
          dim={!layers.allRoutes && r.id !== selected}
          showCheckpoints={layers.checkpoints}
          onSelect={() => onSelect(r.id)}
          focus={focus}
          onFocus={onFocus}
        />
      ))}
      {result && (
        <>
          <CircleMarker center={[result.origin.lat, result.origin.lon]} radius={7} pathOptions={{ color: '#0f172a', weight: 2.5, fillColor: '#fff', fillOpacity: 1 }}>
            <Tooltip permanent direction="auto" offset={[8, 0]}>Origin · {result.origin.label}</Tooltip>
          </CircleMarker>
          <CircleMarker center={[result.destination.lat, result.destination.lon]} radius={7} pathOptions={{ color: '#0f172a', weight: 2.5, fillColor: '#0f172a', fillOpacity: 1 }}>
            <Tooltip permanent direction="auto" offset={[8, 0]}>Destination · {result.destination.label}</Tooltip>
          </CircleMarker>
        </>
      )}
    </MapContainer>
  )
}
