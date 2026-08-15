import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 3100,
    open: true,
    middlewareMode: false,
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/status')) return next()

        try {
          const { getCachedMonitorStatus } = await import('./api/status.js')
          const { areMonitorsHealthy } = await import('./src/utils/monitor.js')
          const { buildStatusSvg } = await import('./api/status.js')
          const url = new URL(req.url, 'http://localhost')
          const apiKey = process.env.UPTIMEROBOT_API_KEY || process.env.VITE_UPTIMEROBOT_API_KEY
          const force = ['1', 'true'].includes(url.searchParams.get('refresh'))
          const data = await getCachedMonitorStatus(apiKey, { force }).catch(() => ({ monitors: [] }))
          res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
          res.end(buildStatusSvg({ healthy: areMonitorsHealthy(data?.monitors || []) }))
        } catch {
          const { buildStatusSvg } = await import('./api/status.js')
          res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
          res.end(buildStatusSvg({ healthy: false }))
        }
      })
    }
  }
})