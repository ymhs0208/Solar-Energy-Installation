interface AssetsEnv {
  ASSETS: { fetch: (input: Request) => Promise<Response> }
}

export async function onRequest(context: { request: Request; env: AssetsEnv }): Promise<Response> {
  const indexUrl = new URL(context.request.url)
  indexUrl.pathname = '/'
  const asset = await context.env.ASSETS.fetch(new Request(indexUrl, { method: 'GET' }))
  return new Response(asset.body, {
    status: 200,
    headers: { 'Content-Type': asset.headers.get('content-type') || 'text/html; charset=utf-8' },
  })
}
