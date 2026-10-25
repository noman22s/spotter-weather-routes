import { useEffect, useRef, useState } from 'react'
import { suggestPlaces } from '../api'
import type { Suggestion } from '../types'

interface Props {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

/** Text input with US place suggestions (debounced, cancellable). */
export default function PlaceInput({ id, label, value, onChange, placeholder }: Props) {
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const abort = useRef<AbortController | null>(null)
  const chosen = useRef(value)

  useEffect(() => {
    if (!open || value.trim().length < 2 || value === chosen.current) {
      setItems([])
      return
    }
    const ctl = new AbortController()
    abort.current?.abort()
    abort.current = ctl
    const t = setTimeout(() => {
      suggestPlaces(value, ctl.signal).then((s) => { if (!ctl.signal.aborted) setItems(s) }).catch(() => {})
    }, 220)
    return () => { clearTimeout(t); ctl.abort() }
  }, [value, open])

  const pick = (s: Suggestion) => {
    chosen.current = s.label
    onChange(s.label)
    setItems([])
    setOpen(false)
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        required
        onChange={(e) => { setOpen(true); setActive(-1); onChange(e.target.value) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!items.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]) }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && items.length > 0 && (
        <div className="suggest" role="listbox">
          {items.map((s, i) => (
            <button type="button" key={s.label + i} className={i === active ? 'active' : ''} onMouseDown={() => pick(s)} role="option" aria-selected={i === active}>
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
