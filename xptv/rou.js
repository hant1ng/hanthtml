async function getLocalInfo() {
    return jsonify({
        ver: 10,
        name: '🕶️肉视频',
        api: 'csp_rouvideo',
    })
}

const cheerio = createCheerio()

const ROOT = 'https://rou.video'
const HOME = ROOT + '/home'
const API = ROOT + '/api'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const DEFAULT_ROU_PROXY = 'https://xptv-rou-proxy.pages.dev'

let $config = {}
try {
    $config = argsify($config_str) || {}
} catch (e) {
    $config = {}
}

const appConfig = {
    ver: 10,
    title: '🕶️肉视频',
    site: HOME,
    tabs: [
        { name: '首页', ui: 1, ext: { url: HOME } },
        { name: '最新', ui: 1, ext: { url: ROOT + '/v?order=createdAt' } },
        { name: '热门', ui: 1, ext: { url: ROOT + '/v?order=likeCount' } },
        { name: '观看最多', ui: 1, ext: { url: ROOT + '/v?order=viewCount' } },
        { name: '國產AV', ui: 1, ext: { url: ROOT + '/t/' + encodeURIComponent('國產AV') } },
        { name: '探花', ui: 1, ext: { url: ROOT + '/t/' + encodeURIComponent('探花') } },
        { name: '自拍流出', ui: 1, ext: { url: ROOT + '/t/' + encodeURIComponent('自拍流出') } },
        { name: 'OnlyFans', ui: 1, ext: { url: ROOT + '/t/OnlyFans' } },
        { name: '日本', ui: 1, ext: { url: ROOT + '/t/' + encodeURIComponent('日本') } },
    ],
}

