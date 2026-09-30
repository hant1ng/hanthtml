async function getLocalInfo() {
    return jsonify({
        ver: 3,
        name: '🕶️肉视频',
        api: 'csp_rouvideo',
    })
}

const cheerio = createCheerio()

const ROOT = 'https://rou.video'
const HOME = ROOT + '/home'
const API = ROOT + '/api'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const appConfig = {
    ver: 3,
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
        vod_id: id,
        vod_name: String(title || id),
        vod_pic: normalizeUrl(cover || ''),
        vod_remarks: String(remark || ''),
        ext: {
            id: id,
            url: ROOT + '/v/' + id,
        },
    })
}

function parseNextData($, cards, seen) {
    const raw = $('#__NEXT_DATA__').html() || $('#__NEXT_DATA__').text() || ''
    if (!raw) return

    let json
    try {
        json = JSON.parse(raw)
    } catch (e) {
        return
    }

    const props = json && json.props && json.props.pageProps
    if (!props) return

    function walk(value) {
        if (!value) return

        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) walk(value[i])
            return
        }

        if (typeof value !== 'object') return

        if (value.id && (value.name || value.nameZh) && value.coverImageUrl) {
            let remark = ''
            if (value.viewCount != null) remark = String(value.viewCount) + '观看'
            addCard(
                cards,
                seen,
                value.id,
                value.nameZh || value.name,
                value.coverImageUrl,
                remark
            )
            return
        }

        const keys = Object.keys(value)
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i]
            if (k === 'ev') continue
            walk(value[k])
        }
    }

    walk(props)
}

function parseCards(data) {
    const cards = []
    const seen = {}
    const html = String(data || '')
    const $ = cheerio.load(html)

    // Current ROU pages expose each video as an /v/<id> link.
    // Parse links directly so layout/class changes do not make XPTV blank.
    $('a[href*="/v/"]').each((_, element) => {
        const a = $(element)
        const href = a.attr('href') || ''
        const id = videoId(href)
        if (!id || seen[id]) return

        let box = a
        let parent = a.parent()
        for (let i = 0; i < 4 && parent && parent.length; i++) {
            if (parent.find('img').length || parent.text().trim().length > a.text().trim().length) {
                box = parent
            }
            parent = parent.parent()
        }

        const img = box.find('img').first().length
            ? box.find('img').first()
            : a.find('img').first()

        let title =
            img.attr('alt') ||
            a.attr('title') ||
            a.attr('aria-label') ||
            box.find('h2,h3,h4,.title').first().text() ||
            a.text() ||
            box.text() ||
            id

        title = String(title || id).replace(/\s+/g, ' ').trim()

        const cover =
            img.attr('src') ||
            img.attr('data-src') ||
            img.attr('data-original') ||
            img.attr('data-lazy-src') ||
            ''

        const remark =
            box.find('[class*="duration"]').first().text() ||
            box.find('[class*="view"]').first().text() ||
            ''

        addCard(
            cards,
            seen,
            id,
            title,
            cover,
            String(remark || '').replace(/\s+/g, ' ').trim()
        )
    })

    // Older/alternate pages may still expose structured Next.js data.
    if (!cards.length) parseNextData($, cards, seen)

    // Last resort: raw href regex, independent of Cheerio selector behavior.
    if (!cards.length) {
        const re = /href=["']([^"']*\/v\/([^"'/?#]+)[^"']*)["']/gi
        let m
        while ((m = re.exec(html)) !== null) {
            const id = decodeURIComponent(m[2])
            addCard(cards, seen, id, id, '', '')
        }
    }

    $print('Rou parseCards html=' + html.length + ' cards=' + cards.length)
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

async function getTracks(ext) {
    try {
        ext = argsify(ext)
        const id = String(ext.id || videoId(ext.url) || '')
        if (!id) return jsonify({ list: [] })

        return jsonify({
            list: [{
                title: '播放',
                tracks: [{
                    name: '播放',
                    pan: '',
                    ext: {
                        id: id,
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
        const id = String(ext.id || videoId(ext.url) || '')
        if (!id) return jsonify({ urls: [], headers: [] })

        const { data } = await $fetch.get(API + '/v/' + encodeURIComponent(id), {
            headers: headers(true),
        })

        const json = argsify(data)
        let playurl = json && json.video && json.video.videoUrl
        if (!playurl) {
            $utils.toastError('肉视频播放地址解析失败')
            return jsonify({ urls: [], headers: [] })
        }

        playurl = normalizeUrl(playurl)
            .replace(/index\.jpg(?=\?|$)/i, 'index.m3u8')
            .replace(/index\.png(?=\?|$)/i, 'index.m3u8')

        return jsonify({
            urls: [playurl],
            headers: [{
                'User-Agent': UA,
                'Referer': ROOT + '/',
                'Origin': ROOT,
            }],
        })
    } catch (e) {
        $print('Rou getPlayinfo error: ' + e)
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
