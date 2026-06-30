// ---------------------------------------------------------------------------
// cron.ts — self-contained deterministic scheduling engine.
//
// Pure functions only. No DB, no external services. Used by routes that need
// to reason about recurring schedules: validate expressions, describe them in
// plain English, project future firings, detect collisions / coverage gaps,
// surface DST traps, and suggest schedule spreads to relieve contention.
//
// Three schedule kinds are supported:
//   - 'cron'   : a standard 5/6-field cron expression (via cron-parser v5)
//   - 'rate'   : "every N minutes" | "every N hours" | "every N days"
//   - 'oneoff' : a single ISO instant (the expression itself)
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ScheduleJob {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  gapStart: string
  gapEnd: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// rate-expression parsing: "every N minutes|hours|days"
// ---------------------------------------------------------------------------
interface RateSpec {
  n: number
  unit: 'minutes' | 'hours' | 'days'
  ms: number
}

function parseRate(expr: string): RateSpec | null {
  const m = expr.trim().toLowerCase().match(/^every\s+(\d+)\s+(minute|hour|day)s?$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unitWord = m[2]
  if (unitWord === 'minute') return { n, unit: 'minutes', ms: n * MINUTE_MS }
  if (unitWord === 'hour') return { n, unit: 'hours', ms: n * HOUR_MS }
  return { n, unit: 'days', ms: n * DAY_MS }
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------
export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  const trimmed = (expr ?? '').trim()
  if (!trimmed) return { valid: false, error: 'Expression is empty' }

  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(trimmed)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  if (kind === 'rate') {
    const r = parseRate(trimmed)
    if (!r) return { valid: false, error: 'Rate must look like "every N minutes|hours|days"' }
    return { valid: true }
  }

  if (kind === 'oneoff') {
    const t = Date.parse(trimmed)
    if (Number.isNaN(t)) return { valid: false, error: 'One-off expression must be a valid ISO instant' }
    return { valid: true }
  }

  return { valid: false, error: `Unknown schedule kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression — human-readable summary
// ---------------------------------------------------------------------------
export function describeExpression(kind: ScheduleKind, expr: string, timezone = 'UTC'): string {
  const trimmed = (expr ?? '').trim()
  const v = validateExpression(kind, trimmed)
  if (!v.valid) return `Invalid schedule: ${v.error}`

  if (kind === 'rate') {
    const r = parseRate(trimmed)!
    return `Every ${r.n} ${r.n === 1 ? r.unit.slice(0, -1) : r.unit}`
  }

  if (kind === 'oneoff') {
    return `Once at ${new Date(trimmed).toISOString()}`
  }

  // cron
  const fields = trimmed.split(/\s+/)
  const [min, hour, dom, month, dow] = fields.length === 6 ? fields.slice(1) : fields
  const parts: string[] = []
  if (min === '*' && hour === '*') {
    parts.push('every minute')
  } else if (hour === '*') {
    parts.push(min === '0' ? 'at the top of every hour' : `at minute ${min} of every hour`)
  } else if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    parts.push(`at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  } else {
    parts.push(`minute ${min}, hour ${hour}`)
  }
  if (dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (month !== '*') parts.push(`in month ${month}`)
  if (dow !== '*') parts.push(`on weekday ${dow}`)
  return `${parts.join(', ')} (${timezone})`
}

// ---------------------------------------------------------------------------
// nextFirings — project the next `count` firing instants as ISO UTC strings
// ---------------------------------------------------------------------------
export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  count = 10,
): string[] {
  const trimmed = (expr ?? '').trim()
  if (!validateExpression(kind, trimmed).valid) return []
  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []
  const n = Math.max(0, Math.min(count, 1000))
  if (n === 0) return []

  if (kind === 'cron') {
    try {
      const interval = CronExpressionParser.parse(trimmed, { tz: timezone, currentDate: from })
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        const next = interval.next()
        out.push(new Date(next.getTime()).toISOString())
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const r = parseRate(trimmed)!
    const out: string[] = []
    let t = from.getTime() + r.ms
    for (let i = 0; i < n; i++) {
      out.push(new Date(t).toISOString())
      t += r.ms
    }
    return out
  }

  // oneoff: emit the instant only if it is in the future relative to `from`
  const t = new Date(trimmed).getTime()
  if (t > from.getTime()) return [new Date(t).toISOString()]
  return []
}

// ---------------------------------------------------------------------------
// computeCollisions — bucket all firings into the horizon by minute and flag
// minutes where concurrency >= threshold, OR where >=2 jobs share a resource.
// ---------------------------------------------------------------------------
export function computeCollisions(
  jobs: ScheduleJob[],
  opts: { horizonDays?: number; threshold?: number } = {},
): CollisionWindow[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = opts.threshold ?? 2
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const horizonMs = fromMs + horizonDays * DAY_MS
  // Cap firings projected per job so a tight "every minute" job can't explode.
  const perJobCap = Math.min(2000, Math.ceil((horizonDays * DAY_MS) / MINUTE_MS))

  // minuteBucket -> { jobIds:Set, resourceCounts:Map }
  const buckets = new Map<number, { jobIds: Set<string>; resourceCounts: Map<string, number> }>()

  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, perJobCap)
    for (const f of firings) {
      const ms = Date.parse(f)
      if (ms > horizonMs) break
      const minuteBucket = Math.floor(ms / MINUTE_MS)
      let entry = buckets.get(minuteBucket)
      if (!entry) {
        entry = { jobIds: new Set(), resourceCounts: new Map() }
        buckets.set(minuteBucket, entry)
      }
      entry.jobIds.add(job.id)
      if (job.resourceId) {
        entry.resourceCounts.set(job.resourceId, (entry.resourceCounts.get(job.resourceId) ?? 0) + 1)
      }
    }
  }

  const windows: CollisionWindow[] = []
  for (const [minuteBucket, entry] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const concurrency = entry.jobIds.size
    let sharedResource: string | undefined
    for (const [rid, cnt] of entry.resourceCounts) {
      if (cnt >= 2) {
        sharedResource = rid
        break
      }
    }
    const flag = concurrency >= threshold || sharedResource !== undefined
    if (!flag) continue
    const start = minuteBucket * MINUTE_MS
    const severity: CollisionWindow['severity'] =
      concurrency >= threshold * 3 ? 'high' : concurrency >= threshold * 2 ? 'medium' : 'low'
    windows.push({
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(start + MINUTE_MS).toISOString(),
      jobIds: [...entry.jobIds],
      severity,
      resourceId: sharedResource,
    })
  }
  return windows
}

// ---------------------------------------------------------------------------
// loadHeatmap — count firings per hourly bucket across the horizon.
// ---------------------------------------------------------------------------
export function loadHeatmap(
  jobs: ScheduleJob[],
  opts: { horizonDays?: number } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const horizonMs = fromMs + horizonDays * DAY_MS
  const perJobCap = Math.min(5000, Math.ceil((horizonDays * DAY_MS) / MINUTE_MS))

  const counts = new Map<number, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, perJobCap)
    for (const f of firings) {
      const ms = Date.parse(f)
      if (ms > horizonMs) break
      const hourBucket = Math.floor(ms / HOUR_MS)
      counts.set(hourBucket, (counts.get(hourBucket) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, count]) => ({ bucket: new Date(h * HOUR_MS).toISOString(), count }))
}

