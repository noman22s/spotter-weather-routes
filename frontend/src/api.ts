import type { PlanRequest, PlanResult, Suggestion } from './types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function planRoutes(req: PlanRequest, signal?: AbortSignal): Promise<PlanResult> {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      body.error ??
      (body.errors ? Object.entries(body.errors).map(([k, v]) => `${k}: ${(v as string[]).join(' ')}`).join('; ') : `Request failed (${res.status})`)
    throw new ApiError(msg, res.status)
  }
  return body as PlanResult
}

export async function suggestPlaces(q: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal })
  if (!res.ok) return []
  return (await res.json()) as Suggestion[]
}
