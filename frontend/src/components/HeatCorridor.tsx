import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import type { Heatmap } from '../types'
import { LEVEL_COLORS } from '../risk'

interface Props {
  heatmap: Heatmap
  hour: number
  visible: boolean
}

/**
 * Corridor heatmap: one soft disc per forecast point, coloured by the risk level at the
 * selected hour, drawn on a blurred canvas pane so they blend into a continuous strip.
 * Changing the hour only recolours the discs (no re-creation), so the slider stays smooth.
 */
export default function HeatCorridor({ heatmap, hour, visible }: Props) {
  const map = useMap()
  const group = useRef<L.LayerGroup | null>(null)
  const discs = useRef<L.Circle[]>([])

  useEffect(() => {
    if (!map.getPane('heat')) {
      const pane = map.createPane('heat')
      pane.classList.add('heat-pane')
      pane.style.zIndex = '350'          // under the route lines (overlay pane is 400)
    }
    const renderer = L.canvas({ pane: 'heat', padding: 0.5 })
    const g = L.layerGroup()
    discs.current = heatmap.points.map(([lat, lon], i) =>
      L.circle([lat, lon], {
        radius: 22000,
        stroke: false,
        fillOpacity: 0.85,
        fillColor: LEVEL_COLORS[heatmap.levels[0][i]],
        renderer,
        interactive: false,
      }).addTo(g),
    )
    group.current = g
    if (visible) g.addTo(map)
    return () => {
      g.remove()
      discs.current = []
      group.current = null
    }
  }, [map, heatmap]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const row = heatmap.levels[Math.min(hour, heatmap.levels.length - 1)]
    discs.current.forEach((d, i) => d.setStyle({ fillColor: LEVEL_COLORS[row[i]] }))
  }, [hour, heatmap])

  useEffect(() => {
    const g = group.current
    if (!g) return
    if (visible) g.addTo(map)
    else g.remove()
  }, [visible, map])

  return null
}
