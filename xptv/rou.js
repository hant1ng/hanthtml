async function getLocalInfo() {
    return jsonify({
        ver: 1,
        name: '肉视频',
        api: 'csp_rouvideo',
    })
}

const cheerio = createCheerio()
const CryptoJS = createCryptoJS()

const ROOT = 'https://rou.video'
const HOME = ROOT + '/home'
const API = ROOT + '/api'
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1'

const appConfig = {
    ver: 1,
    title: '肉视频',
    site: HOME,
    tabs: [
        { name: '首页', ui: 1, ext: { mode: 'home', url: HOME } },
        { name: '最新', ui: 1, ext: { mode: 'list', url: ROOT + '/v?order=createdAt' } },
        { name: '热门', ui: 1, ext: { mode: 'list', url: ROOT + '/v?order=likeCount' } },
        { name: '观看最多', ui: 1, ext: { mode: 'list', url: ROOT + '/v?order=viewCount' } },
        { name: '國產AV', ui: 1, ext: { mode: 'list', url: ROOT + '/t/' + encodeURIComponent('國產AV') } },
        { name: '探花', ui: 1, ext: { mode: 'list', url: ROOT + '/t/' + encodeURIComponent('探花') } },
        { name: '自拍流出', ui: 1, ext: { mode: 'list', url: ROOT + '/t/' + encodeURIComponent('自拍流出') } },
        { name: 'OnlyFans', ui: 1, ext: { mode: 'list', url: ROOT + '/t/OnlyFans' } },
        { name: '日本', ui: 1, ext: { mode: 'list', url: ROOT + '/t/' + encodeURIComponent('日本') } },
    ],
}

function parseJsonIfString(input) {
    if (typeof input !== 'string') return input
    try {
        return JSON.parse(input)
    } catch (e) {
        return null
    }
}

function baseHeaders(acceptJson) {
    const headers = {
        'User-Agent': UA,
        'Referer': HOME,
        'Origin': ROOT,
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    }

    headers['Accept'] = acceptJson
        ? 'application/json, text/plain, */*'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'

    return headers
}

async function requestHtml(url) {
    return await $fetch.get(url, {
        headers: baseHeaders(false),
    })
}

async function requestJson(url) {
    return await $fetch.get(url, {
        headers: baseHeaders(true),
    })
}