// ---------------------------------------------------------------------------
// dstTraps — detect double-fire / skip / ambiguous windows caused by a UTC
// offset change in the target timezone across the window.
// ---------------------------------------------------------------------------
function tzOffsetMinutes(date: Date, timeZone: string): number {
  // Offset = (wall-clock interpreted as UTC) - (actual UTC instant).
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const map: Record<string, string> = {}
    for (const p of parts) map[p.type] = p.value
    const asUTC = Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      parseInt(map.hour === '24' ? '0' : map.hour, 10),
      parseInt(map.minute, 10),
      parseInt(map.second, 10),
    )
    return Math.round((asUTC - date.getTime()) / MINUTE_MS)
  } catch {
    return 0
  }
}

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  days = 14,
): DstTrap[] {
  if (!validateExpression(kind, expr).valid) return []
  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []
  const traps: DstTrap[] = []
  const endMs = from.getTime() + days * DAY_MS

  // Walk hour by hour looking for offset transitions in this timezone.
  let prevOffset = tzOffsetMinutes(from, timezone)
  for (let t = from.getTime() + HOUR_MS; t <= endMs; t += HOUR_MS) {
    const d = new Date(t)
    const offset = tzOffsetMinutes(d, timezone)
    if (offset === prevOffset) {
      prevOffset = offset
      continue
    }
    const delta = offset - prevOffset // positive: clocks sprang forward
    const localFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    const atLocal = localFmt.format(d)
    const atUtc = d.toISOString()
    if (delta > 0) {
      // Spring-forward: a local-time window is skipped.
      traps.push({ type: 'skip', atLocal, atUtc })
    } else {
      // Fall-back: a local-time window repeats -> double fire / ambiguous.
      traps.push({ type: 'double_fire', atLocal, atUtc })
      traps.push({ type: 'ambiguous', atLocal, atUtc })
    }
    prevOffset = offset
  }
  return traps
}

