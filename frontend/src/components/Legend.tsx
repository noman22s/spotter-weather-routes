import { LEVEL_COLORS, LEVEL_NAMES } from '../risk'
import type { Level } from '../types'

export default function Legend() {
  return (
    <div className="overlay legend" aria-label="Risk levels">
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', fontWeight: 600 }}>Risk level</div>
      {([0, 1, 2, 3, 4] as Level[]).map((l) => (
        <div key={l}><i style={{ background: LEVEL_COLORS[l] }} />{LEVEL_NAMES[l]}</div>
      ))}
    </div>
  )
}
