async function getLocalInfo() {
    return jsonify({
        ver: 2,
        name: '🕶️HSTV',
        api: 'csp_hstv',
    })
}

const CryptoJS = createCryptoJS()

const SITE = 'https://hstv.life'
const APP = 'hstv.life'
const VERSION = '260901'
const API_CACHE_KEY = 'hstv_api_host_v2'
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1'

const API_HOSTS = [
    'https://v2.cdn199.com',
    'https://v2.kekecdn.net',
    'https://v2.luchu.org',
    'https://v2.madou.ws',
    'https://v2.papapa.biz',
    'https://v2.tianmtv.com',
    'https://v2.xiaoshuo.info',
    'https://v2.xiaoshuo.la',
]

const appConfig = {
    ver: 2,
    title: '🕶️HSTV',
    site: SITE,
    tabs: [
        { name: '首页', ui: 1, ext: { type: 'hot' } },
        { name: '最新', ui: 1, ext: { type: 'recent' } },
        { name: 'VIP', ui: 1, ext: { type: 'vip' } },
        { name: '日本', ui: 1, ext: { type: 'japan' } },
        { name: '高清', ui: 1, ext: { type: 'high' } },
    ],
}

function parseMaybeJson(value) {
    if (value == null) return value
    if (typeof value !== 'string') return value

    try {
        return JSON.parse(value)
    } catch (e) {
        try {
            return argsify(value)
        } catch (e2) {
            return value
        }
    }
}

function decryptResponse(input) {
    const envelope = parseMaybeJson(input)

    if (!envelope) {
        throw new Error('empty response')
    }

    if (envelope.blocked) {
        throw new Error('blocked')
    }

    if (!envelope.r) {
        return envelope
    }

    const plain = CryptoJS.AES.decrypt(
        String(envelope.r),
        'xxx'
    ).toString(CryptoJS.enc.Utf8)

    if (!plain) {
        throw new Error('decrypt returned empty text')
    }

    return parseMaybeJson(plain)
}

function apiHostsInOrder() {
    const cached = String($cache.get(API_CACHE_KEY) || '').trim()
    const out = []

    if (cached && API_HOSTS.includes(cached)) {
        out.push(cached)
    }

    API_HOSTS.forEach(host => {
        if (!out.includes(host)) out.push(host)
    })

    return out
}

function requestBody(path, payload) {
    const body = Object.assign({}, payload || {})

    body.deviceInfo = {}
    body.app = APP
    body.isStandalone = false
    body.theLink = 'novaluenull'
    body.uuid = 'novalue'
    body.url = path
    body.version = VERSION

    return body
}

async function apiRequest(path, payload) {
    const body = JSON.stringify(requestBody(path, payload))
    const hosts = apiHostsInOrder()
    let lastError = null

    for (let i = 0; i < hosts.length; i++) {
        const host = hosts[i]

        try {
            const res = await $fetch.post(
                host + '/js',
                body,
                {
                    headers: {
                        'User-Agent': UA,
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer undefined',
                        'Origin': SITE,
                        'Referer': SITE + '/',
                        'Accept': 'application/json, text/plain, */*',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                    },
                }
            )

            const data = decryptResponse(res.data)

            if (data == null) {
                throw new Error('empty decrypted response')
            }

            $cache.set(API_CACHE_KEY, host)
            return data
        } catch (e) {
            lastError = e
            $print('HSTV API failed host=' + host + ' path=' + path + ' error=' + e)
        }
    }

    throw lastError || new Error('all HSTV API hosts failed')
}

function arrayFromResponse(data) {
    if (Array.isArray(data)) return data
    if (!data || typeof data !== 'object') return []

    const keys = ['list', 'videos', 'items', 'rows', 'data', 'result']

    for (let i = 0; i < keys.length; i++) {
        const value = data[keys[i]]
        if (Array.isArray(value)) return value
    }

    return []
}

function firstString(values) {
    for (let i = 0; i < values.length; i++) {
        const value = values[i]
        if (value != null && String(value).trim()) {
            return String(value).trim()
        }
    }
    return ''
}