function headers(json) {
    return {
        'User-Agent': UA,
        'Referer': HOME,
        'Origin': ROOT,
        'Accept': json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
}

function normalizeUrl(url) {
    if (!url) return ''
    let s = String(url).replace(/\\\//g, '/').replace(/&amp;/g, '&')
    if (/^https?:\/\//i.test(s)) return s
    if (s.indexOf('//') === 0) return 'https:' + s
    if (s.indexOf('/') === 0) return ROOT + s
    return ROOT + '/' + s
}

function videoId(url) {
    const m = String(url || '').match(/\/v\/([^/?#]+)/)
    return m ? m[1] : ''
}

function addCard(cards, seen, id, title, cover, remark) {
    id = String(id || '')
    if (!id || seen[id]) return
    seen[id] = true

    cards.push({
        vod_id: '/v/' + id,
        vod_name: String(title || id),
        vod_pic: normalizeUrl(cover || ''),
        vod_remarks: String(remark || ''),
        ext: {
            id: id,
            url: ROOT + '/v/' + id,
        },
    })
}

function videoRemark(video) {
    const parts = []

    if (Array.isArray(video.sources) && video.sources.length) {
        let best = 0
        for (let i = 0; i < video.sources.length; i++) {
            const n = Number(video.sources[i] && video.sources[i].resolution || 0)
            if (n > best) best = n
        }
        if (best) parts.push(best + 'p')
    }

    if (video.viewCount != null) parts.push(String(video.viewCount) + '观看')
    if (video.likeCount != null) parts.push(String(video.likeCount) + '赞')

    return parts.join(' · ')
}

function addVideoObject(cards, seen, video) {
    if (!video || !video.id) return

    addCard(
        cards,
        seen,
        String(video.id),
        String(video.name || video.nameZh || video.vid || video.id),
        String(video.coverImageUrl || ''),
        videoRemark(video)
    )
}

function parseNextData($, cards, seen) {
    const raw = $('#__NEXT_DATA__').html() || $('#__NEXT_DATA__').text() || ''
    if (!raw) return false

    let json
    try {
        json = JSON.parse(raw)
    } catch (e) {
        $print('Rou __NEXT_DATA__ JSON error: ' + e)
        return false
    }

    const props = json && json.props && json.props.pageProps
    if (!props) return false

    // /v, /search and /t pages
    if (Array.isArray(props.videos)) {
        for (let i = 0; i < props.videos.length; i++) {
            addVideoObject(cards, seen, props.videos[i])
        }
    }

    // /home featured page
    const groups = [
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

    for (let i = 0; i < groups.length; i++) {
        const arr = props[groups[i]]
        if (!Array.isArray(arr)) continue

        for (let j = 0; j < arr.length; j++) {
            addVideoObject(cards, seen, arr[j])
        }
    }

    // Some deployments nest the same pageProps one level deeper.
    if (!cards.length) {
        function walk(value, depth) {
            if (!value || depth > 5) return

            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) walk(value[i], depth + 1)
                return
            }

            if (typeof value !== 'object') return

            if (
                value.id &&
                (value.name || value.nameZh) &&
                value.coverImageUrl &&
                (value.createdAt || value.duration != null || value.viewCount != null)
            ) {
                addVideoObject(cards, seen, value)
                return
            }

            const keys = Object.keys(value)
            for (let i = 0; i < keys.length; i++) {
                if (keys[i] === 'ev') continue
                walk(value[keys[i]], depth + 1)
            }
        }

        walk(props, 0)
    }

    return cards.length > 0
}

function parseCards(data) {
    const cards = []
    const seen = {}
    const html = String(data || '')
    const $ = cheerio.load(html)

    // ROU is a Next.js site. Structured page data gives the real title/cover
    // and avoids accidentally using ad/placeholder content from surrounding DOM.
    if (parseNextData($, cards, seen)) {
        $print('Rou parseCards nextData html=' + html.length + ' cards=' + cards.length)
        return cards
    }

    // Fallback for alternate/mirror layouts: only inspect the nearest card-like
    // container instead of walking up through broad page sections.
    $('a[href*="/v/"]').each((_, element) => {
        const a = $(element)
        const href = a.attr('href') || ''
        const id = videoId(href)
        if (!id || seen[id]) return

        let box = a.closest('[data-slot="card"], .shadow, article, li')
        if (!box || !box.length) box = a.parent()

        const img = a.find('img').first().length
            ? a.find('img').first()
            : box.find('img').first()

        let title = String(
            a.text() ||
            a.attr('title') ||
            a.attr('aria-label') ||
            box.find('h2,h3,h4,.title').first().text() ||
            id
        ).replace(/\s+/g, ' ').trim()

        // ROU's card link text contains resolution/duration before the title
        // and category/view metadata after it. Keep only the actual video title.
        title = title
            .replace(/^\s*\d{3,4}P\s*/i, '')
            .replace(/^\s*(?:\d+小時)?\d+分\d+秒\s*/i, '')
            .replace(/(?:國產AV|自拍流出|OnlyFans|日本|探花|麻豆傳媒)\s*[·•].*$/i, '')
            .replace(/\s*[·•]\s*[\d.,萬Kk]+次觀看.*$/i, '')
            .trim()

        if (!title || title === id) {
            title = String(
                a.attr('title') ||
                a.attr('aria-label') ||
                box.find('h2,h3,h4,.title').first().text() ||
                img.attr('alt') ||
                id
            ).replace(/\s+/g, ' ').trim()
        }

        const cover =
            img.attr('src') ||
            img.attr('data-src') ||
            img.attr('data-original') ||
            img.attr('data-lazy-src') ||
            ''

        addCard(cards, seen, id, title, cover, '')
    })

    $print('Rou parseCards fallback html=' + html.length + ' cards=' + cards.length)
    return cards
}

function pageUrl(url, page) {
    page = Number(page || 1)
    if (page <= 1) return url
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'page=' + page
}

async function getConfig() {
    return jsonify(appConfig)
}

async function getCards(ext) {
    try {
        ext = argsify(ext)
        const page = Number(ext.page || 1)
        const base = ext.url || HOME

        let url
        if (base === HOME && page > 1) {
            url = ROOT + '/v?order=createdAt&page=' + page
        } else {
            url = pageUrl(base, page)
        }

        const res = await $fetch.get(url, {
            headers: headers(false),
        })
        const data = res.data
        const list = parseCards(data)

        if (!list.length) {
            $print('Rou getCards empty url=' + url + ' len=' + String(data || '').length)
        }

        return jsonify({ list: list })
    } catch (e) {
        $print('Rou getCards error: ' + e)
        return jsonify({ list: [] })
    }
}


function base64ToBytes(input) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const clean = String(input || '').replace(/[^A-Za-z0-9+/=]/g, '')
    const bytes = []
    let buffer = 0
    let bits = 0

    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i]
        if (ch === '=') break

        const value = chars.indexOf(ch)
        if (value < 0) continue

        buffer = (buffer << 6) | value
        bits += 6

        if (bits >= 8) {
            bits -= 8
            bytes.push((buffer >> bits) & 255)
        }
    }

    return bytes
}

function decodeEv(ev) {
    if (!ev || !ev.d) return null

    try {
        const bytes = base64ToBytes(ev.d)
        const key = Number(ev.k || 0)
        let text = ''

        for (let i = 0; i < bytes.length; i++) {
            text += String.fromCharCode((bytes[i] - key + 256) & 255)
        }

        return JSON.parse(text)
    } catch (e) {
        $print('Rou decodeEv error: ' + e)
        return null
    }
}

async function resolveSignedVideo(detailUrl) {
    const { data } = await $fetch.get(detailUrl, {
        headers: {
            'User-Agent': UA,
        },
    })

    const html = String(data || '')
    const $ = cheerio.load(html)
    let scriptContent = $('#__NEXT_DATA__').html() || $('#__NEXT_DATA__').text() || ''

    if (!scriptContent) {
        const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
        scriptContent = m ? m[1] : ''
    }

    if (!scriptContent) {
        throw new Error('__NEXT_DATA__ not found')
    }

    const jsonData = JSON.parse(scriptContent)
    const ev = jsonData && jsonData.props && jsonData.props.pageProps && jsonData.props.pageProps.ev
    const decoded = decodeEv(ev)

    if (!decoded || !decoded.videoUrl) {
        throw new Error('videoUrl not found')
    }

    let playurl = String(decoded.videoUrl)
    playurl = playurl
        .replace(/\/index\.jpg(?=([?#]|$))/i, '/index.m3u8')
        .replace(/\/index\.png(?=([?#]|$))/i, '/index.m3u8')

    return playurl
}

function buildProxyUrl(playurl, detailUrl) {
    const base = String($config.rouProxy || $config.rou_proxy || DEFAULT_ROU_PROXY).trim().replace(/\/+$/, '')
    if (!base) return ''

    return base +
        '/proxy?url=' + encodeURIComponent(playurl) +
        '&ref=' + encodeURIComponent(detailUrl)
}

async function getTracks(ext) {
    try {
        ext = argsify(ext)

        let id = ''
        let detailUrl = ''

        if (ext && typeof ext === 'object') {
            id = String(ext.id || videoId(ext.url || '') || '').trim()
            detailUrl = String(ext.url || '').trim()
        }

        if (!detailUrl && id) detailUrl = ROOT + '/v/' + encodeURIComponent(id)

        if (!detailUrl) {
            $utils.toastError('肉视频：缺少详情地址')
            return jsonify({ list: [] })
        }

        return jsonify({
            list: [{
                title: '播放',
                tracks: [{
                    name: '播放',
                    pan: '',
                    ext: {
                        id,
                        url: detailUrl,
                    },
                }],
            }],
        })
    } catch (e) {
        $print('Rou getTracks error: ' + e)
        $utils.toastError('肉视频：播放集解析失败')
        return jsonify({ list: [] })
    }
}

async function getPlayinfo(ext) {
    try {
        ext = argsify(ext)

        const detailUrl = String(
            (ext && ext.url) ||
            ((ext && ext.id) ? ROOT + '/v/' + encodeURIComponent(ext.id) : '')
        ).trim()

        if (!detailUrl) {
            $utils.toastError('肉视频：缺少播放页')
            return jsonify({ urls: [], headers: [] })
        }

        const playurl = await resolveSignedVideo(detailUrl)
        const proxyUrl = buildProxyUrl(playurl, detailUrl)

        if (proxyUrl) {
            return jsonify({
                urls: [proxyUrl],
                headers: [{ 'User-Agent': UA }],
            })
        }

        // Direct playback is kept only as a fallback. Current ROU streams may
        // use PNG-wrapped roUd payloads that XPTV cannot decode by itself.
        return jsonify({
            urls: [playurl],
            headers: [{
                'User-Agent': UA,
                'Referer': detailUrl,
                'Origin': ROOT,
                'Accept': 'application/vnd.apple.mpegurl,application/x-mpegURL,video/*,*/*',
            }],
        })
    } catch (e) {
        $print('Rou getPlayinfo error: ' + e)
        $utils.toastError('肉视频：真实播放地址解析失败')
        return jsonify({ urls: [], headers: [] })
    }
}


async function search(ext) {
    try {
        ext = argsify(ext)
        const text = String(ext.text || '').trim()
        const page = Number(ext.page || 1)
        if (!text) return jsonify({ list: [] })

        const url = ROOT + '/search?q=' + encodeURIComponent(text) + '&t=&page=' + page
        const { data } = await $fetch.get(url, {
            headers: headers(false),
        })

        return jsonify({
            list: parseCards(data),
        })
    } catch (e) {
        $print('Rou search error: ' + e)
        return jsonify({ list: [] })
    }
}
