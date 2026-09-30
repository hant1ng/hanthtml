async function getLocalInfo() {
    return jsonify({
        ver: 1,
        name: '🕶️Pornhub 中文',
        api: 'csp_pornhub_cn',
    })
}

const cheerio = createCheerio()

const SITE = 'https://cn.pornhub.com'
const HOME = SITE + '/language/chinese'
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1'
const COOKIE_KEY = 'pornhub_cn_cookie'
const AGE_COOKIE = 'age_verified=1; accessAgeDisclaimerPH=1; has_access=1; il=v111'

const appConfig = {
    ver: 1,
    title: '🕶️Pornhub 中文',
    site: HOME,
    tabs: [
        { name: '中文', ui: 1, ext: { id: 'chinese' } },
        { name: '最新', ui: 1, ext: { id: 'cm' } },
        { name: '观看最多', ui: 1, ext: { id: 'mv' } },
        { name: '热门', ui: 1, ext: { id: 'ht' } },
        { name: '评分最高', ui: 1, ext: { id: 'tr' } },
    ],
}

function getHeaderCI(headers, name) {
    if (!headers) return ''
    const target = String(name || '').toLowerCase()
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === target) return headers[key]
    }
    return ''
}

function cookieMap(cookie) {
    const out = {}
    String(cookie || '').split(';').forEach(part => {
        const i = part.indexOf('=')
        if (i <= 0) return
        const k = part.slice(0, i).trim()
        const v = part.slice(i + 1).trim()
        if (k) out[k] = v
    })
    return out
}

function getCookie() {
    const base = cookieMap(AGE_COOKIE)
    const cached = cookieMap($cache.get(COOKIE_KEY) || '')
    Object.keys(cached).forEach(k => {
        base[k] = cached[k]
    })
    return Object.keys(base).map(k => k + '=' + base[k]).join('; ')
}

function updateCookies(headers) {
    const raw = getHeaderCI(headers, 'Set-Cookie')
    if (!raw) return

    const map = cookieMap($cache.get(COOKIE_KEY) || '')
    const text = Array.isArray(raw) ? raw.join('\n') : String(raw)
    const names = ['cf_clearance', 'bs', 'ss', 'platform', 'ua', 'il']

    names.forEach(name => {
        const re = new RegExp('(?:^|[\\n,]\\s*)' + name + '=([^;\\n,]+)', 'i')
        const m = text.match(re)
        if (m && m[1]) map[name] = m[1]
    })

    const cookie = Object.keys(map).map(k => k + '=' + map[k]).join('; ')
    if (cookie) $cache.set(COOKIE_KEY, cookie)
}

function baseHeaders(referer) {
    return {
        'User-Agent': UA,
        'Referer': referer || HOME,
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Cookie': getCookie(),
    }
}

async function requestPage(url, referer) {
    const res = await $fetch.get(url, {
        headers: baseHeaders(referer),
    })
    updateCookies(res.respHeaders || res.headers || {})
    return res
}

