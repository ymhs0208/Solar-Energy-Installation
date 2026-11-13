import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vitest/config'
import type { Connect } from 'vite'

const NLSC = 'https://api.nlsc.gov.tw/idc/TextQueryMap/'
const TARIFF = 'https://service.taipower.com.tw/data/opendata/apply/file/d007008/001.json'
const FIT = 'https://www.moeaea.gov.tw/ECW/populace/news/wHandNews_File.ashx?file_id=28963'
const FEEDERS = {
  taoyuan: 'https://service.taipower.com.tw/data/opendata/apply/file/d077009/TAOYUAN.zip',
  taichung: 'https://service.taipower.com.tw/data/opendata/apply/file/d077009/TAICHUNG.zip',
} as const
const FACTORIES =
  'https://serv.gcis.nat.gov.tw/RDownLoad/Data/statistical/%E7%94%9F%E7%94%A2%E4%B8%AD%E5%B7%A5%E5%BB%A0%E6%B8%85%E5%86%8A.zip'

const OVERPASS = 'https://overpass.openstreetmap.fr/api/interpreter'

async function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function targetFor(url: URL): { href: string; headers: Record<string, string> } | null {
  if (url.pathname === '/live/nlsc') {
    const query = url.searchParams.get('q')?.trim()
    if (!query) return null
    return { href: NLSC + encodeURIComponent(query), headers: { Referer: 'https://maps.nlsc.gov.tw/' } }
  }
  if (url.pathname === '/live/tariff') return { href: TARIFF, headers: {} }
  if (url.pathname === '/live/fit') return { href: FIT, headers: {} }
  if (url.pathname === '/live/factories') return { href: FACTORIES, headers: {} }
  if (url.pathname === '/live/feeder') {
    const city = url.searchParams.get('city')
    if (city !== 'taoyuan' && city !== 'taichung') return null
    return { href: FEEDERS[city], headers: {} }
  }
  return null
}

function liveProxy(): Plugin {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const raw = req.url ?? ''
    if (!raw.startsWith('/live/')) return next()
    try {
      const url = new URL(raw, 'http://localhost')
      if (url.pathname === '/live/overpass') {
        const body = await readBody(req)
        const upstream = await fetch(OVERPASS, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': 'SolarX/1.0 (educational)',
          },
          body,
        })
        const bytes = Buffer.from(await upstream.arrayBuffer())
        res.statusCode = upstream.status
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
        res.setHeader('X-Upstream-Url', OVERPASS)
        res.end(bytes)
        return
      }
      const target = targetFor(url)
      if (!target) {
        res.statusCode = 400
        res.end('不支援的即時路徑')
        return
      }
      const upstream = await fetch(target.href, {
        headers: { 'User-Agent': 'SolarX/1.0', ...target.headers },
      })
      const bytes = Buffer.from(await upstream.arrayBuffer())
      res.statusCode = upstream.status
      const type = upstream.headers.get('content-type')
      if (type) res.setHeader('Content-Type', type)
      const modified = upstream.headers.get('last-modified')
      if (modified) res.setHeader('X-Upstream-Modified', modified)
      res.setHeader('X-Upstream-Url', target.href)
      res.end(bytes)
    } catch (error) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(error instanceof Error ? error.message : '代理失敗')
    }
  }
  return {
    name: 'live-proxy',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), liveProxy()],
  server: { host: '0.0.0.0', port: 4317, strictPort: true },
  preview: { host: '0.0.0.0', port: 4317, strictPort: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