function normalizeAsset(url) {
    if (!url) return ''

    let value = String(url)
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&')
        .trim()

    if (/^https?:\/\//i.test(value)) return value
    if (value.startsWith('//')) return 'https:' + value
    if (value.startsWith('/assets/')) return SITE + value
    if (value.startsWith('/')) return 'https://rs.xiaoxx.com' + value

    return value
}

function videoId(video) {
    return firstString([
        video && video.id,
        video && video._id,
        video && video.vId,
        video && video.vid,
    ])
}

function videoCover(video) {
    if (!video) return ''

    let thumbnails = video.thumbnails

    if (Array.isArray(thumbnails)) {
        for (let i = 0; i < thumbnails.length; i++) {
            let item = thumbnails[i]
            if (item && typeof item === 'object') {
                item = item.url || item.src || item.path
            }

            const url = normalizeAsset(item)
            if (url) return url
        }
    }

    if (thumbnails && typeof thumbnails === 'object') {
        thumbnails = thumbnails.url || thumbnails.src || thumbnails.path
    }

    return normalizeAsset(firstString([
        thumbnails,
        video.thumbnail,
        video.cover,
        video.coverUrl,
        video.poster,
    ]))
}

function videoTitle(video) {
    return firstString([
        video && video.title,
        video && video.title_cn,
        video && video.title_en,
        video && video.name,
        videoId(video),
    ])
}

function videoDuration(video) {
    return firstString([
        video && video.durationStr,
        video && video.duration,
        video && video.time,
    ])
}

function videoRemark(video) {
    const parts = []
    const duration = videoDuration(video)

    if (duration) parts.push(duration)

    if (video && video.views != null) {
        parts.push(String(video.views) + '观看')
    }

    if (video && video.vip) {
        parts.push('VIP')
    }

    return parts.join(' · ')
}

function toCard(video) {
    const id = videoId(video)
    if (!id) return null

    return {
        vod_id: String(id),
        vod_name: videoTitle(video),
        vod_pic: videoCover(video),
        vod_remarks: videoRemark(video),
        vod_duration: videoDuration(video),
        ext: {
            id: String(id),
        },
    }
}

function mapCards(data) {
    const raw = arrayFromResponse(data)
    const list = []
    const seen = {}

    raw.forEach(video => {
        const card = toCard(video)
        if (!card || seen[card.vod_id]) return

        seen[card.vod_id] = true
        list.push(card)
    })

    return list
}

function extractPlayUrls(detail) {
    if (!detail || typeof detail !== 'object') return []

    const candidates = []

    function push(value) {
        if (!value) return

        if (Array.isArray(value)) {
            value.forEach(push)
            return
        }

        if (typeof value === 'object') {
            push(value.url)
            push(value.src)
            push(value.file)
            push(value.m3u8)
            return
        }

        const url = String(value)
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&')
            .trim()

        if (!/^https?:\/\//i.test(url)) return
        if (!candidates.includes(url)) candidates.push(url)
    }

    push(detail.m3u8s)
    push(detail.m3u8)
    push(detail.playUrl)
    push(detail.videoUrl)

    return candidates
}

async function getConfig() {
    return jsonify(appConfig)
}

async function getCards(ext) {
    try {
        ext = argsify(ext)
        const page = Number(ext.page || 1)
        const type = String(ext.type || 'hot')

        const data = await apiRequest(
            '/sevenVideos?page=' + page + '&type=' + encodeURIComponent(type),
            {}
        )

        const list = mapCards(data)
        $print('HSTV cards=' + list.length + ' type=' + type + ' page=' + page)

        return jsonify({
            list,
            page,
        })
    } catch (e) {
        $print('HSTV getCards error: ' + e)
        $utils.toastError('HSTV 列表接口请求失败')
        return jsonify({ list: [] })
    }
}

async function getTracks(ext) {
    try {
        ext = argsify(ext)
        const id = String(ext.id || '').trim()

        if (!id) return jsonify({ list: [] })

        return jsonify({
            list: [{
                title: '播放',
                tracks: [{
                    name: '默认线路',
                    pan: '',
                    ext: {
                        id,
                    },
                }],
            }],
        })
    } catch (e) {
        $print('HSTV getTracks error: ' + e)
        return jsonify({ list: [] })
    }
}

async function getPlayinfo(ext) {
    try {
        ext = argsify(ext)
        const id = String(ext.id || '').trim()

        if (!id) {
            return jsonify({ urls: [], headers: [] })
        }

        const detail = await apiRequest(
            '/sevenVideos/' + encodeURIComponent(id),
            {
                url_search: '',
                token: 'ufd',
            }
        )

        const urls = extractPlayUrls(detail)

        if (!urls.length) {
            $print('HSTV detail has no playable URL id=' + id)
            $utils.toastError('HSTV 未返回播放地址')
            return jsonify({ urls: [], headers: [] })
        }

        return jsonify({
            urls: [urls[0]],
            headers: [{
                'User-Agent': UA,
                'Referer': SITE + '/',
                'Origin': SITE,
            }],
        })
    } catch (e) {
        $print('HSTV getPlayinfo error: ' + e)
        $utils.toastError('HSTV 播放解析失败')
        return jsonify({ urls: [], headers: [] })
    }
}

async function search(ext) {
    try {
        ext = argsify(ext)
        const text = String(ext.text || '').trim()
        const page = Number(ext.page || 1)

        if (!text) {
            return jsonify({ list: [], page })
        }

        const data = await apiRequest(
            '/searchSevenVideos',
            {
                page,
                keywords: text,
                filterCategory: 'all',
                filterTimeInDays: 'all',
                filterViews: 'all',
                filterDurationInMins: 'all',
                sortBy: 'time',
                keywordLogic: 'or',
            }
        )

        const list = mapCards(data)
        $print('HSTV search cards=' + list.length + ' keyword=' + text)

        return jsonify({
            list,
            page,
        })
    } catch (e) {
        $print('HSTV search error: ' + e)
        return jsonify({ list: [] })
    }
}
