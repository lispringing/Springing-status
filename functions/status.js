import {
  getCachedMonitorStatus,
  fetchMonitorResponseTime,
  parseRequestApiKey,
  corsHeaders,
  CACHE_TTL_MS,
  buildStatusSvg
} from '../api/status.js'
import { areMonitorsHealthy } from '../src/utils/monitor.js'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_MS / 1000 | 0}` }
})

export async function onRequest(context) {
  const request = context?.request ?? context
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: '只支持 GET / POST' }, 405)

  try {
    const url = new URL(request.url)
    const apiKey = await parseRequestApiKey(context)
    const monitorId = url.searchParams.get('monitorId')
    const badge = ['1', 'true'].includes(url.searchParams.get('badge'))

    if (monitorId) {
      return json({ responseTimeStats: await fetchMonitorResponseTime({ apiKey, monitorId }) })
    }

    if (badge || url.pathname === '/status' || url.pathname.startsWith('/status?')) {
      const force = ['1', 'true'].includes(url.searchParams.get('refresh'))
      const data = await getCachedMonitorStatus(apiKey, { force }).catch(() => ({ monitors: [] }))
      const svg = buildStatusSvg({ healthy: areMonitorsHealthy(data?.monitors || []) })
      return new Response(svg, {
        headers: { ...corsHeaders, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      })
    }

    const force = ['1', 'true'].includes(url.searchParams.get('refresh'))
    return json(await getCachedMonitorStatus(apiKey, { force }))
  } catch (e) {
    if (e.name === 'RateLimitError') {
      return json({ error: e.message, retryAfter: e.retryAfter }, 429)
    }
    return json({ error: e.message || '请求失败' }, 500)
  }
}
