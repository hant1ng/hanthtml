const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const ROU = 'https://rou.video'
const HOME = ROU + '/home'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    try {
      if (request.method === 'OPTIONS') {
        return cors(new Response(null, { status: 204 }))
      }

      if (url.pathname === '/health') {
        return cors(json({
          ok: true,
          service: 'xptv-rou-proxy',
          mode: 'pages-advanced',
          version: 2,
        }))
      }

      if (url.pathname === '/play') {
        const detail = url.searchParams.get('detail') || ''
        return await handlePlay(detail, url.origin, request.method)
      }

      if (url.pathname === '/proxy') {
        const upstream = url.searchParams.get('url') || ''
        const referer = url.searchParams.get('ref') || HOME
        const cookie = url.searchParams.get('cookie') || ''
        return await proxyMedia(upstream, referer, cookie, url.origin, request.method)
      }

      if (env && env.ASSETS) {
        return env.ASSETS.fetch(request)
      }

      return cors(new Response('XPTV ROU Proxy is running.', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }))
    } catch (e) {
      return cors(json({
        ok: false,
        error: e && e.message ? e.message : String(e),
      }, 500))
    }
  },
}

async function handlePlay(detailUrl, origin, method) {
  const detail = safeUrl(detailUrl)
  if (!detail || detail.protocol !== 'https:' || detail.hostname !== 'rou.video' || !detail.pathname.startsWith('/v/')) {
    return cors(json({ ok: false, error: 'Bad detail URL' }, 400))
  }

  const pageResp = await fetch(detail.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'Referer': HOME,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'identity',
    },
    redirect: 'follow',
  })

  if (!pageResp.ok) {
    return cors(json({
      ok: false,
      stage: 'detail',
      status: pageResp.status,
    }, 502))
  }

  const cookie = cookieHeaderFromResponse(pageResp)
  const html = await pageResp.text()
  const playUrl = extractSignedVideoUrl(html)

  if (!playUrl) {
    return cors(json({
      ok: false,
      stage: 'decode',
      error: 'videoUrl not found',
    }, 502))
  }

  return proxyMedia(playUrl, detail.toString(), cookie, origin, method)
}

async function proxyMedia(upstreamUrl, referer, cookie, origin, method) {
  const target = safeUrl(upstreamUrl)

  if (!target || target.protocol !== 'https:' || !isAllowedHost(target.hostname)) {
    return cors(json({
      ok: false,
      stage: 'proxy',
      error: 'Upstream host not allowed',
      host: target ? target.hostname : '',
    }, 403))
  }

  const headers = new Headers()
  headers.set('User-Agent', UA)
  headers.set('Referer', referer || HOME)
  headers.set('Accept', '*/*')
  headers.set('Accept-Encoding', 'identity;q=1, *;q=0')
  headers.set('Sec-Fetch-Dest', 'video')
  headers.set('Sec-Fetch-Mode', 'no-cors')
  headers.set('Sec-Fetch-Site', 'same-site')
  if (cookie) headers.set('Cookie', cookie)

  const resp = await fetch(target.toString(), {
    method: 'GET',
    headers,
    redirect: 'follow',
  })

  if (!resp.ok) {
    return cors(json({
      ok: false,
      stage: 'upstream',
      status: resp.status,
      host: target.hostname,
    }, resp.status >= 400 && resp.status < 600 ? resp.status : 502))
  }

  const mergedCookie = mergeCookies(cookie, cookieHeaderFromResponse(resp))
  const finalUrl = resp.url || target.toString()
  const raw = new Uint8Array(await resp.arrayBuffer())
  const unwrapped = await unwrapRouPng(raw)
  const body = unwrapped || raw
  const head = decodeHead(body, 64)

  if (head.trimStart().startsWith('#EXTM3U')) {
    const playlist = new TextDecoder().decode(body)
    const rewritten = rewriteM3u8(
      playlist,
      finalUrl,
      referer || HOME,
      mergedCookie,
      origin
    )

    return cors(new Response(method === 'HEAD' ? null : rewritten, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store',
      },
    }))
  }

  const mime = detectMediaMime(body, resp.headers.get('content-type') || '')

  return cors(new Response(method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'content-type': mime,
      'cache-control': 'no-store',
      'content-length': String(body.byteLength),
      'accept-ranges': 'none',
    },
  }))
}

