import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDailyUptimes, areMonitorsHealthy, countAbnormalMonitors } from '../src/utils/monitor.js'

const localTime = (base, daysAgo, hour = 0) => {
  const date = new Date(base)
  date.setHours(hour, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date.getTime()
}

test('buildDailyUptimes leaves days before monitor creation empty', () => {
  const now = new Date(2026, 7, 14, 12).getTime()
  const result = buildDailyUptimes({
    status: 'UP',
    createDateTime: new Date(localTime(now, 2)).toISOString(),
    incidents: []
  }, now)

  assert.equal(result.dailyUptimes.filter((value) => value === null).length, 27)
  assert.deepEqual(result.dailyUptimes.slice(-3), [100, 100, 100])
  assert.equal(result.uptime, 100)
})

test('buildDailyUptimes calculates a daily percentage from API incidents', () => {
  const now = new Date(2026, 7, 14, 12).getTime()
  const incidentStart = localTime(now, 1, 12)
  const result = buildDailyUptimes({
    status: 'UP',
    createDateTime: new Date(localTime(now, 40)).toISOString(),
    incidents: [{ startedAt: new Date(incidentStart).toISOString(), duration: 3600 }]
  }, now)

  assert.ok(Math.abs(result.dailyUptimes[28] - 95.8333333333) < 0.0001)
  assert.equal(result.dailyUptimes[29], 100)
})

test('buildDailyUptimes merges overlapping incidents before summing downtime', () => {
  const now = new Date(2026, 7, 14, 12).getTime()
  const firstStart = localTime(now, 1, 10)
  const secondStart = localTime(now, 1, 11)
  const result = buildDailyUptimes({
    status: 'UP',
    createDateTime: new Date(localTime(now, 40)).toISOString(),
    incidents: [
      { startedAt: new Date(firstStart).toISOString(), duration: 7200 },
      { startedAt: new Date(secondStart).toISOString(), duration: 7200 }
    ]
  }, now)

  assert.equal(result.dailyUptimes[28], 87.5)
})

test('buildDailyUptimes treats an unresolved incident as active until now', () => {
  const now = new Date(2026, 7, 14, 12).getTime()
  const result = buildDailyUptimes({
    status: 'DOWN',
    createDateTime: new Date(localTime(now, 40)).toISOString(),
    incidents: [{ startedAt: new Date(localTime(now, 0, 11)).toISOString(), duration: 0 }]
  }, now)

  assert.ok(Math.abs(result.dailyUptimes[29] - 91.6666666667) < 0.0001)
})

test('buildDailyUptimes ignores incidents excluded from API reports', () => {
  const now = new Date(2026, 7, 14, 12).getTime()
  const result = buildDailyUptimes({
    status: 'UP',
    createDateTime: new Date(localTime(now, 40)).toISOString(),
    incidents: [{
      startedAt: new Date(localTime(now, 1, 12)).toISOString(),
      duration: 3600,
      includeInReports: false
    }]
  }, now)

  assert.equal(result.dailyUptimes[28], 100)
})

test('status health uses the same abnormal count as the homepage', () => {
  assert.equal(countAbnormalMonitors([{ status: 'UP' }, { status: 'STARTED' }]), 0)
  assert.equal(countAbnormalMonitors([{ status: 'UP' }, { status: 'DOWN' }]), 1)
  assert.equal(countAbnormalMonitors([{ status: 'PAUSED' }, { status: 'LOOKS_DOWN' }]), 2)

  assert.equal(areMonitorsHealthy([{ status: 'UP' }, { status: 'up' }]), true)
  assert.equal(areMonitorsHealthy([{ status: 'UP' }, { status: 'STARTED' }]), true)
  assert.equal(areMonitorsHealthy([{ status: 'UP' }, { status: 'PAUSED' }]), false)
  assert.equal(areMonitorsHealthy([{ status: 'UP' }, { status: 'DOWN' }]), false)
  assert.equal(areMonitorsHealthy([{ status: 'LOOKS_DOWN' }]), false)
  assert.equal(areMonitorsHealthy([{ status: 'UP' }, { status: 'UNKNOWN' }]), true)
  assert.equal(areMonitorsHealthy([]), false)
  assert.equal(areMonitorsHealthy(null), false)
})