function normalizeUrl(url) {
    if (!url) return ''
    let value = String(url)
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&')
        .trim()

    value = value
        .replace(/index\.jpg(?=\?|$)/i, 'index.m3u8')
        .replace(/index\.png(?=\?|$)/i, 'index.m3u8')

    if (/^https?:\/\//i.test(value)) return value
    if (value.startsWith('//')) return 'https:' + value
    if (value.startsWith('/')) return ROOT + value
    return ROOT + '/' + value.replace(/^\.\//, '')
}

function videoIdFromUrl(url) {
    const m = String(url || '').match(/\/v\/([^/?#]+)/i)
    return m ? decodeURIComponent(m[1]) : ''
}

function formatDuration(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds || 0)))
    if (!n) return ''

    const h = Math.floor(n / 3600)
    const m = Math.floor((n % 3600) / 60)
    const s = n % 60

    if (h > 0) {
        return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
    }
    return m + ':' + String(s).padStart(2, '0')
}

function videoToCard(video) {
    if (!video || !video.id) return null

    const id = String(video.id)
    const title = String(video.nameZh || video.name || video.vid || id)
    const cover = normalizeUrl(video.coverImageUrl || '')
    const duration = formatDuration(video.duration)

    let resolution = ''
    if (Array.isArray(video.sources) && video.sources.length) {
        const values = video.sources
            .map(x => Number(x && x.resolution || 0))
            .filter(x => x > 0)
        if (values.length) resolution = Math.max.apply(null, values) + 'p'
    }

    const info = []
    if (resolution) info.push(resolution)
    if (video.viewCount != null) info.push(String(video.viewCount) + '观看')
    if (video.likeCount != null) info.push(String(video.likeCount) + '赞')

    return {
        vod_id: id,
        vod_name: title,
        vod_pic: cover,
        vod_remarks: info.join(' · '),
        vod_duration: duration,
        ext: {
            id,
            url: ROOT + '/v/' + encodeURIComponent(id),
        },
    }
}

function collectVideosFromNextData(data) {
    const $ = cheerio.load(String(data || ''))
    const text = $('#__NEXT_DATA__').html() || $('#__NEXT_DATA__').text() || ''
    if (!text) return []

    const json = parseJsonIfString(text)
    const pageProps = json && json.props && json.props.pageProps
    if (!pageProps) return []

    let videos = []

    if (Array.isArray(pageProps.videos)) {
        videos = pageProps.videos
    } else {
        const known = [
            'latestVideos',
            'dailyHotCNAV',
            'dailyHotSelfie',
            'dailyHot91',
            'dailyOnlyFans',
            'dailyJV',
            'hotCNAV',
            'hotSelfie',
            'hot91',
            'relatedVideos',
        ]

        known.forEach(key => {
            if (Array.isArray(pageProps[key])) videos = videos.concat(pageProps[key])
        })
    }

    const seen = new Set()
    const cards = []

    videos.forEach(video => {
        const card = videoToCard(video)
        if (!card || seen.has(card.vod_id)) return
        seen.add(card.vod_id)
        cards.push(card)
    })

    return cards
}

function collectVideosFromDom(data) {
    const $ = cheerio.load(String(data || ''))
    const seen = new Set()
    const cards = []

    const selectors = [
        'div.grid.grid-cols-2.lg\\:grid-cols-3.gap-1.lg\\:gap-2.mb-6 .shadow',
        '.grid.grid-cols-2.mb-6 > div',
        '[data-slot="card"]',
    ]

    $(selectors.join(',')).each((_, element) => {
        const el = $(element)
        const a = el.find('a[href^="/v/"], a[href*="/v/"]').first()
        const href = a.attr('href') || ''
        if (!href) return

        const url = normalizeUrl(href)
        const id = videoIdFromUrl(url)
        if (!id || seen.has(id)) return

        const img = el.find('img').first()
        const title = String(
            img.attr('alt') ||
            a.attr('title') ||
            el.find('.title').first().text() ||
            id
        ).trim()

        const cover = normalizeUrl(
            img.attr('src') ||
            img.attr('data-src') ||
            img.attr('data-original') ||
            ''
        )

        const remarks = String(
            el.find('.relative a > div:eq(1)').first().text() ||
            el.find('.relative a > div:first').first().text() ||
            ''
        ).trim()

        seen.add(id)
        cards.push({
            vod_id: String(id),
            vod_name: title,
            vod_pic: cover,
            vod_remarks: remarks,
            ext: {
                id: String(id),
                url,
            },
        })
    })

    return cards
}

function parseCards(data) {
    const fromNext = collectVideosFromNextData(data)
    if (fromNext.length) return fromNext
    return collectVideosFromDom(data)
}

function appendPage(url, page) {
    if (page <= 1) return url
    return url + (url.includes('?') ? '&' : '?') + 'page=' + page
}

function decodeEv(ev) {
    if (!ev || !ev.d || ev.k == null) return null

    try {
        const raw = CryptoJS.enc.Base64
            .parse(String(ev.d))
            .toString(CryptoJS.enc.Latin1)

        let decoded = ''
        const shift = Number(ev.k || 0)

        for (let i = 0; i < raw.length; i++) {
            decoded += String.fromCharCode((raw.charCodeAt(i) - shift + 256) & 255)
        }

        return parseJsonIfString(decoded)
    } catch (e) {
        return null
    }
}

function extractEvFromHtml(data) {
    const $ = cheerio.load(String(data || ''))
    const text = $('#__NEXT_DATA__').html() || $('#__NEXT_DATA__').text() || ''

    if (text) {
        const json = parseJsonIfString(text)
        const ev = json && json.props && json.props.pageProps && json.props.pageProps.ev
        const decoded = decodeEv(ev)
        if (decoded && decoded.videoUrl) return decoded
    }

    const html = String(data || '')
    const evMatch = html.match(/["']ev["']\s*:\s*\{([\s\S]*?)\}/i)
    if (evMatch) {
        const block = evMatch[1]
        const d = block.match(/["']d["']\s*:\s*["']([^"']+)["']/i)
        const k = block.match(/["']k["']\s*:\s*(\d+)/i)
        if (d && k) {
            const decoded = decodeEv({
                d: d[1],
                k: Number(k[1]),
            })
            if (decoded && decoded.videoUrl) return decoded
        }
    }

    return null
}

async function resolvePlayUrl(id, pageUrl) {
    const cleanId = String(id || videoIdFromUrl(pageUrl || '') || '').trim()
    if (!cleanId) return ''

    try {
        const { data } = await requestJson(API + '/v/' + encodeURIComponent(cleanId))
        const json = parseJsonIfString(data)
        const url = json && json.video && json.video.videoUrl

        if (url) return normalizeUrl(url)
    } catch (e) {
        $print('Rou API error: ' + e)
    }

    try {
        const { data } = await requestHtml(pageUrl || (ROOT + '/v/' + encodeURIComponent(cleanId)))
        const decoded = extractEvFromHtml(data)
        if (decoded && decoded.videoUrl) return normalizeUrl(decoded.videoUrl)
    } catch (e) {
        $print('Rou page fallback error: ' + e)
    }

    return ''
}

async function getConfig() {
    return jsonify(appConfig)
}

async function getCards(ext) {
    try {
        ext = argsify(ext)
        const page = Number(ext.page || 1)
        const mode = ext.mode || 'list'
        let url = ext.url || HOME

        if (mode === 'home' && page > 1) {
            url = ROOT + '/v?order=createdAt&page=' + page
        } else {
            url = appendPage(url, page)
        }

        const { data } = await requestHtml(url)
        const list = parseCards(data)

        return jsonify({
            list,
            page,
        })
    } catch (e) {
        $print('Rou getCards error: ' + e)
        return jsonify({ list: [] })
    }
}

async function getTracks(ext) {
    try {
        ext = argsify(ext)
        const id = String(ext.id || videoIdFromUrl(ext.url || '') || '').trim()
        const url = ext.url || (id ? ROOT + '/v/' + encodeURIComponent(id) : '')

        if (!id || !url) return jsonify({ list: [] })

        return jsonify({
            list: [{
                title: '播放',
                tracks: [{
                    name: '播放',
                    pan: '',
                    ext: {
                        id,
                        url,
                    },
                }],
            }],
        })
    } catch (e) {
        $print('Rou getTracks error: ' + e)
        return jsonify({ list: [] })
    }
}

async function getPlayinfo(ext) {
    try {
        ext = argsify(ext)
        const id = String(ext.id || videoIdFromUrl(ext.url || '') || '').trim()
        const pageUrl = ext.url || (id ? ROOT + '/v/' + encodeURIComponent(id) : '')

        const playurl = await resolvePlayUrl(id, pageUrl)

        if (!playurl) {
            $utils.toastError('肉视频播放地址解析失败')
            return jsonify({
                urls: [],
                headers: [],
            })
        }

        return jsonify({
            urls: [playurl],
            type: /\.m3u8(?:\?|$)/i.test(playurl) ? 'm3u8' : 'mp4',
            headers: [{
                'User-Agent': UA,
                'Referer': HOME,
                'Origin': ROOT,
            }],
        })
    } catch (e) {
        $print('Rou getPlayinfo error: ' + e)
        return jsonify({
            urls: [],
            headers: [],
        })
    }
}

async function search(ext) {
    try {
        ext = argsify(ext)
        const text = String(ext.text || '').trim()
        const page = Number(ext.page || 1)

        if (!text) return jsonify({ list: [], page })

        const url = ROOT +
            '/search?q=' + encodeURIComponent(text) +
            '&t=&page=' + page

        const { data } = await requestHtml(url)
        const list = parseCards(data)

        return jsonify({
            list,
            page,
        })
    } catch (e) {
        $print('Rou search error: ' + e)
        return jsonify({ list: [] })
    }
}
