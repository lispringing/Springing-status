import { format } from 'date-fns'
import { isMonitorWarning, normalizeStatus, parseTimestamp } from './monitor'

const CFG = {
  styles: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, interaction: { intersect: false, mode: 'nearest' } },
  points: { pointBackgroundColor: '#fff', pointBorderColor: '#10b981', pointBorderWidth: 1.5, pointHoverBorderWidth: 1.5, pointHoverBackgroundColor: '#fff' },
  colors: { success: '#10b981', warning: '#eab308', error: '#ef4444', orange: '#ff7a45', gray: 'rgb(120, 120, 120, 0.3)' }
}

export const getChartColor = (value, isBeforeCreation, status) => {
  if (isBeforeCreation) return CFG.colors.gray
  if (isMonitorWarning(status)) return CFG.colors.warning
  if (value === null || isNaN(value)) return CFG.colors.error
  if (value === 0) return CFG.colors.error
  return [{ min: 99.9, color: CFG.colors.success }, { min: 90, color: CFG.colors.warning }, { min: 0.1, color: CFG.colors.orange }]
    .find((t) => value >= t.min)?.color || CFG.colors.orange
}

export const getStatusChartConfig = (monitor, dateRange, isMobile) => {
  const data = monitor.stats?.dailyUptimes ?? Array(30).fill(null)
  const create = parseTimestamp(monitor.createDateTime) || 0
  const since = Math.max(0, Math.floor((new Date(Math.min(create, Date.now())) - dateRange.startDate) / 86400000))
  const pt = isMobile ? { radius: 4, hoverRadius: 5 } : { radius: 8, hoverRadius: 10 }

  return {
    data: {
      datasets: [{
        data: data.map((value, i) => ({ x: i, y: 50, value: i < since ? null : (value ?? null), date: dateRange.dates[i], status: monitor.status, isBeforeCreation: i < since })),
        backgroundColor: data.map((v, i) => getChartColor(v, i < since, monitor.status)),
        borderColor: 'transparent', ...pt, pointStyle: 'rectRounded'
      }]
    },
    options: {
      ...CFG.styles,
      plugins: {
        ...CFG.styles.plugins,
        tooltip: {
          callbacks: {
            title: (items) => format(items[0].raw.date, 'yyyy-MM-dd'),
            label: (ctx) => {
              if (ctx.raw.isBeforeCreation || ctx.raw.value === null) return '无数据'
              const s = normalizeStatus(ctx.raw.status)
              if (s === 'PAUSED') return '已暂停'
              if (s === 'STARTED') return '准备中'
              return `可用率：${ctx.raw.value.toFixed(2)}%`
            }
          }
        }
      },
      scales: { x: { display: false, min: -0.5, max: 29.5 }, y: { display: false, min: 45, max: 55 } },
      animation: { duration: 200 },
      elements: { point: { ...pt, borderWidth: 0, borderRadius: 4 } }
    }
  }
}

export const getResponseTimeChartData = (monitor) => ({
  labels: Array.from({ length: 24 }, (_, i) => { const d = new Date(); d.setHours(d.getHours() - i); return format(d, 'HH:mm') }).reverse(),
  datasets: [{
    label: '响应时间',
    data: [...(monitor?.stats?.dailyResponseTimes || [])].reverse().slice(-24).map((t) =>
      (typeof t === 'number' && !isNaN(t) && t >= 0 && t <= 60000) ? t : null),
    borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.05)', borderWidth: 1.5,
    fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 4, ...CFG.points
  }]
})

export const responseTimeChartOptions = {
  ...CFG.styles,
  plugins: {
    ...CFG.styles.plugins,
    tooltip: {
      enabled: true, mode: 'index', intersect: false,
      callbacks: {
        title: (items) => items[0]?.label || '',
        label: (ctx) => ctx.raw ? `响应时间：${ctx.raw} ms` : '无数据'
      }
    }
  },
  scales: {
    x: { grid: { display: false, drawBorder: false }, ticks: { maxRotation: 0, color: 'rgb(156, 163, 175)', padding: 8, maxTicksLimit: 12, font: { size: 11 } } },
    y: {
      beginAtZero: true, border: { display: false },
      grid: { color: 'rgba(229, 231, 235, 0.5)', drawBorder: false, lineWidth: 1 },
      ticks: { color: 'rgb(156, 163, 175)', padding: 8, font: { size: 11 }, callback: (v) => `${v} ms`, maxTicksLimit: 8 }
    }
  },
  elements: { line: { tension: 0.4, borderWidth: 1.5, borderCapStyle: 'round', borderJoinStyle: 'round', capBezierPoints: true } },
  animation: { duration: 600, easing: 'easeInOutCubic', delay: (ctx) => ctx.dataIndex * 20 }
}
