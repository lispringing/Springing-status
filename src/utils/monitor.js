const DAYS = 30, MS_DAY = 86400000, HOURS = 24
const positiveNumber = (v) => Number.isFinite(Number(v)) && Number(v) > 0
const finiteNumber = (v) => v != null && Number.isFinite(Number(v))

export const normalizeStatus = (s) => String(s || '').toUpperCase()
export const isMonitorOnline = (s) => ['UP', 'STARTED'].includes(normalizeStatus(s))
export const isMonitorOffline = (s) => ['DOWN', 'LOOKS_DOWN'].includes(normalizeStatus(s))
export const isMonitorPaused = (s) => normalizeStatus(s) === 'PAUSED'
export const isMonitorWarning = (s) => ['PAUSED', 'STARTED'].includes(normalizeStatus(s))
export const isMonitorAbnormal = (s) => isMonitorOffline(s) || isMonitorPaused(s)
export const countAbnormalMonitors = (list = []) => Array.isArray(list)
  ? list.filter((m) => isMonitorAbnormal(m?.status)).length
  : 0

export const areMonitorsHealthy = (list = []) => {
  if (!Array.isArray(list) || list.length === 0) return false
  return countAbnormalMonitors(list) === 0
}

const rank = (s) => ({ UP: 0, STARTED: 1, PAUSED: 2, LOOKS_DOWN: 3, DOWN: 4 }[normalizeStatus(s)] ?? 5)

const cmp = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })

export const sortMonitors = (list, { key = 'friendlyName', order = 'asc' } = {}) => {
  const dir = order === 'desc' ? -1 : 1
  const get = {
    friendlyName: (m) => m.friendlyName || '',
    createDateTime: (m) => parseTimestamp(m.createDateTime) || 0,
    status: (m) => rank(m.status)
  }[key] || ((m) => m.friendlyName || '')

  return [...list].sort((a, b) => {
    const va = get(a), vb = get(b)
    const d = typeof va === 'string'
      ? va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' })
      : va - vb
    return d * dir || cmp(a, b) * dir
  })
}

export const parseTimestamp = (v) => {
  if (v == null) return null
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  const p = Date.parse(v)
  return Number.isNaN(p) ? null : p
}

function avgResponse(m) {
  const avg = m.responseTimeStats?.summary?.avg
  if (positiveNumber(avg)) return Math.round(avg)
  const vals = (m.responseTimeStats?.time_series || []).map((p) => p.value).filter(positiveNumber)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
}

function hourlyResponse(m) {
  const out = Array(HOURS).fill(null), groups = {}
  for (const p of m.responseTimeStats?.time_series || []) {
    if (!positiveNumber(p.value)) continue
    const ts = parseTimestamp(p.timestamp)
    if (!ts) continue
    const h = Math.floor((Date.now() - ts) / 3600000)
    if (h >= 0 && h < HOURS) (groups[h] ||= []).push(p.value)
  }
  for (const [h, vals] of Object.entries(groups)) {
    out[h] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
  }
  return out
}

function incidents30d(list = []) {
  const since = Math.floor((Date.now() - DAYS * MS_DAY) / 1000)
  const items = list.filter((i) => {
    const ts = parseTimestamp(i.startedAt)
    return ts && Math.floor(ts / 1000) >= since
  }).sort((a, b) => (parseTimestamp(b.startedAt) || 0) - (parseTimestamp(a.startedAt) || 0))
  return { incidents: items, totalDowntime: items.reduce((n, i) => n + (i.duration || 0), 0) }
}

const startOfDay = (value) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const incidentInterval = (incident, now) => {
  const start = parseTimestamp(incident.startedAt ?? incident.startDateTime ?? incident.started_at)
  if (!start || start >= now) return null

  const resolved = parseTimestamp(
    incident.resolvedAt ?? incident.endedAt ?? incident.endDateTime ?? incident.resolved_at
  )
  const duration = Number(incident.duration)
  const end = resolved || (Number.isFinite(duration) && duration > 0 ? start + duration * 1000 : now)
  return end > start ? [start, Math.min(end, now)] : null
}

const overlapDuration = (intervals, rangeStart, rangeEnd) => {
  const overlaps = intervals
    .map(([start, end]) => [Math.max(start, rangeStart), Math.min(end, rangeEnd)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])

  let total = 0
  let current = null
  for (const interval of overlaps) {
    if (!current || interval[0] > current[1]) {
      if (current) total += current[1] - current[0]
      current = [...interval]
    } else {
      current[1] = Math.max(current[1], interval[1])
    }
  }
  if (current) total += current[1] - current[0]
  return total
}

export function buildDailyUptimes(m, now = Date.now()) {
  const nowMs = parseTimestamp(now) || Date.now()
  const days = Array(DAYS).fill(null)
  const todayStart = startOfDay(nowMs)
  const creation = parseTimestamp(m.createDateTime ?? m.createdAt ?? m.created_at)
  const intervals = (m.incidents || [])
    .filter((incident) => incident.includeInReports !== false)
    .map((incident) => incidentInterval(incident, nowMs))
    .filter(Boolean)

  for (let index = 0; index < DAYS; index += 1) {
    const dayStart = new Date(todayStart)
    dayStart.setDate(dayStart.getDate() - (DAYS - 1 - index))
    const rangeStart = Math.max(dayStart.getTime(), creation || dayStart.getTime())
    const nextDay = new Date(dayStart)
    nextDay.setDate(nextDay.getDate() + 1)
    const rangeEnd = Math.min(nextDay.getTime(), nowMs)
    if (rangeEnd <= rangeStart) continue

    const monitoredDuration = rangeEnd - rangeStart
    const downtime = overlapDuration(intervals, rangeStart, rangeEnd)
    days[index] = Math.max(0, Math.min(100, (1 - downtime / monitoredDuration) * 100))
  }

  const valid = days.filter(finiteNumber)
  const uptime = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length
    : (isMonitorOnline(m.status) ? 100 : 0)
  return { dailyUptimes: days, uptime }
}

export const processMonitorData = (m) => {
  const { incidents, totalDowntime } = incidents30d(m.incidents)
  const { dailyUptimes, uptime } = buildDailyUptimes(m)
  return {
    ...m,
    stats: { avgResponseTime: avgResponse(m), dailyResponseTimes: hourlyResponse(m), uptime, dailyUptimes, incidents, totalDowntime }
  }
}

export const patchResponseTimeStats = (m, stats) => {
  const { stats: _, ...rest } = m
  return processMonitorData({ ...rest, responseTimeStats: stats })
}