function extractSignedVideoUrl(html) {
  const m = String(html || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m) return ''

  let data
  try {
    data = JSON.parse(m[1])
  } catch (_) {
    return ''
  }

  const ev = data && data.props && data.props.pageProps && data.props.pageProps.ev
  if (!ev || !ev.d || ev.k == null) return ''

  let decoded
  try {
    const binary = atob(String(ev.d))
    const key = Number(ev.k || 0)
    let text = ''
    for (let i = 0; i < binary.length; i++) {
      text += String.fromCharCode((binary.charCodeAt(i) - key + 256) & 255)
    }
    decoded = JSON.parse(text)
  } catch (_) {
    return ''
  }

  let value = String(decoded.videoUrl || '')
  if (!value) return ''

  value = value
    .replace(/\/index\.jpg(?=([?#]|$))/i, '/index.m3u8')
    .replace(/\/index\.png(?=([?#]|$))/i, '/index.m3u8')

  return value
}

function rewriteM3u8(text, baseUrl, referer, cookie, origin) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim()
      if (!trimmed) return ''

      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, value) => {
          const absolute = resolveUrl(baseUrl, value)
          return 'URI="' + makeProxyUrl(absolute, referer, cookie, origin) + '"'
        })
      }

      return makeProxyUrl(resolveUrl(baseUrl, trimmed), referer, cookie, origin)
    })
    .join('\n')
}

function makeProxyUrl(upstream, referer, cookie, origin) {
  const u = new URL('/proxy', origin)
  u.searchParams.set('url', upstream)
  u.searchParams.set('ref', referer || HOME)
  if (cookie) u.searchParams.set('cookie', cookie)
  return u.toString()
}

function cookieHeaderFromResponse(response) {
  const list = []

  try {
    if (response.headers.getSetCookie) {
      const values = response.headers.getSetCookie()
      for (const v of values || []) list.push(v)
    } else if (response.headers.getAll) {
      const values = response.headers.getAll('Set-Cookie')
      for (const v of values || []) list.push(v)
    } else {
      const value = response.headers.get('Set-Cookie')
      if (value) list.push(value)
    }
  } catch (_) {
    const value = response.headers.get('Set-Cookie')
    if (value) list.push(value)
  }

  const pairs = []
  for (const item of list) {
    const first = String(item || '').split(';')[0].trim()
    if (first && first.includes('=')) pairs.push(first)
  }

  return mergeCookies('', pairs.join('; '))
}

function mergeCookies(a, b) {
  const map = {}

  for (const input of [a, b]) {
    String(input || '').split(';').forEach(part => {
      const p = part.trim()
      const i = p.indexOf('=')
      if (i <= 0) return
      const key = p.slice(0, i).trim()
      const value = p.slice(i + 1).trim()
      if (key) map[key] = value
    })
  }

  return Object.keys(map).map(k => k + '=' + map[k]).join('; ')
}

async function unwrapRouPng(bytes) {
  if (!isPng(bytes)) return null

  let offset = 8

  while (offset + 12 <= bytes.length) {
    const length = readU32BE(bytes, offset)
    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (dataEnd + 4 > bytes.length) return null

    const type = String.fromCharCode(
      bytes[typeStart],
      bytes[typeStart + 1],
      bytes[typeStart + 2],
      bytes[typeStart + 3]
    )

    if (type === 'roUd' && length >= 1) {
      const flags = bytes[dataStart]
      const payload = bytes.slice(dataStart + 1, dataEnd)

      if ((flags & 1) !== 0) {
        return inflateZlib(payload)
      }

      return payload
    }

    offset = dataEnd + 4
  }

  return null
}

async function inflateZlib(payload) {
  const ds = new DecompressionStream('deflate')
  const stream = new Response(payload).body.pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function isPng(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!bytes || bytes.length < sig.length) return false

  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false
  }
  return true
}

function readU32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0
}

function detectMediaMime(bytes, fallback) {
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) return 'video/mp4'

  if (bytes.length > 0 && bytes[0] === 0x47) return 'video/mp2t'

  if (fallback && !/image\/png/i.test(fallback)) return fallback
  return 'application/octet-stream'
}

function isAllowedHost(host) {
  host = String(host || '').toLowerCase()
  if (host === 'rou.video' || host.endsWith('.rou.video')) return true
  if (/^(?:.+\.)?rn\d+\.xyz$/.test(host)) return true
  if (/^(?:.+\.)?rouva\d+\.xyz$/.test(host)) return true
  return false
}

function resolveUrl(baseUrl, value) {
  try {
    return new URL(value, baseUrl).toString()
  } catch (_) {
    return value
  }
}

function safeUrl(value) {
  try {
    return new URL(String(value || ''))
  } catch (_) {
    return null
  }
}

function decodeHead(bytes, max) {
  try {
    return new TextDecoder().decode(bytes.slice(0, Math.min(max, bytes.length)))
  } catch (_) {
    return ''
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function cors(response) {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
  headers.set('Access-Control-Allow-Headers', '*')
  headers.set('Access-Control-Expose-Headers', 'Content-Type,Content-Length')
  headers.set('X-ROU-Proxy', 'v2')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
