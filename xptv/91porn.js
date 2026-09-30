async function getLocalInfo() {
    return jsonify({
        ver: 1,
        name: '91Porn',
        api: 'csp_91Porn',
    })
}

const cheerio = createCheerio()
const CryptoJS = createCryptoJS()

const SITE = 'https://91porn.com'
const HOME = SITE + '/index.php'
const UA = '91appnew'
const XRW = 'im.xyz.browserx'
const COOKIE_KEY = '91porn_session_cookie'

const appConfig = {
    ver: 1,
    title: '91Porn',
    site: HOME,
    tabs: [
        { name: '首页', ui: 1, ext: { type: 'home' } },
        { name: '最新', ui: 1, ext: { type: 'latest' } },
        { name: '精选', ui: 1, ext: { type: 'category', id: 'rf' } },
        { name: '当前最热', ui: 1, ext: { type: 'category', id: 'hot' } },
        { name: '本月最热', ui: 1, ext: { type: 'category', id: 'top' } },
        { name: '本月收藏', ui: 1, ext: { type: 'category', id: 'tf' } },
        { name: '收藏最多', ui: 1, ext: { type: 'category', id: 'mf' } },
        { name: '讨论最多', ui: 1, ext: { type: 'category', id: 'md' } },
        { name: '原创', ui: 1, ext: { type: 'category', id: 'ori' } },
        { name: '高清', ui: 1, ext: { type: 'category', id: 'hd' } },
        { name: '10分钟以上', ui: 1, ext: { type: 'category', id: 'long' } },
        { name: '20分钟以上', ui: 1, ext: { type: 'category', id: 'longer' } },
    ],
}

function getHeaderCI(headers, name) {
    if (!headers) return ''
    const lower = String(name || '').toLowerCase()
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) return headers[key]
    }
    return ''
}