// ---------------------------------------------------------------------------
// coverageGaps — given desired coverage windows and the actual job firings,
// find spans inside the horizon with no scheduled firing.
// ---------------------------------------------------------------------------
export function coverageGaps(
  windows: Array<{ start: string; end: string }>,
  jobs: ScheduleJob[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const horizonMs = fromMs + horizonDays * DAY_MS
  const perJobCap = Math.min(5000, Math.ceil((horizonDays * DAY_MS) / MINUTE_MS))

  // Collect all firing instants in range, sorted.
  const firings: number[] = []
  for (const job of jobs) {
    for (const f of nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, perJobCap)) {
      const ms = Date.parse(f)
      if (ms > horizonMs) break
      if (ms >= fromMs) firings.push(ms)
    }
  }
  firings.sort((a, b) => a - b)

  // Determine the regions we care about. If explicit windows are given, use
  // them; otherwise treat the whole horizon as one window.
  const regions =
    windows.length > 0
      ? windows
          .map((w) => ({ start: Date.parse(w.start), end: Date.parse(w.end) }))
          .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
      : [{ start: fromMs, end: horizonMs }]

  const gaps: CoverageGap[] = []
  for (const region of regions) {
    const inWindow = firings.filter((f) => f >= region.start && f <= region.end)
    let cursor = region.start
    for (const f of inWindow) {
      if (f > cursor) {
        gaps.push({
          gapStart: new Date(cursor).toISOString(),
          gapEnd: new Date(f).toISOString(),
          durationMinutes: Math.round((f - cursor) / MINUTE_MS),
        })
      }
      cursor = Math.max(cursor, f)
    }
    if (region.end > cursor) {
      gaps.push({
        gapStart: new Date(cursor).toISOString(),
        gapEnd: new Date(region.end).toISOString(),
        durationMinutes: Math.round((region.end - cursor) / MINUTE_MS),
      })
    }
  }
  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread — for jobs piling into colliding minutes, suggest a staggered
// cron expression that shifts each offending job to a distinct minute offset.
// ---------------------------------------------------------------------------
export function autoSpread(
  jobs: ScheduleJob[],
  opts: { threshold?: number } = {},
): SpreadSuggestion[] {
  const threshold = opts.threshold ?? 2
  const collisions = computeCollisions(jobs, { threshold })
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  const suggestions: SpreadSuggestion[] = []
  const seen = new Set<string>()

  for (const win of collisions) {
    // Keep the first job on its slot; spread the rest to new minute offsets.
    win.jobIds.forEach((jobId, idx) => {
      if (idx === 0) return
      if (seen.has(jobId)) return
      const job = jobById.get(jobId)
      if (!job || job.kind !== 'cron') return
      const fields = job.expr.trim().split(/\s+/)
      const offset = (idx * 7) % 60 // deterministic spread
      if (fields.length === 5) {
        fields[0] = String(offset)
      } else if (fields.length === 6) {
        fields[1] = String(offset)
      } else {
        return
      }
      const suggestedExpr = fields.join(' ')
      if (suggestedExpr === job.expr) return
      seen.add(jobId)
      suggestions.push({
        jobId,
        suggestedExpr,
        reason: `Collides with ${win.jobIds.length - 1} other job(s) at ${win.windowStart}; shifting to minute ${offset} relieves contention.`,
      })
    })
  }
  return suggestions
}
