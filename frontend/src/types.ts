export type Level = 0 | 1 | 2 | 3 | 4

export interface Checkpoint {
  mile: number
  lat: number
  lon: number
  eta_utc: string
  eta_local: string
  hours_from_departure: number
  wind_mph: number
  gust_mph: number
  rain_in: number
  snow_in: number
  temp_f: number
  condition: string
  level: Level
  level_name: string
  driver: string
}

export interface RouteSummary {
  distance_miles: number
  duration_hours: number
  no_travel_miles: number
  severe_miles: number
  high_miles: number
  moderate_miles: number
  low_miles: number
  average_risk: number
  max_level: Level
  max_level_name: string
  drivable: boolean
  worst_checkpoint_mile: number | null
}

export interface RouteResult {
  id: number
  name: string
  geometry: [number, number][]
  summary: RouteSummary
  checkpoints: Checkpoint[]
  rank: number
  recommended: boolean
}

export interface Heatmap {
  points: [number, number][]
  hours: number
  levels: Level[][]
}

export interface Place {
  query: string
  label: string
  lat: number
  lon: number
}

export interface PlanResult {
  origin: Place
  destination: Place
  departure_local: string
  departure_utc: string
  timezone: string
  load_lbs: number
  interval_miles: number
  routes: RouteResult[]
  heatmap: Heatmap | null
  recommendation: string
  weather_points: number
  timing_ms: Record<string, number>
}

export interface PlanRequest {
  origin: string
  destination: string
  departure: string
  load_lbs: number
  interval_miles: 10 | 25 | 50
}

export interface Suggestion {
  label: string
  lat: number
  lon: number
}
