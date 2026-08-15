import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { getCachedMonitorStatus } from '../api/status.js'
import { buildStatusSvg } from '../api/status.js'
import { areMonitorsHealthy } from '../src/utils/monitor.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const port = Number(process.env.PORT || 3000)

app.get('/status', async (req, res) => {
  try {
    const apiKey = process.env.UPTIMEROBOT_API_KEY || process.env.VITE_UPTIMEROBOT_API_KEY
    const force = ['1', 'true'].includes(String(req.query.refresh))
    const data = await getCachedMonitorStatus(apiKey, { force }).catch(() => ({ monitors: [] }))
    const healthy = areMonitorsHealthy(data?.monitors || [])
    res.set('Content-Type', 'image/svg+xml; charset=utf-8')
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.send(buildStatusSvg({ healthy }))
  } catch {
    res.set('Content-Type', 'image/svg+xml; charset=utf-8')
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.send(buildStatusSvg({ healthy: false }))
  }
})

const distDir = path.resolve(__dirname, '../dist')
const indexPath = path.resolve(__dirname, '../dist/index.html')

app.use(express.static(distDir))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/status')) return next()
  if (req.path.startsWith('/api/')) return next()
  if (req.path.startsWith('/@') || req.path.startsWith('/src/')) return next()
  res.sendFile(indexPath, (err) => {
    if (err) next(err)
  })
})

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})