function normalizeUrl(url) {
    if (!url) return ''
    url = String(url).replace(/&amp;/g, '&')
    if (/^https?:\/\//i.test(url)) return url
    if (url.startsWith('//')) return 'https:' + url
    if (url.startsWith('/')) return SITE + url
    return SITE + '/' + url.replace(/^\.\//, '')
}

function viewKeyFromUrl(url) {
    const m = String(url || '').match(/[?&]viewkey=([A-Za-z0-9]+)/)
    return m ? m[1] : ''
}

function firstNonEmpty(values) {
    for (const value of values) {
        if (value && String(value).trim()) return String(value).trim()
    }
    return ''
}

function isChallengePage(data) {
    const html = String(data || '')
    return /cf-chl-|challenge-platform|Just a moment|Attention Required|Access Denied/i.test(html)
}

function parseCards(data) {
    const $ = cheerio.load(String(data || ''))
    const selectors = [
        'li.pcVideoListItem',
        'li.videoBox',
        '.videoBlock',
        'li[data-video-vkey]',
        'div[data-video-vkey]',
        'ul#videoSearchResult li',
    ]

    const seen = new Set()
    const cards = []

    $(selectors.join(',')).each((_, element) => {
        const el = $(element)
        const a = el.find('a[href*="view_video.php"][href*="viewkey="]').first()
        const href = a.attr('href') || ''
        if (!href) return

        const url = normalizeUrl(href)
        const viewkey = viewKeyFromUrl(url)
        if (!viewkey || seen.has(viewkey)) return

        const img = el.find('img').first()
        let cover = firstNonEmpty([
            img.attr('data-src'),
            img.attr('data-thumb_url'),
            img.attr('data-mediumthumb'),
            img.attr('data-image'),
            img.attr('src'),
        ])
        cover = normalizeUrl(cover.replace(/THUMBNUM/g, '1'))

        const title = firstNonEmpty([
            el.find('.title a').first().attr('title'),
            el.find('.title a').first().text(),
            a.attr('title'),
            img.attr('alt'),
        ])

        if (!title) return

        const duration = firstNonEmpty([
            el.find('.duration').first().text(),
            el.find('.varDuration').first().text(),
        ])

        const views = firstNonEmpty([
            el.find('.views var').first().text(),
            el.find('.views').first().text(),
        ])

        seen.add(viewkey)
        cards.push({
            vod_id: String(viewkey),
            vod_name: title,
            vod_pic: cover,
            vod_remarks: views,
            vod_duration: duration,
            ext: {
                url,
                viewkey,
            },
        })
    })

    return cards
}

function findMatching(text, start, openChar, closeChar) {
    if (start < 0 || text[start] !== openChar) return -1

    let depth = 0
    let inString = false
    let quote = ''
    let escaped = false

    for (let i = start; i < text.length; i++) {
        const ch = text[i]

        if (inString) {
            if (escaped) {
                escaped = false
            } else if (ch === '\\') {
                escaped = true
            } else if (ch === quote) {
                inString = false
            }
            continue
        }

        if (ch === '"' || ch === "'") {
            inString = true
            quote = ch
            continue
        }

        if (ch === openChar) {
            depth += 1
        } else if (ch === closeChar) {
            depth -= 1
            if (depth === 0) return i + 1
        }
    }

    return -1
}

function extractFlashvars(data) {
    const html = String(data || '')
    const patterns = [
        /(?:var\s+|window\.|self\.)?flashvars_\d+\s*=\s*\{/g,
        /(?:var\s+)?flashvars\s*=\s*\{/g,
    ]

    for (const re of patterns) {
        let m
        while ((m = re.exec(html)) !== null) {
            const braceStart = m.index + m[0].lastIndexOf('{')
            const braceEnd = findMatching(html, braceStart, '{', '}')
            if (braceEnd < 0) continue

            try {
                const obj = JSON.parse(html.slice(braceStart, braceEnd))
                if (obj && Array.isArray(obj.mediaDefinitions) && obj.mediaDefinitions.length) {
                    return obj
                }
            } catch (e) {}
        }
    }

    return null
}

function extractBareMediaDefinitions(data) {
    const html = String(data || '')
    const re = /["']?mediaDefinitions["']?\s*:\s*\[/g
    let m

    while ((m = re.exec(html)) !== null) {
        const start = m.index + m[0].lastIndexOf('[')
        const end = findMatching(html, start, '[', ']')
        if (end < 0) continue

        try {
            const arr = JSON.parse(html.slice(start, end))
            if (Array.isArray(arr) && arr.length) return arr
        } catch (e) {}
    }

    return []
}

function qualityNumber(value) {
    if (Array.isArray(value)) {
        let best = 0
        value.forEach(v => {
            const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10)
            if (!Number.isNaN(n) && n > best) best = n
        })
        return best
    }

    const n = parseInt(String(value == null ? '' : value).replace(/[^0-9]/g, ''), 10)
    return Number.isNaN(n) ? 0 : n
}

function isIndirectUrl(url) {
    return /\/video\/get_media(?:\?|$)|\/media\/(?:mp4|hls)\/?(?:\?|$)/i.test(String(url || ''))
}

function sourcesFromDefinitions(defs) {
    const sources = []
    const seen = new Set()

    ;(defs || []).forEach(def => {
        if (!def) return

        const url = String(def.videoUrl || '').replace(/\\\//g, '/')
        if (!/^https?:\/\//i.test(url) || isIndirectUrl(url)) return
        if (seen.has(url)) return

        const format = String(def.format || '').toLowerCase()
        const type = format === 'hls' || /\.m3u8(?:\?|$)/i.test(url) ? 'm3u8' : 'mp4'
        const quality = qualityNumber(def.quality)
        const label = quality ? quality + 'p' : (type === 'm3u8' ? 'HLS' : 'MP4')

        seen.add(url)
        sources.push({
            url,
            type,
            format: type === 'm3u8' ? 'hls' : 'mp4',
            quality,
            label,
        })
    })

    sources.sort((a, b) => {
        if (b.quality !== a.quality) return b.quality - a.quality
        if (a.format === b.format) return 0
        return a.format === 'hls' ? -1 : 1
    })

    return sources
}

async function resolveIndirectDefinitions(defs, referer) {
    const out = []

    for (const def of defs || []) {
        const endpoint = String((def && def.videoUrl) || '').replace(/\\\//g, '/')
        if (!/^https?:\/\//i.test(endpoint) || !isIndirectUrl(endpoint)) continue

        try {
            const { data } = await $fetch.get(endpoint, {
                headers: baseHeaders(referer || SITE + '/'),
            })
            const parsed = typeof data === 'string' ? JSON.parse(data) : data
            const arr = Array.isArray(parsed)
                ? parsed
                : (parsed && Array.isArray(parsed.mediaDefinitions) ? parsed.mediaDefinitions : [])

            arr.forEach(item => {
                if (item && item.videoUrl) out.push(item)
            })
        } catch (e) {
            $print('Pornhub indirect media error: ' + e)
        }
    }

    return out
}

async function resolveStreams(pageUrl, retry) {
    let { data } = await requestPage(pageUrl, SITE + '/')
    let flashvars = extractFlashvars(data)
    let defs = flashvars ? flashvars.mediaDefinitions : extractBareMediaDefinitions(data)
    let sources = sourcesFromDefinitions(defs)

    if (!sources.length && defs && defs.length) {
        const indirect = await resolveIndirectDefinitions(defs, pageUrl)
        sources = sourcesFromDefinitions(indirect)
    }

    if (!sources.length && retry) {
        $cache.del(COOKIE_KEY)
        try {
            await requestPage(HOME, SITE + '/')
        } catch (e) {}

        ;({ data } = await requestPage(pageUrl, SITE + '/'))
        flashvars = extractFlashvars(data)
        defs = flashvars ? flashvars.mediaDefinitions : extractBareMediaDefinitions(data)
        sources = sourcesFromDefinitions(defs)

        if (!sources.length && defs && defs.length) {
            const indirect = await resolveIndirectDefinitions(defs, pageUrl)
            sources = sourcesFromDefinitions(indirect)
        }
    }

    return {
        sources,
        challenge: isChallengePage(data),
    }
}

async function getConfig() {
    return jsonify(appConfig)
}

async function getCards(ext) {
    try {
        ext = argsify(ext)
        const page = Number(ext.page || 1)
        const id = ext.id || 'chinese'

        let url
        if (id === 'chinese') {
            url = HOME + (page > 1 ? '?page=' + page : '')
        } else {
            url = SITE + '/video?o=' + encodeURIComponent(id)
            if (page > 1) url += '&page=' + page
        }

        const { data } = await requestPage(url, HOME)
        const list = parseCards(data)

        if (!list.length && isChallengePage(data)) {
            $utils.toastError('Pornhub 当前返回了验证页面')
        }

        return jsonify({
            list,
            page,
        })
    } catch (e) {
        $print('Pornhub getCards error: ' + e)
        return jsonify({ list: [] })
    }
}

async function getTracks(ext) {
    try {
        ext = argsify(ext)
        const pageUrl = normalizeUrl(ext.url || '')
        const viewkey = ext.viewkey || viewKeyFromUrl(pageUrl)

        if (!pageUrl) return jsonify({ list: [] })

        const result = await resolveStreams(pageUrl, false)
        let tracks = result.sources.map(source => ({
            name: source.label,
            pan: '',
            ext: {
                url: pageUrl,
                viewkey,
                quality: source.quality,
                format: source.format,
            },
        }))

        if (!tracks.length) {
            tracks = [{
                name: '自动解析',
                pan: '',
                ext: {
                    url: pageUrl,
                    viewkey,
                    quality: 0,
                    format: '',
                },
            }]
        }

        return jsonify({
            list: [{
                title: '播放',
                tracks,
            }],
        })
    } catch (e) {
        $print('Pornhub getTracks error: ' + e)
        return jsonify({ list: [] })
    }
}

async function getPlayinfo(ext) {
    try {
        ext = argsify(ext)
        const pageUrl = normalizeUrl(ext.url || '')
        const wantedQuality = Number(ext.quality || 0)
        const wantedFormat = String(ext.format || '').toLowerCase()

        if (!pageUrl) return jsonify({ urls: [], headers: [] })

        const result = await resolveStreams(pageUrl, true)
        const sources = result.sources

        if (!sources.length) {
            if (result.challenge) {
                $utils.toastError('Pornhub 验证页面导致播放地址解析失败')
            } else {
                $utils.toastError('Pornhub 播放地址解析失败')
            }
            return jsonify({ urls: [], headers: [] })
        }

        let chosen = null

        if (wantedQuality) {
            chosen = sources.find(s =>
                s.quality === wantedQuality &&
                (!wantedFormat || s.format === wantedFormat)
            ) || sources.find(s => s.quality === wantedQuality)
        }

        if (!chosen && wantedFormat) {
            chosen = sources.find(s => s.format === wantedFormat)
        }

        if (!chosen) chosen = sources[0]

        const headers = {
            'User-Agent': UA,
            'Referer': SITE + '/',
            'Origin': SITE,
            'Cookie': getCookie(),
        }

        return jsonify({
            urls: [chosen.url],
            type: chosen.type,
            headers: [headers],
        })
    } catch (e) {
        $print('Pornhub getPlayinfo error: ' + e)
        return jsonify({ urls: [], headers: [] })
    }
}

async function search(ext) {
    try {
        ext = argsify(ext)
        const text = String(ext.text || '').trim()
        const page = Number(ext.page || 1)

        if (!text) return jsonify({ list: [], page })

        const url = SITE +
            '/video/search?search=' + encodeURIComponent(text) +
            '&page=' + page

        const { data } = await requestPage(url, HOME)
        const list = parseCards(data)

        if (!list.length && isChallengePage(data)) {
            $utils.toastError('Pornhub 当前返回了验证页面')
        }

        return jsonify({
            list,
            page,
        })
    } catch (e) {
        $print('Pornhub search error: ' + e)
        return jsonify({ list: [] })
    }
}