function normalizeUrl(url) {
    if (!url) return ''
    url = String(url).replace(/&amp;/g, '&')
    if (/^https?:\/\//i.test(url)) return url
    if (url.startsWith('//')) return 'https:' + url
    if (url.startsWith('/')) return SITE + url
    return SITE + '/' + url.replace(/^\.\//, '')
}

function getCachedCookie() {
    let cookie = $cache.get(COOKIE_KEY) || ''
    cookie = String(cookie)
    if (!/(?:^|;\s*)language=/.test(cookie)) {
        cookie = cookie ? cookie + '; language=cn_CN' : 'language=cn_CN'
    }
    return cookie
}

function cookieMapFromHeader(cookie) {
    const out = {}
    String(cookie || '').split(';').forEach(part => {
        const i = part.indexOf('=')
        if (i <= 0) return
        const name = part.slice(0, i).trim()
        const value = part.slice(i + 1).trim()
        if (name) out[name] = value
    })
    return out
}

function updateCookies(respHeaders) {
    const raw = getHeaderCI(respHeaders, 'Set-Cookie')
    if (!raw) return

    const map = cookieMapFromHeader(getCachedCookie())
    const text = Array.isArray(raw) ? raw.join('\n') : String(raw)

    const names = ['ga', 'PHPSESSID', 'language', 'cf_clearance']
    names.forEach(name => {
        const re = new RegExp('(?:^|[\\n,]\\s*)' + name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '=([^;\\n,]+)', 'i')
        const m = text.match(re)
        if (m && m[1]) map[name] = m[1]
    })

    if (!map.language) map.language = 'cn_CN'

    const cookie = Object.keys(map)
        .map(k => k + '=' + map[k])
        .join('; ')

    if (cookie) $cache.set(COOKIE_KEY, cookie)
}

function baseHeaders(xhr) {
    const headers = {
        'User-Agent': UA,
        'Referer': HOME,
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Cookie': getCachedCookie(),
    }
    if (xhr) headers['X-Requested-With'] = XRW
    return headers
}

async function requestPage(url, xhr = false) {
    const res = await $fetch.get(url, {
        headers: baseHeaders(xhr),
    })

    updateCookies(res.respHeaders || res.headers || {})
    return res
}

async function ensureSession() {
    const cookie = getCachedCookie()
    if (/(?:^|;\s*)ga=/.test(cookie)) return

    await requestPage(SITE + '/v.php?category=rf&viewtype=basic&page=1')

    const warmed = getCachedCookie()
    if (!/(?:^|;\s*)ga=/.test(warmed)) {
        await requestPage(HOME)
    }
}

function cardMarker(href) {
    const m = String(href || '').match(/[?&]c=([^&]+)/)
    return m ? m[1] : ''
}

function viewKeyFromHref(href) {
    const m = String(href || '').match(/[?&]viewkey=([A-Za-z0-9]+)/)
    return m ? m[1] : ''
}

function firstNonEmpty(values) {
    for (const v of values) {
        if (v && String(v).trim()) return String(v).trim()
    }
    return ''
}

function parseCards(data) {
    const $ = cheerio.load(String(data || ''))
    let nodes = $('div.well.well-sm')

    if (!nodes.length) nodes = $('.row .well')
    if (!nodes.length) nodes = $('.row .col-xs-12')

    const markerSet = new Set()

    nodes.each((_, el) => {
        const href = $(el).find('a[href*="viewkey"]').first().attr('href') || ''
        const marker = cardMarker(href)
        if (marker) markerSet.add(marker)
    })

    const decoyMarkers = new Set()
    markerSet.forEach(marker => {
        if (marker.startsWith('a') && markerSet.has(marker.slice(1))) {
            decoyMarkers.add(marker)
        }
    })

    const seen = new Set()
    const list = []

    nodes.each((_, el) => {
        const a = $(el).find('a[href*="viewkey"]').first()
        const href = a.attr('href') || ''
        if (!href) return

        const marker = cardMarker(href)
        if (marker && decoyMarkers.has(marker)) return

        const viewkey = viewKeyFromHref(href)
        if (!viewkey || seen.has(viewkey)) return

        const img = $(el).find('img').first()
        const title = firstNonEmpty([
            $(el).find('span.video-title').first().text(),
            $(el).find('.video-title').first().text(),
            img.attr('alt'),
            a.attr('title'),
        ])

        if (!title) return

        const cover = firstNonEmpty([
            img.attr('src'),
            img.attr('data-original'),
            img.attr('data-src'),
            img.attr('data-thumb_url'),
        ])

        const duration = $(el).find('span.duration, .duration').first().text().trim()
        const isHd = $(el).find('div.hd-text-icon, .hd-text-icon').length > 0
        const remarks = [isHd ? 'HD' : '', duration].filter(Boolean).join(' · ')

        const detailUrl = normalizeUrl(href)
        seen.add(viewkey)

        list.push({
            vod_id: viewkey,
            vod_name: title,
            vod_pic: cover,
            vod_remarks: remarks,
            vod_duration: duration,
            ext: {
                url: detailUrl,
                viewkey: viewkey,
            },
        })
    })

    return list
}

async function getConfig() {
    return jsonify(appConfig)
}

async function getCards(ext) {
    ext = argsify(ext)
    const page = Number(ext.page || 1)
    const type = ext.type || 'home'
    const id = ext.id || ''

    await ensureSession()

    let url = HOME

    if (type === 'latest') {
        url = SITE + '/v.php?next=watch&page=' + page
    } else if (type === 'category') {
        url = SITE + '/v.php?category=' + encodeURIComponent(id) + '&viewtype=basic&page=' + page
    } else if (page > 1) {
        url = SITE + '/v.php?next=watch&page=' + page
    }

    const { data } = await requestPage(url)
    const list = parseCards(data)

    return jsonify({
        list,
        page,
    })
}

function jsUnescape(input) {
    const s = String(input || '')
    let out = ''

    for (let i = 0; i < s.length;) {
        if (s[i] === '%' && i + 5 < s.length && (s[i + 1] === 'u' || s[i + 1] === 'U')) {
            const code = parseInt(s.slice(i + 2, i + 6), 16)
            if (!Number.isNaN(code)) {
                out += String.fromCharCode(code)
                i += 6
                continue
            }
        }

        if (s[i] === '%' && i + 2 < s.length) {
            const code = parseInt(s.slice(i + 1, i + 3), 16)
            if (!Number.isNaN(code)) {
                out += String.fromCharCode(code)
                i += 3
                continue
            }
        }

        out += s[i]
        i += 1
    }

    return out
}

function decodeBase64Latin1(input) {
    return CryptoJS.enc.Base64.parse(String(input || '')).toString(CryptoJS.enc.Latin1)
}

function decodeStrencode(input0, key0, flag) {
    let input = String(input0 || '')
    let key = String(key0 || '')

    if (!key) return ''

    if (flag && String(flag).slice(-1) === '2') {
        const tmp = input
        input = key
        key = tmp
    }

    const first = decodeBase64Latin1(input)
    let mixed = ''

    for (let i = 0; i < first.length; i++) {
        const a = first.charCodeAt(i) & 0xff
        const b = key.charCodeAt(i % key.length) & 0xff
        mixed += String.fromCharCode(a ^ b)
    }

    return decodeBase64Latin1(mixed)
}

function extractSourceTag(text) {
    const html = String(text || '')
    let m = html.match(/src\s*=\s*['"]([^'"]+)['"]/i)
    if (!m) return null

    const url = m[1].replace(/&amp;/g, '&')
    if (!/^https?:\/\//i.test(url)) return null

    const typeMatch = html.match(/type\s*=\s*['"]([^'"]+)['"]/i)
    const type = typeMatch ? typeMatch[1] : ''

    return { url, type }
}

function addSource(out, source) {
    if (!source || !source.url) return
    if (out.some(x => x.url === source.url)) return

    let name = 'MP4'
    if (/mpegurl/i.test(source.type || '') || /\.m3u8(?:\?|$)/i.test(source.url)) {
        name = 'HLS'
    } else if (source.url.includes('/mp43/')) {
        name = 'HD'
    } else if (source.url.includes('/mp42/')) {
        name = 'SD'
    } else if (source.url.includes('/mp41/')) {
        name = 'Low'
    }

    out.push({
        name,
        url: source.url,
        type: /\.m3u8(?:\?|$)/i.test(source.url) ? 'm3u8' : 'mp4',
    })
}

function extractStreams(data) {
    const html = String(data || '')
    const found = []

    const se2 = /strencode2\(\s*["']([^"']+)["']\s*\)/g
    let m

    while ((m = se2.exec(html)) !== null) {
        addSource(found, extractSourceTag(jsUnescape(m[1])))
    }

    if (!found.length) {
        const k = html.match(/killcovid([\s\S]*?)killcovid/i)
        if (k && k[1]) {
            addSource(found, extractSourceTag(jsUnescape(k[1])))
        }
    }

    if (!found.length) {
        const se3 = html.match(/strencode\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/)
        if (se3) {
            try {
                addSource(found, extractSourceTag(decodeStrencode(se3[1], se3[2], se3[3])))
            } catch (e) {}
        }
    }

    if (!found.length) {
        const sourceTags = html.match(/<source\b[^>]*>/gi) || []
        sourceTags.forEach(tag => addSource(found, extractSourceTag(tag)))
    }

    if (!found.length) {
        const direct = html.match(/https?:\/\/[^"'<>\s]+\.(?:m3u8|mp4)(?:\?[^"'<>\s]*)?/i)
        if (direct) addSource(found, { url: direct[0].replace(/&amp;/g, '&'), type: '' })
    }

    return found
}

async function resolveStreams(ext, retry = true) {
    const viewkey = ext.viewkey || viewKeyFromHref(ext.url || '')
    const url = ext.url
        ? normalizeUrl(ext.url)
        : SITE + '/view_video.php?viewkey=' + encodeURIComponent(viewkey) + '&page=&viewtype=&category='

    await ensureSession()

    let { data } = await requestPage(url)
    let sources = extractStreams(data)

    if (!sources.length && retry) {
        $cache.del(COOKIE_KEY)
        await ensureSession()
        ;({ data } = await requestPage(url))
        sources = extractStreams(data)
    }

    return {
        url,
        viewkey,
        sources,
    }
}

async function getTracks(ext) {
    ext = argsify(ext)

    const viewkey = ext.viewkey || viewKeyFromHref(ext.url || '')
    const url = ext.url
        ? normalizeUrl(ext.url)
        : SITE + '/view_video.php?viewkey=' + encodeURIComponent(viewkey) + '&page=&viewtype=&category='

    return jsonify({
        list: [
            {
                title: '播放',
                tracks: [
                    {
                        name: '播放',
                        pan: '',
                        ext: {
                            url,
                            viewkey,
                        },
                    },
                ],
            },
        ],
    })
}

async function getPlayinfo(ext) {
    ext = argsify(ext)

    const { sources } = await resolveStreams(ext, true)

    if (!sources.length) {
        $utils.toastError('91Porn 播放地址解析失败')
        return jsonify({
            urls: [],
            headers: [],
        })
    }

    const headers = sources.map(() => ({
        'User-Agent': UA,
        'Referer': SITE + '/',
    }))

    return jsonify({
        urls: sources.map(source => source.url),
        headers,
    })
}

async function search(ext) {
    ext = argsify(ext)
    const text = String(ext.text || '').trim()
    const page = Number(ext.page || 1)

    if (!text) return jsonify({ list: [], page })

    await ensureSession()

    const url = SITE +
        '/search_result.php?search_id=' + encodeURIComponent(text) +
        '&search_type=search_videos&page=' + page

    const { data } = await requestPage(url, true)
    const list = parseCards(data)

    return jsonify({
        list,
        page,
    })
}
