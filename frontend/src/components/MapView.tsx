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
    map.fitBounds(L.latLngBounds(all), { padding: [40, 40], animate: true })
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
          <tr><td>Driver</td><td>{c.driver}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

function RouteLayer({ route, isSelected, dim, showCheckpoints, onSelect, focus, onFocus }: {
  route: RouteResult; isSelected: boolean; dim: boolean; showCheckpoints: boolean
  onSelect: () => void; focus: Checkpoint | null; onFocus: (c: Checkpoint | null) => void
}) {
  const color = ROUTE_COLORS[route.id % ROUTE_COLORS.length]
  // on unselected routes only the dangerous checkpoints are drawn, to keep the map readable
  const cps = useMemo(() => (isSelected ? route.checkpoints : route.checkpoints.filter((c) => c.level >= 3)), [route, isSelected])
  return (
    <>
      <Polyline
        positions={route.geometry}
        pathOptions={{ color: '#fff', weight: isSelected ? 9 : 6, opacity: dim ? 0 : 0.9 }}
        interactive={false}
      />
      <Polyline
        positions={route.geometry}
        pathOptions={{ color, weight: isSelected ? 5 : 3.5, opacity: dim ? 0 : isSelected ? 1 : 0.6, dashArray: isSelected ? undefined : '1 0' }}
        eventHandlers={{ click: onSelect }}
      >
        <Tooltip sticky>{route.name} · {Math.round(route.summary.distance_miles)} mi · worst {route.summary.max_level_name}</Tooltip>
      </Polyline>
      {showCheckpoints && !dim && cps.map((c) => (
        <CircleMarker
          key={c.mile}
          center={[c.lat, c.lon]}
          radius={isSelected ? (c.level >= 2 ? 7 : 5) : 6}
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
  // Popups open on mount; make sure the focused marker's popup is shown after a list click
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

export default function MapView({ result, selected, onSelect, layers, hour, focus, onFocus }: Props) {
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
          dim={!layers.allRoutes && r.id !== selected}
          showCheckpoints={layers.checkpoints}
          onSelect={() => onSelect(r.id)}
          focus={focus}
          onFocus={onFocus}
        />
      ))}
      {result && (
        <>
          <CircleMarker center={[result.origin.lat, result.origin.lon]} radius={7} pathOptions={{ color: '#0f172a', weight: 2, fillColor: '#fff', fillOpacity: 1 }}>
            <Tooltip permanent direction="auto" offset={[8, 0]}>Origin · {result.origin.label}</Tooltip>
          </CircleMarker>
          <CircleMarker center={[result.destination.lat, result.destination.lon]} radius={7} pathOptions={{ color: '#0f172a', weight: 2, fillColor: '#0f172a', fillOpacity: 1 }}>
            <Tooltip permanent direction="auto" offset={[8, 0]}>Destination · {result.destination.label}</Tooltip>
          </CircleMarker>
        </>
      )}
    </MapContainer>
  )
}
