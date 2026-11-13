const NLSC = 'https://api.nlsc.gov.tw/idc/TextQueryMap/'
const TARIFF = 'https://service.taipower.com.tw/data/opendata/apply/file/d007008/001.json'
const FIT = 'https://www.moeaea.gov.tw/ECW/populace/news/wHandNews_File.ashx?file_id=28963'
const FACTORIES =
  'https://serv.gcis.nat.gov.tw/RDownLoad/Data/statistical/%E7%94%9F%E7%94%A2%E4%B8%AD%E5%B7%A5%E5%BB%A0%E6%B8%85%E5%86%8A.zip'
const OVERPASS = 'https://overpass.openstreetmap.fr/api/interpreter'
const FEEDERS = {
  taoyuan: 'https://service.taipower.com.tw/data/opendata/apply/file/d077009/TAOYUAN.zip',
  taichung: 'https://service.taipower.com.tw/data/opendata/apply/file/d077009/TAICHUNG.zip',
} as const

interface Env {
  ASSETS: Fetcher
}

function targetFor(url: URL): { href: string; headers: Record<string, string> } | null {
  const path = url.pathname.replace(/\/$/, '') || '/'
  if (path === '/live/nlsc') {
    const query = url.searchParams.get('q')?.trim()
    if (!query) return null
    return { href: NLSC + encodeURIComponent(query), headers: { Referer: 'https://maps.nlsc.gov.tw/' } }
  }
  if (path === '/live/tariff') return { href: TARIFF, headers: {} }
  if (path === '/live/fit') return { href: FIT, headers: {} }
  if (path === '/live/factories') return { href: FACTORIES, headers: {} }
  if (path === '/live/feeder') {
    const city = url.searchParams.get('city')
    if (city !== 'taoyuan' && city !== 'taichung') return null
    return { href: FEEDERS[city], headers: {} }
  }
  return null
}

function proxyResponse(upstream: Response, href: string): Response {
  const headers = new Headers()
  const type = upstream.headers.get('content-type')
  if (type) headers.set('Content-Type', type)
  const modified = upstream.headers.get('last-modified')
  if (modified) headers.set('X-Upstream-Modified', modified)
  headers.set('X-Upstream-Url', href)
  return new Response(upstream.body, { status: upstream.status, headers })
}

async function live(request: Request, url: URL): Promise<Response> {
  try {
    const path = url.pathname.replace(/\/$/, '') || '/'
    if (path === '/live/overpass') {
      const upstream = await fetch(OVERPASS, {
        method: 'POST',
        headers: {
          'Content-Type': request.headers.get('content-type') || 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'SolarX/1.0 (educational)',
        },
        body: await request.arrayBuffer(),
      })
      return proxyResponse(upstream, OVERPASS)
    }
    const target = targetFor(url)
    if (!target) {
      return new Response('不支援的即時路徑', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    const upstream = await fetch(target.href, {
      headers: { 'User-Agent': 'SolarX/1.0', ...target.headers },
    })
    return proxyResponse(upstream, target.href)
  } catch (error) {
    const message = error instanceof Error ? error.message : '代理失敗'
    return new Response(message, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/$/, '') || '/'
    if (path === '/live' || path.startsWith('/live/')) return live(request, url)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
