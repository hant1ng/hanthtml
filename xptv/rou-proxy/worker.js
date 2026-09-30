const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export default {
  async fetch(request) {
    try {
      if (request.method === 'OPTIONS') {
        return cors(new Response(null, { status: 204 }))
      }

      const reqUrl = new URL(request.url)
      if (reqUrl.pathname !== '/proxy') {
        return cors(new Response('ROU proxy is running', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }))
      }

      const upstream = reqUrl.searchParams.get('url') || ''
      const referer = reqUrl.searchParams.get('ref') || 'https://rou.video/'

      let target
      try {
        target = new URL(upstream)
      } catch (_) {
        return cors(new Response('Bad upstream URL', { status: 400 }))
      }

      if (target.protocol !== 'https:' || !isAllowedHost(target.hostname)) {
        return cors(new Response('Upstream host not allowed', { status: 403 }))
      }

      const headers = new Headers()
      headers.set('User-Agent', UA)
      headers.set('Referer', referer)
      headers.set('Accept', '*/*')
      headers.set('Accept-Encoding', 'identity')

      const upstreamResp = await fetch(target.toString(), {
        method: 'GET',
        headers,
        redirect: 'follow',
      })

      if (!upstreamResp.ok) {
        return cors(new Response('Upstream HTTP ' + upstreamResp.status, {
          status: upstreamResp.status,
        }))
      }

      const finalUrl = upstreamResp.url || target.toString()
      const raw = new Uint8Array(await upstreamResp.arrayBuffer())
      const unwrapped = await unwrapRouPng(raw)
      const body = unwrapped || raw

      const head = decodeHead(body, 32)

      if (head.trimStart().startsWith('#EXTM3U')) {
        const playlist = new TextDecoder().decode(body)
        const rewritten = rewriteM3u8(
          playlist,
          finalUrl,
          referer,
          reqUrl.origin
        )

        return cors(new Response(rewritten, {
          status: 200,
          headers: {
            'content-type': 'application/vnd.apple.mpegurl',
            'cache-control': 'no-store',
          },
        }))
      }

      const mime = detectMediaMime(body, upstreamResp.headers.get('content-type') || '')

      return cors(new Response(body, {
        status: 200,
        headers: {
          'content-type': mime,
          'cache-control': 'no-store',
          'content-length': String(body.byteLength),
        },
      }))
    } catch (e) {
      return cors(new Response('Proxy error: ' + (e && e.message ? e.message : String(e)), {
        status: 500,
      }))
    }
  },
}

function isAllowedHost(host) {
  host = String(host || '').toLowerCase()
  if (host === 'rou.video' || host.endsWith('.rou.video')) return true
  if (/^(?:.+\.)?rn\d+\.xyz$/.test(host)) return true
  if (/^rouva\d+\.xyz$/.test(host)) return true
  return false
}

function cors(response) {
  const h = new Headers(response.headers)
  h.set('Access-Control-Allow-Origin', '*')
  h.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
  h.set('Access-Control-Allow-Headers', '*')
  h.set('Access-Control-Expose-Headers', 'Content-Type,Content-Length')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h,
  })
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
        return await inflateZlib(payload)
      }

      return payload
    }

    offset = dataEnd + 4
  }

  return null
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

async function inflateZlib(payload) {
  const ds = new DecompressionStream('deflate')
  const stream = new Blob([payload]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function rewriteM3u8(text, baseUrl, referer, workerOrigin) {
  const lines = String(text || '').split(/\r?\n/)
  const out = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      out.push('')
      continue
    }

    if (trimmed.startsWith('#')) {
      out.push(rewriteTagUris(line, baseUrl, referer, workerOrigin))
      continue
    }

    out.push(proxyUrl(resolveUrl(baseUrl, trimmed), referer, workerOrigin))
  }

  return out.join('\n')
}

function rewriteTagUris(line, baseUrl, referer, workerOrigin) {
  return line.replace(/URI="([^"]+)"/g, (_, value) => {
    const absolute = resolveUrl(baseUrl, value)
    return 'URI="' + proxyUrl(absolute, referer, workerOrigin) + '"'
  })
}

function resolveUrl(baseUrl, value) {
  try {
    return new URL(value, baseUrl).toString()
  } catch (_) {
    return value
  }
}

function proxyUrl(upstream, referer, workerOrigin) {
  const u = new URL('/proxy', workerOrigin)
  u.searchParams.set('url', upstream)
  u.searchParams.set('ref', referer)
  return u.toString()
}

function decodeHead(bytes, max) {
  try {
    return new TextDecoder().decode(bytes.slice(0, Math.min(max, bytes.length)))
  } catch (_) {
    return ''
  }
}

function detectMediaMime(bytes, fallback) {
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'video/mp4'
  }

  if (bytes.length > 0 && bytes[0] === 0x47) {
    return 'video/mp2t'
  }

  if (fallback && !/image\/png/i.test(fallback)) {
    return fallback
  }

  return 'application/octet-stream'
}
